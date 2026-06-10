#!/usr/bin/env node
/**
 * ingest_vote.js — fetch a congressional vote XML and add it to actions.json
 *
 * Usage:
 *   node ingest_vote.js --house 2026/184 --topic "Social Issues"
 *   node ingest_vote.js --senate 119/2/129 --topic "Foreign Policy" --oppose
 *   node ingest_vote.js --house 2026/184 --dry-run
 */

import fs from 'fs';
import https from 'https';
import xml2js from 'xml2js';
import yaml from 'js-yaml';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── CLI args (only parsed when run directly) ──────────────────────────────────

const IS_MAIN = process.argv[1]?.endsWith('ingest_vote.js');

const args = IS_MAIN ? process.argv.slice(2) : [];
const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const has = (flag) => args.includes(flag);

const houseArg   = get('--house');
const senateArg  = get('--senate');
const topicArg   = get('--topic');
const prefixArg  = get('--prefix');
const oppose     = has('--oppose');
const dryRun     = has('--dry-run');

if (IS_MAIN && !houseArg && !senateArg) {
    console.error('Usage: node ingest_vote.js --house YYYY/NNN | --senate CONGRESS/SESSION/NNN [--topic TOPIC] [--oppose] [--dry-run]');
    process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function slugify(str) {
    return str.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim();
}

function parseDate(str) {
    // Handles "20-May-2026", "May 20, 2026", "2026-05-20"
    const d = new Date(str.replace(/-/g, ' '));
    if (!isNaN(d)) {
        return d.toISOString().slice(0, 10);
    }
    return str;
}

// ── Alignment classification ─────────────────────────────────────────────────
//
// Rules (applied to the side that voted proVote):
//   - R majority voted proVote AND < DEM_CROSSOVER_PCT of Dems did → "toady"   (border: red)
//   - R majority voted proVote AND >= DEM_CROSSOVER_PCT of Dems did → "neutral" (border: gray)
//   - D majority voted proVote → "opposition"                                   (border: blue)
//
// DEM_CROSSOVER_PCT: if this fraction of Democrats vote with Republicans
// we call it a bipartisan/neutral vote rather than a party-line toady win.

const DEM_CROSSOVER_PCT = 0.25; // 25% of Dems crossing over = neutral

function classifyAlignment(partyVotes, proVote) {
    // partyVotes: { R: {pro: N, anti: N}, D: {pro: N, anti: N}, I: {pro: N, anti: N} }
    const rPro  = partyVotes.R?.pro  ?? 0;
    const rAnti = partyVotes.R?.anti ?? 0;
    const dPro  = partyVotes.D?.pro  ?? 0;
    const dAnti = partyVotes.D?.anti ?? 0;

    const rTotal = rPro + rAnti;
    const dTotal = dPro + dAnti;

    const rMajorityPro = rPro > rAnti;
    const dMajorityPro = dPro > dAnti;
    const demCrossoverRate = dTotal > 0 ? dPro / dTotal : 0;

    let label, result;

    if (rMajorityPro && !dMajorityPro) {
        if (demCrossoverRate >= DEM_CROSSOVER_PCT) {
            label = 'neutral';
            result = `Bipartisan (${Math.round(demCrossoverRate * 100)}% of Dems crossed over)`;
        } else {
            label = 'toady';
            result = `Toadies Won (R: ${rPro}-${rAnti}, D: ${dPro}-${dAnti})`;
        }
    } else if (dMajorityPro && !rMajorityPro) {
        label = 'opposition';
        result = `Opposition Held (D: ${dPro}-${dAnti}, R: ${rPro}-${rAnti})`;
    } else if (rMajorityPro && dMajorityPro) {
        label = 'neutral';
        result = `Bipartisan — both parties supported (R: ${rPro}-${rAnti}, D: ${dPro}-${dAnti})`;
    } else {
        label = 'neutral';
        result = `Split/unclear (R: ${rPro}-${rAnti}, D: ${dPro}-${dAnti})`;
    }

    return { label, result, rPro, rAnti, dPro, dAnti, demCrossoverRate };
}

// ── House ingestion ───────────────────────────────────────────────────────────

async function ingestHouse(yearRoll, topic, forceOppose, prefix) {
    const [year, roll] = yearRoll.split('/');
    const url = `https://clerk.house.gov/cgi-bin/vote.asp?year=${year}&rollnumber=${roll}`;
    console.log(`Fetching House vote: ${url}`);

    const xml = await fetchUrl(url);
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xml);

    const meta      = result['rollcall-vote']['vote-metadata'][0];
    const voteData  = result['rollcall-vote']['vote-data'][0]['recorded-vote'];

    const voteType  = meta['vote-type'][0];          // "YEA-AND-NAY" or "RECORDED VOTE"
    const legisNum  = meta['legis-num'][0].trim();   // "H R 2616"
    const voteDesc  = meta['vote-desc'][0].trim();   // "PROTECT Kids Act"
    const dateRaw   = meta['action-date'][0].trim(); // "20-May-2026"
    const date      = parseDate(dateRaw);

    // Determine vote values from vote-type
    const yesVote = voteType.includes('YEA') ? 'Yea' : 'Aye';
    const noVote  = voteType.includes('YEA') ? 'Nay' : 'No';
    const proVote = forceOppose ? noVote : yesVote;

    const legisNumClean = legisNum.replace(/\s+/g, '.').replace('H.R', 'hr').replace('H.CON.RES', 'hconres').replace('H.J.RES', 'hjres').replace('H.RES', 'hres').toLowerCase();
    const autoPrefix = prefix ?? `${legisNumClean}-${year}`;
    const eventId    = `${date}-${slugify(legisNum)}-${slugify(voteDesc.slice(0, 30))}`;
    const eventTitle = `${legisNum.replace(/\s+/g, '.')}: ${voteDesc}`;
    const sourceUrl  = `https://clerk.house.gov/Votes/${year}${roll.padStart(3, '0')}`;

    const subjects = JSON.parse(fs.readFileSync(path.join(__dirname, 'src/data/subjects.json'), 'utf8'));

    const actions = [];
    const partyVotes = { R: { pro: 0, anti: 0 }, D: { pro: 0, anti: 0 }, I: { pro: 0, anti: 0 } };
    let unmatched = 0;

    for (const rv of voteData) {
        const legislator = rv['legislator'][0];
        const bioguideId = legislator['$']['name-id'];
        const party      = legislator['$']['party'];
        const vote       = rv['vote'][0];

        if (vote === 'Not Voting' || vote === 'Present') continue;

        const subject = subjects.find(s => s.id === bioguideId);
        const alignment = vote === proVote ? 'pro' : 'anti';

        const p = party === 'R' ? 'R' : party === 'D' ? 'D' : 'I';
        if (partyVotes[p]) partyVotes[p][alignment]++;

        if (subject) {
            actions.push({
                id: `${autoPrefix}-${bioguideId}`,
                subjectId: bioguideId,
                date,
                topic: topic ?? 'Uncategorized',
                title: `Voted ${vote} on ${voteDesc}`,
                description: `Voted ${vote} on ${legisNum.replace(/\s+/g, '.')}: ${voteDesc}`,
                sourceUrl,
                alignment,
                eventId,
                eventTitle,
                chamber: 'house',
            });
        } else {
            unmatched++;
        }
    }

    const { label, result: classResult, rPro, rAnti, dPro, dAnti } = classifyAlignment(partyVotes, proVote);

    console.log(`\nVote: ${eventTitle}`);
    console.log(`Date: ${date} | Type: ${voteType} | proVote: "${proVote}"`);
    console.log(`Party breakdown: R ${rPro}-${rAnti} | D ${dPro}-${dAnti}`);
    console.log(`Classification: ${label.toUpperCase()} — ${classResult}`);
    console.log(`Matched: ${actions.length} | Unmatched: ${unmatched}`);

    return { actions, prefix: autoPrefix, eventId, label };
}

