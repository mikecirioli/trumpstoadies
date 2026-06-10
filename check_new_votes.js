#!/usr/bin/env node
/**
 * check_new_votes.js — poll House and Senate for new votes, ingest any that
 * look like significant floor votes (passage, nominations, key resolutions).
 *
 * Runs on cron 4x/day. Tracks last-seen roll numbers in state.json.
 * Skips procedural votes (cloture, motions to table, quorum calls, etc.).
 * After ingesting new votes, rebuilds the Astro site and copies dist/.
 */

import fs from 'fs';
import * as cp from 'child_process';
import https from 'https';
import xml2js from 'xml2js';
import path from 'path';
import { fileURLToPath } from 'url';
import { ingestHouse, ingestSenate, saveActions } from './ingest_vote.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = process.env.STATE_FILE ?? path.join(__dirname, 'state', '.vote_state.json');
const LOG_FILE   = process.env.LOG_FILE   ?? path.join(__dirname, 'state', '.ingest.log');

// ── Config ────────────────────────────────────────────────────────────────────

const CONGRESS = 119;
const SESSION  = 2;    // update when session changes
const YEAR     = 2026; // update when year changes

// Only these question types are worth tracking — everything else is procedural noise
const TRACK_QUESTIONS = [
    'On Passage',
    'On the Nomination',
    'On the Joint Resolution',
    'On the Resolution of Ratification',
    'On the Motion to Discharge',   // war powers resolutions use this
    'On Agreeing to the Resolution', // only if it's a substantive resolution, checked below
];

// Even if the question matches above, skip if title contains these
const SKIP_TITLE_PATTERNS = [
    /providing for consideration/i,
    /rule for consideration/i,
    /previous question/i,
    /cloture/i,
    /adjourn/i,
    /en bloc/i,
    /motion to recommit/i,
    /smithsonian/i,           // non-political museum bills etc
    /commemorat/i,
    /post office/i,
];

function shouldSkip(question = '', title = '') {
    const q = question.trim();
    // Must be a tracked question type
    if (!TRACK_QUESTIONS.some(s => q.startsWith(s))) return true;
    // Even tracked question types can be procedural based on title
    if (SKIP_TITLE_PATTERNS.some(r => r.test(title))) return true;
    return false;
}

// Topic inference — returns 'Uncategorized' if can't confidently classify
function inferTopic(title = '', question = '', issue = '') {
    const t = `${title} ${question} ${issue}`.toLowerCase();
    if (/\bconfirm|\bnominat|\bsecretary\b|\bambassador\b|\bjudge\b|\bdirector\b|\battorney general\b/i.test(t)) return 'Nominations';
    if (/\biran\b|\bukraine\b|\brussia\b|\bchina\b|\btaiwan\b|\bnato\b|war powers|foreign policy|\bsanction|\btrade war|\btariff/i.test(t)) return 'Foreign Policy';
    if (/immigration|border wall|\btitle ix\b|transgender|abortion|\bgun\b|firearm|health care|education|\bsport\b|lgbtq|same.sex|drag/i.test(t)) return 'Social Issues';
    return 'Uncategorized';
}

// ── State ─────────────────────────────────────────────────────────────────────

function loadState() {
    if (!fs.existsSync(STATE_FILE)) {
        // Seed with current known roll numbers so first run only catches new votes
        return { lastHouseRoll: 184, lastSenateRoll: 130, ingested: [] };
    }
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── Logging ───────────────────────────────────────────────────────────────────

function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    fs.appendFileSync(LOG_FILE, line + '\n');
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchUrl(res.headers.location).then(resolve).catch(reject);
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

// ── Senate poll ───────────────────────────────────────────────────────────────

async function checkSenate(state) {
    const listUrl = `https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_${CONGRESS}_${SESSION}.xml`;
    log(`Checking Senate vote list: ${listUrl}`);

    const xml    = await fetchUrl(listUrl);
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xml);
    const votes  = result['vote_summary']['votes'][0]['vote'];

    const newVotes = [];
    for (const v of votes) {
        const rollNum  = parseInt(v['vote_number'][0], 10);
        if (rollNum <= state.lastSenateRoll) continue;

        const question = v['question']?.[0]?.trim() ?? '';
        const title    = v['title']?.[0]?.trim()    ?? '';
        const issue    = v['issue']?.[0]?.trim()    ?? '';

        if (!question && !title) {
            log(`  Senate ${rollNum}: SKIP — no question/title (en-bloc or malformed)`);
            // Still advance the pointer so we don't re-check it
            state.lastSenateRoll = Math.max(state.lastSenateRoll, rollNum);
            continue;
        }

        if (shouldSkip(question, title)) {
            log(`  Senate ${rollNum}: SKIP — ${question || title}`);
            state.lastSenateRoll = Math.max(state.lastSenateRoll, rollNum);
            continue;
        }

        const topic = inferTopic(title, question, issue);
        newVotes.push({ rollNum, question, title, issue, topic });
    }

    return newVotes;
}

// ── House poll ────────────────────────────────────────────────────────────────

