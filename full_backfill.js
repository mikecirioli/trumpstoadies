#!/usr/bin/env node
/**
 * full_backfill.js — historical backfill of all congressional votes since Jan 20, 2025
 *
 * Fetches Senate vote list XMLs for 119th Congress sessions 1 and 2,
 * probes House roll calls for 2025 (1-300) and 2026 (1-200),
 * filters to significant votes only, and ingests each into actions.json.
 *
 * Run: node full_backfill.js
 */

import fs from 'fs';
import https from 'https';
import xml2js from 'xml2js';
import path from 'path';
import { fileURLToPath } from 'url';
import { ingestHouse, ingestSenate, saveActions } from './ingest_vote.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

// Trump's inauguration — only votes on or after this date
const INAUGURATION_DATE = '2025-01-20';

// Polite delay between HTTP requests (ms)
const REQUEST_DELAY_MS = 500;

// ── HTTP helper ───────────────────────────────────────────────────────────────

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: { 'User-Agent': 'TrumpToadies-Backfill/1.0 (historical data collection)' }
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchUrl(res.headers.location).then(resolve).catch(reject);
            }
            if (res.statusCode === 404) {
                return reject(new Error(`HTTP 404: ${url}`));
            }
            if (res.statusCode >= 400) {
                return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error(`Timeout fetching ${url}`));
        });
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Filtering ────────────────────────────────────────────────────────────────

// Senate: include votes where question starts with any of these
const SENATE_INCLUDE_QUESTIONS = [
    'On Passage',
    'On the Nomination',
    'On the Joint Resolution',
    'On the Motion to Discharge',
    'On the Bill',
    'On the Resolution of Ratification',
];

// Senate: exclude if title matches any of these (case-insensitive)
const SENATE_EXCLUDE_TITLE_RE = /cloture|adjourn|en bloc|previous question|motion to table|motion to concur|authorizing|executive resolution|providing for consideration|rule for consideration|motion to recommit|smithsonian|commemorat|post office/i;

// House: include only these exact question types
const HOUSE_INCLUDE_QUESTIONS = [
    'On Passage',
    'On the Joint Resolution',
    'On Concurring in Senate Amendments',
    'On the Bill',
];

// House: exclude if vote-desc matches
const HOUSE_EXCLUDE_DESC_RE = /previous question|district of columbia|smithsonian|commemorat|post office|rename|designat/i;

function shouldIncludeSenate(question, title) {
    const q = (question || '').trim();
    const t = (title || '').trim();
    if (!SENATE_INCLUDE_QUESTIONS.some(s => q.startsWith(s))) return false;
    if (SENATE_EXCLUDE_TITLE_RE.test(t)) return false;
    return true;
}

function shouldIncludeHouse(question, desc) {
    const q = (question || '').trim();
    const d = (desc || '').trim();
    if (!HOUSE_INCLUDE_QUESTIONS.some(s => q === s)) return false;
    if (HOUSE_EXCLUDE_DESC_RE.test(d)) return false;
    return true;
}

// ── Topic inference ───────────────────────────────────────────────────────────

function inferTopic(title, question, issue) {
    const t = `${title} ${question} ${issue}`.toLowerCase();
    if (/\bconfirm|\bnominat|\bsecretary\b|\bambassador\b|\bjudge\b|\bdirector\b|\battorney general\b/i.test(t)) return 'Nominations';
    if (/\biran\b|\bukraine\b|\brussia\b|\bchina\b|\btaiwan\b|\bnato\b|war powers|foreign|\bsanction|\btariff|\btrade/i.test(t)) return 'Foreign Policy';
    if (/immigrat|border|title ix|transgender|abortion|\bgun\b|firearm|health|education|\bsport\b|lgbtq|same.sex|drug|environment|energy|voting|election|budget|reconciliation|spending|appropriat/i.test(t)) return 'Social Issues';
    return 'Social Issues'; // default fallback — include rather than skip
}

// ── Oppose flag detection ─────────────────────────────────────────────────────

function isOppose(title, question) {
    const t = `${title} ${question}`;
    return /direct(ing)? the removal|terminat.*national emergency|war powers.*remove|remove.*armed forces/i.test(t);
}

// ── Existing event prefix detection ──────────────────────────────────────────

function loadExistingPrefixes() {
    const actionsPath = path.join(__dirname, 'src/data/actions.json');
    const actions = JSON.parse(fs.readFileSync(actionsPath, 'utf8'));
    // Extract unique prefixes by stripping the trailing -BIOGUIDE segment
    // Prefixes end before the last hyphen+letters segment (bioguide ID)
    const prefixes = new Set();
    for (const a of actions) {
        // prefix is everything before the last -XXXXXXX (bioguide is 7 chars, letters+digits)
        const lastDash = a.id.lastIndexOf('-');
        if (lastDash > 0) {
            prefixes.add(a.id.slice(0, lastDash));
        }
    }
    return prefixes;
}