// ── Senate ingestion ──────────────────────────────────────────────────────────

async function ingestSenate(congressSessionRoll, topic, forceOppose, prefix) {
    const [congress, session, roll] = congressSessionRoll.split('/');
    const rollPadded = roll.padStart(5, '0');
    const url = `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${congress}${session}/vote_${congress}_${session}_${rollPadded}.xml`;
    console.log(`Fetching Senate vote: ${url}`);

    const xml = await fetchUrl(url);
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xml);

    const root        = result['roll_call_vote'];
    const voteTitle   = root['vote_title'][0].trim();
    const question    = root['question'][0].trim();
    const docText     = root['vote_document_text']?.[0]?.trim() ?? voteTitle;
    const dateRaw     = root['vote_date'][0].trim();  // "May 19, 2026, 04:47 PM"
    const date        = parseDate(dateRaw.split(',').slice(0, 2).join(','));
    const docEl       = root['document']?.[0];
    const legisNum    = docEl ? `${docEl['document_type'][0].trim()} ${docEl['document_number'][0].trim()}` : question;

    const proVote = forceOppose ? 'Nay' : 'Yea';

    // LIS → Bioguide map
    const legYaml = yaml.load(fs.readFileSync(path.join(__dirname, 'legislators-current.yaml'), 'utf8'));
    const lisMap = {};
    legYaml.forEach(leg => { if (leg.id.lis) lisMap[leg.id.lis] = leg.id.bioguide; });

    const subjects = JSON.parse(fs.readFileSync(path.join(__dirname, 'src/data/subjects.json'), 'utf8'));
    const members  = root['members'][0]['member'];

    const autoPrefix = prefix ?? `sen-${slugify(legisNum.slice(0, 20))}-${congress}-${session}`;
    const eventId    = `${date}-${slugify(legisNum)}-${slugify(voteTitle.slice(0, 30))}`;
    const eventTitle = `${legisNum}: ${docText.slice(0, 80)}${docText.length > 80 ? '…' : ''}`;
    const sourceUrl  = url;

    const actions = [];
    const partyVotes = { R: { pro: 0, anti: 0 }, D: { pro: 0, anti: 0 }, I: { pro: 0, anti: 0 } };
    let unmatched = 0;

    for (const m of members) {
        const lisId      = m['lis_member_id'][0];
        const vote       = m['vote_cast'][0];
        const party      = m['party'][0];
        const bioguideId = lisMap[lisId];

        if (vote === 'Not Voting' || vote === 'Present') continue;

        const alignment = vote === proVote ? 'pro' : 'anti';
        const p = party === 'R' ? 'R' : party === 'D' ? 'D' : 'I';
        if (partyVotes[p]) partyVotes[p][alignment]++;

        if (bioguideId) {
            const subject = subjects.find(s => s.id === bioguideId);
            if (subject) {
                actions.push({
                    id: `${autoPrefix}-${bioguideId}`,
                    subjectId: bioguideId,
                    date,
                    topic: topic ?? 'Uncategorized',
                    title: `Voted ${vote} on ${voteTitle}`,
                    description: `Voted ${vote} on ${legisNum}: ${docText}`,
                    sourceUrl,
                    alignment,
                    eventId,
                    eventTitle,
                    chamber: 'senate',
                });
            } else {
                unmatched++;
            }
        } else {
            console.warn(`  No Bioguide ID for LIS ${lisId} (${m['member_full'][0]})`);
            unmatched++;
        }
    }

    const { label, result: classResult, rPro, rAnti, dPro, dAnti } = classifyAlignment(partyVotes, proVote);

    console.log(`\nVote: ${eventTitle}`);
    console.log(`Date: ${date} | proVote: "${proVote}"`);
    console.log(`Party breakdown: R ${rPro}-${rAnti} | D ${dPro}-${dAnti}`);
    console.log(`Classification: ${label.toUpperCase()} — ${classResult}`);
    console.log(`Matched: ${actions.length} | Unmatched: ${unmatched}`);

    return { actions, prefix: autoPrefix, eventId, label };
}