async function checkHouse(state) {
    // House doesn't have a simple XML index — probe for new roll numbers
    // by trying to fetch sequentially from lastHouseRoll+1
    const newVotes = [];
    let roll = state.lastHouseRoll + 1;

    while (true) {
        const url = `https://clerk.house.gov/cgi-bin/vote.asp?year=${YEAR}&rollnumber=${roll}`;
        try {
            const xml    = await fetchUrl(url);
            if (!xml.includes('<rollcall-vote>')) break;

            const parser = new xml2js.Parser();
            const result = await parser.parseStringPromise(xml);
            const meta   = result['rollcall-vote']['vote-metadata'][0];

            const question = meta['vote-question'][0].trim();
            const title    = meta['vote-desc'][0].trim();
            const legisNum = meta['legis-num'][0].trim();

            if (shouldSkip(question, title)) {
                log(`  House ${roll}: SKIP — ${question}: ${title}`);
                state.lastHouseRoll = Math.max(state.lastHouseRoll, roll);
            } else {
                const topic = inferTopic(title, question, legisNum);
                newVotes.push({ rollNum: roll, question, title, legisNum, topic });
            }
            roll++;
        } catch {
            break;
        }
    }

    return newVotes;
}

// ── Ingest ────────────────────────────────────────────────────────────────────

async function runIngest(chamber, identifier, topic, oppose) {
    try {
        const result = chamber === 'house'
            ? await ingestHouse(identifier, topic, oppose, null)
            : await ingestSenate(identifier, topic, oppose, null);
        saveActions(result.actions, result.prefix);
        log(`  Ingested ${result.actions.length} actions (${result.label}) → eventId: ${result.eventId}`);
        return true;
    } catch (e) {
        log(`ERROR ingesting ${chamber} ${identifier}: ${e.message}`);
        return false;
    }
}

function buildAndCopy() {
    log('Regenerating rankings...');
    try {
        cp.execSync('node generate_rankings.js', { cwd: __dirname, encoding: 'utf8', timeout: 30000 });
    } catch (e) {
        log(`Rankings failed (non-fatal): ${e.message}`);
    }

    // Enrichment handled by enrich_pending.js cron (every 15 min, laptop-aware)
    log('Building site...');
    try {
        // /app/dist and /usr/share/nginx/html are both bind-mounted to the same
        // host directory, so building is sufficient — nginx picks it up immediately.
        cp.execSync('npm run build', { cwd: __dirname, encoding: 'utf8', timeout: 120000 });
        return true;
    } catch (e) {
        log(`Build failed: ${e.message}`);
        return false;
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    log('=== check_new_votes start ===');
    const state    = loadState();
    let   anyNew   = false;

    // Senate
    try {
        const senateNew = await checkSenate(state);
        for (const v of senateNew) {
            log(`  Senate ${v.rollNum}: ${v.question} — ${v.title} (topic: ${v.topic ?? 'unknown'})`);
            if (!v.topic) {
                log(`  WARNING: Could not infer topic for Senate ${v.rollNum}. Skipping — add manually with: node ingest_vote.js --senate ${CONGRESS}/${SESSION}/${v.rollNum} --topic "..."`);
                continue;
            }
            const ok = await runIngest('senate', `${CONGRESS}/${SESSION}/${v.rollNum}`, v.topic, false);
            if (ok) {
                state.lastSenateRoll = Math.max(state.lastSenateRoll, v.rollNum);
                state.ingested = state.ingested ?? [];
                state.ingested.push({ chamber: 'senate', roll: v.rollNum, title: v.title, date: new Date().toISOString() });
                anyNew = true;
            }
        }
        if (senateNew.length === 0) log('  Senate: no new votes.');
    } catch (e) {
        log(`Senate check failed: ${e.message}`);
    }

    // House
    try {
        const houseNew = await checkHouse(state);
        for (const v of houseNew) {
            log(`  House ${v.rollNum}: ${v.question} — ${v.title} (topic: ${v.topic ?? 'unknown'})`);
            if (!v.topic) {
                log(`  WARNING: Could not infer topic for House ${v.rollNum}. Skipping — add manually with: node ingest_vote.js --house ${YEAR}/${v.rollNum} --topic "..."`);
                continue;
            }
            const ok = await runIngest('house', `${YEAR}/${v.rollNum}`, v.topic, false);
            if (ok) {
                state.lastHouseRoll = Math.max(state.lastHouseRoll, v.rollNum);
                state.ingested = state.ingested ?? [];
                state.ingested.push({ chamber: 'house', roll: v.rollNum, title: v.title, date: new Date().toISOString() });
                anyNew = true;
            }
        }
        if (houseNew.length === 0) log('  House: no new votes.');
    } catch (e) {
        log(`House check failed: ${e.message}`);
    }

    if (anyNew) {
        buildAndCopy();
    } else {
        log('No new votes ingested — skipping build.');
    }

    saveState(state);
    log('=== check_new_votes done ===\n');
}

main().catch(err => { log(`FATAL: ${err.message}`); process.exit(1); });
