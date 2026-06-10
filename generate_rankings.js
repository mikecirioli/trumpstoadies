#!/usr/bin/env node
/**
 * generate_rankings.js
 * Reads src/data/actions.json and src/data/subjects.json,
 * computes toadie rankings, and writes src/data/rankings.json.
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const actions = JSON.parse(readFileSync(join(__dirname, 'src/data/actions.json'), 'utf8'));
const subjects = JSON.parse(readFileSync(join(__dirname, 'src/data/subjects.json'), 'utf8'));

// ── Helper: determine chamber of an action ──────────────────────────────────
function actionChamber(action) {
    if (action.chamber) return action.chamber;
    // Fall back to id prefix
    return action.id.startsWith('sen-') ? 'senate' : 'house';
}

// ── Build event sets by chamber ──────────────────────────────────────────────
// Each unique eventId maps to a chamber
const eventChamber = new Map(); // eventId -> 'senate' | 'house'
for (const a of actions) {
    if (a.eventId && !eventChamber.has(a.eventId)) {
        eventChamber.set(a.eventId, actionChamber(a));
    }
}

const senateEventIds = new Set([...eventChamber.entries()].filter(([, c]) => c === 'senate').map(([id]) => id));
const houseEventIds  = new Set([...eventChamber.entries()].filter(([, c]) => c === 'house').map(([id]) => id));

const totalSenateEvents = senateEventIds.size;
const totalHouseEvents  = houseEventIds.size;

// ── Index actions by subjectId ───────────────────────────────────────────────
const actionsBySubject = new Map(); // subjectId -> action[]
for (const a of actions) {
    if (!actionsBySubject.has(a.subjectId)) actionsBySubject.set(a.subjectId, []);
    actionsBySubject.get(a.subjectId).push(a);
}

// ── Score legislators ────────────────────────────────────────────────────────
const MIN_VOTES = 3;

function scoreSubject(subject, chamberEventIds) {
    const subjectActions = actionsBySubject.get(subject.id) ?? [];
    // eligible = actions whose eventId is in the chamber's event set
    const eligible = subjectActions.filter(a => a.eventId && chamberEventIds.has(a.eventId));
    const total = eligible.length;
    if (total < MIN_VOTES) return null;
    const pro = eligible.filter(a => a.alignment === 'pro').length;
    const score = Math.round((pro / total) * 1000) / 10; // 1 decimal
    return { subjectId: subject.id, name: subject.name, party: subject.party ?? 'Unknown', state: subject.state ?? '', score, pro, total };
}

// ── Senate rankings ──────────────────────────────────────────────────────────
const senators = subjects.filter(s => s.type === 'Senator');
const senateRaw = senators
    .map(s => scoreSubject(s, senateEventIds))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

// Assign ranks
let rank = 0;
let prevScore = null;
let sameRankCount = 0;
const senateRanked = senateRaw.map((entry, i) => {
    if (entry.score !== prevScore) {
        rank = i + 1;
        sameRankCount = 1;
    } else {
        sameRankCount++;
    }
    prevScore = entry.score;
    return { ...entry, rank };
});

// Party ranks within senate
const senateByParty = new Map();
for (const entry of senateRanked) {
    if (!senateByParty.has(entry.party)) senateByParty.set(entry.party, []);
    senateByParty.get(entry.party).push(entry);
}
const senate = senateRanked.map(entry => {
    const partyList = senateByParty.get(entry.party);
    const partyIdx = partyList.findIndex(e => e.subjectId === entry.subjectId);
    return { ...entry, partyRank: partyIdx + 1 };
});

// ── House rankings ───────────────────────────────────────────────────────────
const reps = subjects.filter(s => s.type === 'Representative');
const houseRaw = reps
    .map(s => scoreSubject(s, houseEventIds))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

rank = 0;
prevScore = null;
const houseRanked = houseRaw.map((entry, i) => {
    if (entry.score !== prevScore) {
        rank = i + 1;
    }
    prevScore = entry.score;
    return { ...entry, rank };
});

const houseByParty = new Map();
for (const entry of houseRanked) {
    if (!houseByParty.has(entry.party)) houseByParty.set(entry.party, []);
    houseByParty.get(entry.party).push(entry);
}
const house = houseRanked.map(entry => {
    const partyList = houseByParty.get(entry.party);
    const partyIdx = partyList.findIndex(e => e.subjectId === entry.subjectId);
    return { ...entry, partyRank: partyIdx + 1 };
});

// ── Admin Officials ──────────────────────────────────────────────────────────
// Admin Officials are not elected; they don't vote on bills.
// We track their "pro" actions (public support, endorsements, etc.)
// and rank them by pro action count descending.
const adminOfficials = subjects.filter(s => s.type === 'Admin Official');
const adminRaw = adminOfficials.map(subject => {
    const subjectActions = actionsBySubject.get(subject.id) ?? [];
    const pro = subjectActions.filter(a => a.alignment === 'pro').length;
    const anti = subjectActions.filter(a => a.alignment === 'anti').length;
    const total = subjectActions.length;
    if (total === 0) return null;
    return { subjectId: subject.id, name: subject.name, party: subject.party ?? 'Unknown', state: subject.state ?? '', pro, anti, total };
}).filter(Boolean).sort((a, b) => b.pro - a.pro || a.name.localeCompare(b.name));

const admin = adminRaw.map((entry, i) => ({ ...entry, rank: i + 1 }));

// ── Output ───────────────────────────────────────────────────────────────────
const output = {
    generated: new Date().toISOString(),
    senate,
    house,
    admin,
    meta: {
        totalEvents: eventChamber.size,
        senateEvents: totalSenateEvents,
        houseEvents: totalHouseEvents,
    },
};

const outPath = join(__dirname, 'src/data/rankings.json');
writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`Written: ${outPath}`);
console.log(`Senate: ${senate.length} ranked, House: ${house.length} ranked, Admin: ${admin.length}`);
console.log(`Meta: ${output.meta.totalEvents} total events (${output.meta.senateEvents} senate, ${output.meta.houseEvents} house)`);
console.log('\nTop 3 Senate:');
senate.slice(0, 3).forEach(e => console.log(`  #${e.rank} ${e.name} (${e.party}, ${e.state}) ${e.score}% (${e.pro}/${e.total})`));
console.log('\nTop 3 House:');
house.slice(0, 3).forEach(e => console.log(`  #${e.rank} ${e.name} (${e.party}, ${e.state}) ${e.score}% (${e.pro}/${e.total})`));