// ── Write actions.json ────────────────────────────────────────────────────────

function saveActions(newActions, prefix) {
    const actionsPath = path.join(__dirname, 'src/data/actions.json');
    const existing    = JSON.parse(fs.readFileSync(actionsPath, 'utf8'));
    const filtered    = existing.filter(a => !a.id.startsWith(prefix));
    const all         = [...filtered, ...newActions];
    fs.writeFileSync(actionsPath, JSON.stringify(all, null, 2));
    console.log(`\nWrote ${newActions.length} actions (replaced prefix "${prefix}"). Total: ${all.length}`);
}

// ── Exports (for use by check_new_votes.js) ───────────────────────────────────

export { ingestHouse, ingestSenate, saveActions };

// ── Main (CLI) ────────────────────────────────────────────────────────────────

async function main() {
    let result;

    if (houseArg) {
        result = await ingestHouse(houseArg, topicArg, oppose, prefixArg);
    } else {
        result = await ingestSenate(senateArg, topicArg, oppose, prefixArg);
    }

    if (dryRun) {
        console.log('\n[dry-run] No files written.');
        console.log('Sample action:', JSON.stringify(result.actions[0], null, 2));
    } else {
        saveActions(result.actions, result.prefix);
    }
}

// Only run main() when invoked directly, not when imported as a module
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch(err => { console.error(err); process.exit(1); });
}
