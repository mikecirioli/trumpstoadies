#!/usr/bin/env node
/**
 * enrich_pending.js — runs on optiplex every 15 min via cron.
 *
 * 1. Checks if the Ollama API is reachable (laptop may be offline)
 * 2. If reachable, enriches any events missing from events_meta.json
 * 3. Flags any events that fail enrichment after MAX_RETRIES attempts
 * 4. If anything was enriched, rebuilds the site
 *
 * Failures are recorded in events_meta.json with a "failed" flag so they
 * can be reviewed later. Re-running clears the flag and retries them.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const ACTIONS    = join(__dirname, 'src/data/actions.json');
const META_PATH  = join(__dirname, 'src/data/events_meta.json');
const STATE_FILE = process.env.STATE_FILE ?? join(__dirname, 'state/.vote_state.json');
const LOG_FILE   = process.env.LOG_FILE   ?? join(__dirname, 'state/.ingest.log');

// Ollama endpoint — laptop LAN IP. Falls back to localhost if running on dev machine.
const OLLAMA_HOSTS = [
    'http://192.168.1.47:11434',   // mcirioli laptop LAN
    'http://localhost:11434',       // dev machine fallback
];
const MODEL       = 'mistral:7b-instruct';
const MAX_RETRIES = 3;  // max attempts per event before flagging as failed

// ── Logging ───────────────────────────────────────────────────────────────────

function log(msg) {
    const line = `[${new Date().toISOString()}] [enrich] ${msg}`;
    console.log(line);
    try { require('fs').appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

// ── Find working Ollama host ──────────────────────────────────────────────────

async function findOllama() {
    for (const host of OLLAMA_HOSTS) {
        try {
            log(`Probing ${host}...`);
            const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(3000) });
            log(`Probe result for ${host}: ${res.status}`);
            if (res.ok) return host;
        } catch (e) {
            log(`Probe error for ${host}: ${e.message}`);
        }
    }
    return null;
}

// ── Helpers copied from enrich_events.js ─────────────────────────────────────

function isOpposeBill(desc) {
    return /direct the removal|terminat.*national emergency|terminate the national emergency/i.test(desc);
}

function buildPrompt(event, proVoteWord) {
    const antiVoteWord = proVoteWord === 'Yea' ? 'Nay' : 'Yea';
    return `You are a nonpartisan political analyst. Given this congressional vote:

Title: ${event.eventTitle}
Full description: ${event.rawDescription}
Topic: ${event.topic}
Chamber: ${event.chamber}
A "${proVoteWord}" vote is considered alignment with Trump's position.

Respond ONLY with valid JSON and no other text:
{
  "summary": "2 sentences: what this legislation actually does in plain English",
  "why_yes": "1 sentence: the strongest argument FOR voting ${proVoteWord} on this bill",
  "why_no": "1 sentence: the strongest argument AGAINST voting ${proVoteWord} on this bill (i.e. for voting ${antiVoteWord})",
  "trump_signal": "1 sentence: why voting ${proVoteWord} aligns with Trump's stated positions or agenda",
  "tags": ["tag1", "tag2", "tag3"]
}`;
}

async function callOllama(ollamaHost, prompt) {
    const res = await fetch(`${ollamaHost}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, prompt, stream: false, options: { temperature: 0.1 } }),
        signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    return (await res.json()).response;
}

function parseJSON(raw) {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON found in response');
    return JSON.parse(match[0]);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    // 1. Check if Ollama is reachable
    const ollamaHost = await findOllama();
    if (!ollamaHost) {
        log('Ollama not reachable — skipping enrichment');
        return;
    }
    log(`Ollama found at ${ollamaHost}`);

    // 2. Load data
    const actions = JSON.parse(readFileSync(ACTIONS, 'utf8'));
    const meta    = existsSync(META_PATH)
        ? JSON.parse(readFileSync(META_PATH, 'utf8'))
        : {};

    // 3. Build event list — skip enriched ones, retry failed ones up to MAX_RETRIES
    const eventMap = new Map();
    actions.filter(a => a.eventId).forEach(action => {
        if (!eventMap.has(action.eventId)) {
            eventMap.set(action.eventId, {
                eventId:        action.eventId,
                eventTitle:     action.eventTitle,
                rawDescription: action.description,
                description:    action.description.replace(/^Voted .*? on (the Motion to Discharge )?/, '').replace(/^Voted .*? on /, ''),
                topic:          action.topic,
                chamber:        action.chamber ?? (action.id.startsWith('sen-') ? 'senate' : 'house'),
            });
        }
    });

    const pending = [...eventMap.values()].filter(ev => {
        const existing = meta[ev.eventId];
        if (!existing) return true;                          // never enriched
        if (existing.failed && (existing.attempts ?? 0) < MAX_RETRIES) return true;  // failed but retryable
        return false;
    });

    if (pending.length === 0) {
        log('No pending enrichments');
        return;
    }

    log(`${pending.length} events pending enrichment`);

    let enriched = 0, failed = 0;

    for (let i = 0; i < pending.length; i++) {
        const ev = pending[i];
        const isOppose   = isOpposeBill(ev.rawDescription);
        const proVoteWord = isOppose ? 'Nay' : 'Yea';
        const attempts   = (meta[ev.eventId]?.attempts ?? 0) + 1;

        log(`Enriching ${i + 1}/${pending.length}: ${ev.eventTitle.slice(0, 60)} (attempt ${attempts})`);

        try {
            const raw    = await callOllama(ollamaHost, buildPrompt(ev, proVoteWord));
            const parsed = parseJSON(raw);

            if (!parsed.summary || !parsed.trump_signal || !Array.isArray(parsed.tags)) {
                throw new Error(`Missing fields: ${JSON.stringify(parsed)}`);
            }

            meta[ev.eventId] = {
                summary:      parsed.summary,
                why_yes:      parsed.why_yes ?? null,
                why_no:       parsed.why_no  ?? null,
                trump_signal: parsed.trump_signal,
                tags:         parsed.tags,
                enriched:     new Date().toISOString(),
            };
            enriched++;
            log(`  OK: ${parsed.tags.join(', ')}`);
        } catch (err) {
            failed++;
            log(`  FAILED (attempt ${attempts}/${MAX_RETRIES}): ${err.message}`);

            // Flag as failed with attempt count so we can retry later
            meta[ev.eventId] = {
                ...(meta[ev.eventId] ?? {}),
                failed:   true,
                attempts,
                lastError: err.message,
                lastTried: new Date().toISOString(),
                // Preserve any previous successful enrichment fields if this is a retry
            };

            if (attempts >= MAX_RETRIES) {
                log(`  GIVING UP after ${MAX_RETRIES} attempts — flagged for manual review`);
                meta[ev.eventId].gaveUp = true;
            }
        }

        // Save after every event
        writeFileSync(META_PATH, JSON.stringify(meta, null, 2));
    }

    log(`Enrichment complete: ${enriched} succeeded, ${failed} failed`);

    // Report anything that gave up
    const gaveUp = Object.entries(meta)
        .filter(([, v]) => v.gaveUp)
        .map(([id]) => id);
    if (gaveUp.length > 0) {
        log(`NEEDS MANUAL REVIEW (${gaveUp.length} events gave up after ${MAX_RETRIES} attempts):`);
        gaveUp.forEach(id => log(`  - ${id}`));
    }

    // Rebuild if anything was enriched
    if (enriched > 0) {
        log('Rebuilding site...');
        try {
            execSync('node generate_rankings.js', { cwd: __dirname, timeout: 30000 });
            execSync('npm run build', { cwd: __dirname, timeout: 120000 });
            log('Build complete');
        } catch (e) {
            log(`Build failed: ${e.message}`);
        }
    }
}

main().catch(err => log(`FATAL: ${err.message}`));