// ── Senate discovery ──────────────────────────────────────────────────────────

async function discoverSenateVotes() {
    const votes = [];

    for (const [congress, session] of [[119, 1], [119, 2]]) {
        const url = `https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_${congress}_${session}.xml`;
        console.log(`\nFetching Senate vote list: ${url}`);

        let xml;
        try {
            xml = await fetchUrl(url);
        } catch (e) {
            console.log(`  SKIP — could not fetch: ${e.message}`);
            continue;
        }

        let parsed;
        try {
            const parser = new xml2js.Parser();
            parsed = await parser.parseStringPromise(xml);
        } catch (e) {
            console.log(`  SKIP — could not parse XML: ${e.message}`);
            continue;
        }

        const voteList = parsed['vote_summary']?.['votes']?.[0]?.['vote'] ?? [];
        console.log(`  Found ${voteList.length} total votes in session ${session}`);

        for (const v of voteList) {
            const rollNum  = parseInt(v['vote_number']?.[0] ?? '0', 10);
            // These fields may be objects (e.g. vote_tally, en_bloc) — only use if string
            const str = (val) => { const s = val?.[0]; return typeof s === 'string' ? s.trim() : ''; };
            const dateStr  = str(v['vote_date']);
            const question = str(v['question']);
            const title    = str(v['title']);
            const issue    = str(v['issue']);

            if (!rollNum) continue;

            // Filter to post-inauguration
            // Senate dates in the list are often like "January 20, 2025"
            const dateParsed = new Date(dateStr);
            if (!isNaN(dateParsed)) {
                const dateIso = dateParsed.toISOString().slice(0, 10);
                if (dateIso < INAUGURATION_DATE) {
                    continue; // pre-inauguration, skip
                }
            }

            if (!shouldIncludeSenate(question, title)) {
                continue;
            }

            const topic   = inferTopic(title, question, issue);
            const oppose  = isOppose(title, question);

            votes.push({ congress, session, rollNum, question, title, issue, topic, oppose, dateStr });
        }
    }

    console.log(`\nSenate: ${votes.length} votes selected for ingestion`);
    return votes;
}

// ── House discovery ───────────────────────────────────────────────────────────

