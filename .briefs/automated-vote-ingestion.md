# Brief: Automated Vote Ingestion Pipeline

**Status**: Ready to build  
**Date**: 2026-05-22  
**Verdict**: BUILD

---

## Problem

Adding a new vote to the site requires manual steps: download XML, edit a JS config file, run a script, build, deploy. Error-prone (we already had a `proVote: 'Yea'` vs `'Aye'` bug that silently misfiled 413 votes), and requires dev environment access to do something that's fundamentally a content update.

---

## What Automation Should Do

Given a vote identifier (House roll number + year, or Senate congress/session/roll number), the pipeline should:

1. Fetch the XML directly from the official source
2. Parse the metadata already in the XML (bill number, title, date, vote type)
3. Detect the correct `proVote` value by reading the XML
4. Determine alignment (which side = "with Trump") — this is the one step requiring human judgment or a rule
5. Ingest the votes into `actions.json`
6. Build the site and deploy

---

## Feasibility Analysis

### Data sources — confirmed accessible

**House XML**: `https://clerk.house.gov/cgi-bin/vote.asp?year=YYYY&rollnumber=NNN`  
Redirects to `https://clerk.house.gov/evs/YYYY/rollNNN.xml`. No auth, no API key. XML contains:
- `<legis-num>` — bill number
- `<vote-desc>` — bill title  
- `<action-date>` — vote date
- `<vote-type>` — "YEA-AND-NAY" vs "RECORDED VOTE" (determines `Yea`/`Nay` vs `Aye`/`No`)
- `<recorded-vote>` entries with bioguide `name-id` attributes and `<vote>` values

**Senate XML**: `https://www.senate.gov/legislative/LIS/roll_call_votes/vote{congress}{session}/vote_{congress}_{session}_{rollnum:05d}.xml`  
Direct fetch, no auth. XML contains equivalent metadata plus LIS member IDs.

**Senate vote list**: `https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_{congress}_{session}.xml`  
Machine-readable index of all votes in a session — useful for discovering new votes to consider tracking.

**House vote type → proVote mapping** (confirmed from data):
- `vote-type = YEA-AND-NAY` → proVote is `Yea` or `Nay`
- `vote-type = RECORDED VOTE` → proVote is `Aye` or `No`

### The one judgment call: alignment

"Which side is 'with Trump'?" can't be fully automated without a rule or human input. Options:

- **Simple rule**: `Yea`/`Aye` = pro-Trump by default, with an override flag for war powers / anti-Trump resolutions
- **Human flag at invocation**: `--pro-vote Nay` when the bill is something Trump opposed
- **Semi-automated**: script suggests alignment based on vote result + bill type, user confirms

The simplest and safest approach: default `Yea`/`Aye` = pro, with an explicit `--oppose` flag to flip it. Most legislation Trump supports passes with Yea/Aye.

---

## Proposed Design

### Single script: `ingest_vote.js`

```
node ingest_vote.js --house 2026/184
node ingest_vote.js --senate 119/2/129 --oppose
node ingest_vote.js --house 2026/184 --topic "Social Issues" --dry-run
```

**Arguments**:
- `--house YYYY/NNN` or `--senate CONGRESS/SESSION/NNN` — identifies the vote
- `--topic TOPIC` — one of `Social Issues | Foreign Policy | Nominations` (can be inferred from bill type with override)
- `--oppose` — flips alignment (proVote = Nay/No instead of Yea/Aye)
- `--dry-run` — prints what would be ingested without writing anything
- `--prefix PREFIX` — override the auto-generated action ID prefix

**What it does**:
1. Fetches XML from clerk.house.gov or senate.gov
2. Parses all metadata from XML (title, date, bill number, vote values)
3. Auto-detects proVote from `vote-type` field
4. Generates `eventId` slug from date + bill number
5. Maps legislators to bioguide IDs (House: direct from XML; Senate: via `legislators-current.yaml` LIS map)
6. Writes to `actions.json` (replacing any existing actions with same prefix)
7. Reports: N matched, M unmatched, alignment summary

### Optional: `deploy.sh`

Wraps the full pipeline:
```bash
./deploy.sh          # build + rsync + restart
./ingest_vote.js ... # then ./deploy.sh
```

Or add an npm script: `npm run deploy`.

---

## What's Not Automated (intentional scope limits)

- **Topic classification**: requires judgment. Could add a `--topic` prompt but not auto-detected.
- **Deciding which votes to track**: this is editorial. The pipeline ingests a vote you've already decided to track.
- **`legislators-current.yaml` refresh**: should be a separate periodic task (`node fetch_congress.js`).

---

## Files to Create / Modify

| File | Action |
|---|---|
| `ingest_vote.js` | New — unified fetcher + parser replacing `parse_rollcall_xml.js` for new votes |
| `deploy.sh` | New — wraps build + rsync + restart |
| `package.json` | Add `"deploy"` and `"ingest"` npm scripts |
| `parse_rollcall_xml.js` | Keep as-is (legacy, still needed to re-run existing votes) |
| `README.md` | Update workflow section |

---

## Risks

- **Senate LIS → Bioguide gaps**: Armstrong (S440) is already missing. New senators may also be absent. Script should log unmatched clearly.
- **XML schema changes**: Both sources have been stable for years but are undocumented. Add schema validation / error on unexpected structure.
- **`Aye`/`No` vs `Yea`/`Nay`**: handled by reading `<vote-type>` from XML — no longer a manual footgun.
- **Rate limiting**: fetching one XML file per invocation, not a concern.

---

## Estimated Effort

**Core script** (`ingest_vote.js`): ~3–4 hours  
**Deploy wrapper** (`deploy.sh` + npm scripts): ~30 min  
**README update**: ~15 min  

Total: **half a day**.
