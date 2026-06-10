#!/usr/bin/env node
/**
 * backfill.js — ingest all historical votes since inauguration.
 * Run once from the project root: node backfill.js
 * Safe to re-run — each vote uses a unique prefix so duplicates replace themselves.
 */

import { ingestHouse, ingestSenate, saveActions } from './ingest_vote.js';

const VOTES = [
    // ── Senate nominations ────────────────────────────────────────────────────
    { chamber:'senate', id:'119/1/33',  topic:'Nominations',    oppose:false, note:'Pamela Bondi - Attorney General' },
    { chamber:'senate', id:'119/1/37',  topic:'Nominations',    oppose:false, note:'Russell Vought - OMB Director' },
    { chamber:'senate', id:'119/1/50',  topic:'Nominations',    oppose:false, note:'Tulsi Gabbard - DNI' },
    { chamber:'senate', id:'119/1/52',  topic:'Nominations',    oppose:false, note:'RFK Jr. - HHS Secretary' },
    { chamber:'senate', id:'119/1/57',  topic:'Nominations',    oppose:false, note:'Howard Lutnick - Commerce Secretary' },
    { chamber:'senate', id:'119/1/61',  topic:'Nominations',    oppose:false, note:'Kash Patel - FBI Director' },
    { chamber:'senate', id:'119/1/99',  topic:'Nominations',    oppose:false, note:'Linda McMahon - Education Secretary' },
    { chamber:'senate', id:'119/1/141', topic:'Nominations',    oppose:false, note:'Jay Bhattacharya - NIH Director' },
    { chamber:'senate', id:'119/1/143', topic:'Nominations',    oppose:false, note:'Martin Makary - FDA Commissioner' },
    { chamber:'senate', id:'119/1/167', topic:'Nominations',    oppose:false, note:'Dr. Oz - CMS Administrator' },
    { chamber:'senate', id:'119/1/168', topic:'Nominations',    oppose:false, note:'Harmeet Dhillon - Asst. AG' },
    { chamber:'senate', id:'119/1/234', topic:'Nominations',    oppose:false, note:'Frank Bisignano - SSA Commissioner' },
    { chamber:'senate', id:'119/1/291', topic:'Nominations',    oppose:false, note:'Michelle Bowman - Fed Vice Chair' },
    { chamber:'senate', id:'119/2/63',  topic:'Nominations',    oppose:false, note:'Markwayne Mullin - DHS Secretary' },
    { chamber:'senate', id:'119/2/120', topic:'Nominations',    oppose:false, note:'Kevin Warsh - Fed Chair' },

    // ── Senate legislation ────────────────────────────────────────────────────
    { chamber:'senate', id:'119/1/92',  topic:'Social Issues',  oppose:false, note:'SJRes11 - Disapprove CFPB Overdraft Rule' },
    { chamber:'senate', id:'119/1/133', topic:'Social Issues',  oppose:false, note:'HR1968 - Full-Year CR 2025' },
    { chamber:'senate', id:'119/1/160', topic:'Foreign Policy', oppose:true,  note:'SJRes37 - Terminate Canada tariff emergency' },
    { chamber:'senate', id:'119/1/225', topic:'Foreign Policy', oppose:true,  note:'SJRes49 - Terminate broad tariff emergency' },
    { chamber:'senate', id:'119/1/372', topic:'Social Issues',  oppose:false, note:'HR1 - One Big Beautiful Act' },
    { chamber:'senate', id:'119/1/411', topic:'Social Issues',  oppose:false, note:'HR4 - Rescissions Act' },
    { chamber:'senate', id:'119/1/594', topic:'Foreign Policy', oppose:true,  note:'SJRes81 - Terminate China tariff emergency' },
    { chamber:'senate', id:'119/1/599', topic:'Social Issues',  oppose:false, note:'SJRes80 - Disapprove CA vehicle emissions waiver' },

    // ── House votes ───────────────────────────────────────────────────────────
    { chamber:'house',  id:'2025/17',   topic:'Social Issues',  oppose:false, note:'HR30 - Preventing Violence Against Women by Illegal Aliens Act' },
    { chamber:'house',  id:'2025/23',   topic:'Social Issues',  oppose:false, note:'S5 - Laken Riley Act' },
    { chamber:'house',  id:'2025/27',   topic:'Social Issues',  oppose:false, note:'HR21 - Born-Alive Abortion Survivors Protection Act' },
    { chamber:'house',  id:'2025/35',   topic:'Social Issues',  oppose:false, note:'HR26 - Protecting American Energy Production Act' },
    { chamber:'house',  id:'2025/52',   topic:'Social Issues',  oppose:false, note:'HJRes35 - Disapprove EPA Methane rule' },
    { chamber:'house',  id:'2025/71',   topic:'Social Issues',  oppose:false, note:'HJRes25 - Disapprove IRS Crypto reporting rule' },
    { chamber:'house',  id:'2025/96',   topic:'Social Issues',  oppose:false, note:'SJRes18 - Disapprove CFPB Overdraft rule (House)' },
    { chamber:'house',  id:'2025/98',   topic:'Social Issues',  oppose:false, note:'HR1526 - No Rogue Rulings Act' },
    { chamber:'house',  id:'2025/102',  topic:'Social Issues',  oppose:false, note:'HR22 - SAVE Act (voter ID)' },
    { chamber:'house',  id:'2025/111',  topic:'Social Issues',  oppose:false, note:'HJRes87 - Disapprove CA vehicle emissions standards' },
    { chamber:'house',  id:'2025/122',  topic:'Social Issues',  oppose:false, note:'HR276 - Gulf of America Act' },
    { chamber:'house',  id:'2025/145',  topic:'Social Issues',  oppose:false, note:'HR1 - One Big Beautiful Act (House passage)' },
    { chamber:'house',  id:'2025/163',  topic:'Social Issues',  oppose:false, note:'HR884 - Non-Citizen Voting Ban amendment' },
    { chamber:'house',  id:'2025/168',  topic:'Social Issues',  oppose:false, note:'HR4 - Rescissions Act (House)' },
    { chamber:'house',  id:'2025/264',  topic:'Social Issues',  oppose:false, note:'HR3486 - Stop Illegal Entry Act' },
    { chamber:'house',  id:'2026/38',   topic:'Social Issues',  oppose:false, note:'HJRes140 - Disapprove BLM public lands withdrawal' },
    { chamber:'house',  id:'2026/65',   topic:'Foreign Policy', oppose:true,  note:'HJRes72 - Terminate Canada tariff emergency (House)' },
    { chamber:'house',  id:'2026/94',   topic:'Social Issues',  oppose:false, note:'HR1958 - Deporting Fraudsters Act' },
];

async function main() {
    let ok = 0, failed = 0;

    for (const v of VOTES) {
        console.log(`\n── ${v.note} (${v.chamber} ${v.id}) ──`);
        try {
            const result = v.chamber === 'house'
                ? await ingestHouse(v.id, v.topic, v.oppose, null)
                : await ingestSenate(v.id, v.topic, v.oppose, null);
            saveActions(result.actions, result.prefix);
            console.log(`  ✓ ${result.actions.length} actions  [${result.label}]`);
            ok++;
        } catch (e) {
            console.error(`  ✗ FAILED: ${e.message}`);
            failed++;
        }
    }

    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Done: ${ok} succeeded, ${failed} failed`);
}

main().catch(err => { console.error(err); process.exit(1); });