async function discoverHouseVotes() {
    const votes = [];

    const probes = [
        { year: 2025, maxRoll: 300 },
        { year: 2026, maxRoll: 200 },
    ];

    for (const { year, maxRoll } of probes) {
        console.log(`\nProbing House votes for ${year} (rolls 1–${maxRoll})...`);

        for (let roll = 1; roll <= maxRoll; roll++) {
            const url = `https://clerk.house.gov/cgi-bin/vote.asp?year=${year}&rollnumber=${roll}`;

            let xml;
            try {
                xml = await fetchUrl(url);
                await sleep(REQUEST_DELAY_MS);
            } catch (e) {
                // 404 or timeout — no more rolls at this point
                if (e.message.includes('404') || e.message.includes('Timeout')) {
                    process.stdout.write(` [end at roll ${roll}]`);
                    break;
                }
                console.log(`\n  House ${year}/${roll}: ERROR — ${e.message}`);
                await sleep(REQUEST_DELAY_MS);
                continue;
            }

            if (!xml.includes('<rollcall-vote>')) {
                // No more votes for this year
                process.stdout.write(` [end at roll ${roll}]`);
                break;
            }

            let parsed;
            try {
                const parser = new xml2js.Parser();
                parsed = await parser.parseStringPromise(xml);
            } catch (e) {
                console.log(`\n  House ${year}/${roll}: parse error — ${e.message}`);
                continue;
            }

            const meta      = parsed['rollcall-vote']?.['vote-metadata']?.[0];
            if (!meta) continue;

            const question  = (meta['vote-question']?.[0] ?? '').trim();
            const desc      = (meta['vote-desc']?.[0] ?? '').trim();
            const legisNum  = (meta['legis-num']?.[0] ?? '').trim();
            const dateRaw   = (meta['action-date']?.[0] ?? '').trim();

            // Filter post-inauguration
            if (dateRaw) {
                const d = new Date(dateRaw.replace(/-/g, ' '));
                if (!isNaN(d)) {
                    const iso = d.toISOString().slice(0, 10);
                    if (iso < INAUGURATION_DATE) {
                        process.stdout.write('.');
                        continue;
                    }
                }
            }

            if (!shouldIncludeHouse(question, desc)) {
                process.stdout.write('.');
                continue;
            }

            const topic  = inferTopic(desc, question, legisNum);
            const oppose = isOppose(desc, question);

            votes.push({ year, roll, question, desc, legisNum, topic, oppose, dateRaw });
            process.stdout.write('+');
        }
        console.log(''); // newline after progress dots
    }

    console.log(`\nHouse: ${votes.length} votes selected for ingestion`);
    return votes;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    const startTime = Date.now();
    console.log('=== TrumpToadies Full Historical Backfill ===');
    console.log(`Started: ${new Date().toISOString()}`);
    console.log(`Inauguration cutoff: ${INAUGURATION_DATE}`);

    // Load existing action prefixes for duplicate detection
    const existingPrefixes = loadExistingPrefixes();
    console.log(`\nExisting action prefixes loaded: ${existingPrefixes.size}`);

    // Summary counters
    const summary = {
        senate: { total: 0, ingested: 0, skipped: 0, failed: 0 },
        house:  { total: 0, ingested: 0, skipped: 0, failed: 0 },
        failures: [],
    };

    // ── SENATE ────────────────────────────────────────────────────────────────

    console.log('\n' + '='.repeat(60));
    console.log('SENATE DISCOVERY');
    console.log('='.repeat(60));

    const senateVotes = await discoverSenateVotes();
    summary.senate.total = senateVotes.length;

    console.log('\n' + '='.repeat(60));
    console.log('SENATE INGESTION');
    console.log('='.repeat(60));

    for (let i = 0; i < senateVotes.length; i++) {
        const v = senateVotes[i];
        const id = `${v.congress}/${v.session}/${v.rollNum}`;
        console.log(`\n[${i + 1}/${senateVotes.length}] Senate ${id}: ${v.question} — ${v.title}`);
        console.log(`  Topic: ${v.topic} | Oppose: ${v.oppose} | Date: ${v.dateStr}`);

        try {
            const result = await ingestSenate(id, v.topic, v.oppose, null);
            saveActions(result.actions, result.prefix);
            console.log(`  -> Ingested ${result.actions.length} actions (${result.label}) eventId: ${result.eventId}`);
            summary.senate.ingested++;
        } catch (e) {
            console.log(`  -> FAILED: ${e.message}`);
            summary.senate.failed++;
            summary.failures.push({ chamber: 'senate', id, title: v.title, error: e.message });
        }

        await sleep(REQUEST_DELAY_MS);
    }

    // ── HOUSE ─────────────────────────────────────────────────────────────────

    console.log('\n' + '='.repeat(60));
    console.log('HOUSE DISCOVERY');
    console.log('='.repeat(60));

    const houseVotes = await discoverHouseVotes();
    summary.house.total = houseVotes.length;

    console.log('\n' + '='.repeat(60));
    console.log('HOUSE INGESTION');
    console.log('='.repeat(60));

    for (let i = 0; i < houseVotes.length; i++) {
        const v = houseVotes[i];
        const id = `${v.year}/${v.roll}`;
        console.log(`\n[${i + 1}/${houseVotes.length}] House ${id}: ${v.question} — ${v.desc}`);
        console.log(`  Topic: ${v.topic} | Oppose: ${v.oppose} | Date: ${v.dateRaw}`);

        try {
            const result = await ingestHouse(id, v.topic, v.oppose, null);
            saveActions(result.actions, result.prefix);
            console.log(`  -> Ingested ${result.actions.length} actions (${result.label}) eventId: ${result.eventId}`);
            summary.house.ingested++;
        } catch (e) {
            console.log(`  -> FAILED: ${e.message}`);
            summary.house.failed++;
            summary.failures.push({ chamber: 'house', id, title: v.desc, error: e.message });
        }

        await sleep(REQUEST_DELAY_MS);
    }

    // ── SUMMARY ───────────────────────────────────────────────────────────────

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;

    console.log('\n' + '='.repeat(60));
    console.log('BACKFILL COMPLETE');
    console.log('='.repeat(60));
    console.log(`Duration: ${minutes}m ${seconds}s`);
    console.log('');
    console.log('Senate:');
    console.log(`  Total selected:  ${summary.senate.total}`);
    console.log(`  Ingested:        ${summary.senate.ingested}`);
    console.log(`  Failed:          ${summary.senate.failed}`);
    console.log('');
    console.log('House:');
    console.log(`  Total selected:  ${summary.house.total}`);
    console.log(`  Ingested:        ${summary.house.ingested}`);
    console.log(`  Failed:          ${summary.house.failed}`);
    console.log('');

    const totalIngested = summary.senate.ingested + summary.house.ingested;
    const totalFailed   = summary.senate.failed + summary.house.failed;
    console.log(`TOTAL: ${totalIngested} votes ingested, ${totalFailed} failed`);

    if (summary.failures.length > 0) {
        console.log('\nFailures:');
        for (const f of summary.failures) {
            console.log(`  [${f.chamber}] ${f.id} "${f.title}": ${f.error}`);
        }
    }

    // Final actions.json count
    const actions = JSON.parse(fs.readFileSync(path.join(__dirname, 'src/data/actions.json'), 'utf8'));
    const uniqueEvents = new Set(actions.map(a => a.eventId)).size;
    console.log(`\nactions.json: ${actions.length} total actions across ${uniqueEvents} unique events`);
}

main().catch(err => {
    console.error('FATAL:', err);
    process.exit(1);
});
