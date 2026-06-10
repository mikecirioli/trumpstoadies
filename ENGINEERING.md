# Trump's Toadies — Engineering Guide

Everything a junior engineer needs to understand, maintain, and extend this application.

---

## What It Does

A public-facing static website that tracks every significant congressional vote and cabinet confirmation since Trump's inauguration (Jan 20, 2025), showing:

- Who voted with Trump vs. against him
- Party-line breakdowns (R/D Yea/Nay counts per vote)
- Per-legislator toadie scores and rankings
- AI-generated plain-English summaries of each bill, including "case for Yea" and "case for Nay"

**Live URL:** `https://cirioli.duckdns.org/toadies/`  
**Local (LAN):** `http://192.168.1.245:8100/toadies/`

---

## Architecture Overview

```
Developer machine (/export/git/3-bad-dogs/trumpstoadies/)
    │
    ├── src/                    Astro source (pages, layouts, data)
    ├── ingest_vote.js          Fetch + parse a single vote XML
    ├── check_new_votes.js      Cron-run poll for new votes
    ├── enrich_events.js        LLM enrichment (bill summaries)
    ├── generate_rankings.js    Compute toadie scores → rankings.json
    ├── backfill.js             One-time historical ingest (curated list)
    ├── full_backfill.js        One-time full historical ingest (all votes)
    └── package.json            npm scripts

optiplex server (/export/homeassistant/trumpstoadies/)
    │
    ├── data/                   ← LIVE DATA (bind-mounted into container)
    │   ├── actions.json        All vote records (48,611 actions, 136 events)
    │   ├── subjects.json       All legislators + admin officials
    │   ├── events_meta.json    LLM-generated summaries per event
    │   ├── rankings.json       Computed toadie scores
    │   └── lies.json           Manually curated (not yet used in UI)
    │
    ├── dist/                   ← BUILT SITE (bind-mounted, nginx serves this)
    ├── state/
    │   ├── .vote_state.json    Cron state (last seen roll numbers)
    │   └── .ingest.log         Cron activity log
    │
    └── docker-compose.yaml     Manages the trumpstoadies container
```

The container runs nginx (serves `dist/`) + crond + Node.js. The `data/`, `dist/`, and `state/` directories are **bind-mounted from the host** — you can read and edit them directly on optiplex without touching the container.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | [Astro](https://astro.build) v5 — static site generator |
| Styling | Plain CSS with CSS variables |
| Data ingestion | Node.js ESM scripts |
| Vote source (House) | clerk.house.gov rollcall XML API |
| Vote source (Senate) | senate.gov LIS XML API |
| LLM enrichment | Ollama (`mistral:7b-instruct`) at `localhost:11434` |
| Web server | nginx:alpine inside Docker |
| Container runtime | Docker with nvidia CDI runtime |
| Reverse proxy | nginx on optiplex (`reverse-proxy.conf`) |

---

## Data Files

### `actions.json`
The core dataset. One record per legislator per vote.

```json
{
  "id": "hr28-119-1-A000370",        // prefix-bioguideId
  "subjectId": "A000370",            // links to subjects.json
  "date": "2025-01-14",
  "topic": "Social Issues",          // Social Issues | Foreign Policy | Nominations
  "title": "Voted Nay on Protection of Women and Girls in Sports Act",
  "description": "Voted Nay on H.R. 28: ...",
  "sourceUrl": "https://clerk.house.gov/Votes/202512",
  "alignment": "anti",               // pro = voted with Trump, anti = voted against
  "eventId": "2025-01-14-hr28-sports-act",   // groups actions into events
  "eventTitle": "H.R. 28: Protection of Women and Girls in Sports Act",
  "chamber": "house"                 // house | senate
}
```

**`alignment` logic:** `pro` means the person voted on Trump's side. For most bills this is `Yea`; for war powers / anti-tariff resolutions it's `Nay` (because opposing the resolution = supporting Trump's action).

**`eventId`** is the URL slug for the event detail page. Every action in the same vote shares the same `eventId`. Actions without `eventId` are silently excluded from the UI.

### `subjects.json`
One record per tracked person (senators, representatives, admin officials).

```json
{
  "id": "A000370",           // bioguide ID (Congress) or name-slug (admin)
  "name": "Alma Adams",
  "type": "Representative",  // Senator | Representative | Admin Official
  "state": "NC",
  "party": "Democrat",       // Republican | Democrat | Independent
  "description": "Representative for NC",
  "url": "https://...",
  "phone": "202-225-1510",
  "contact_form": "https://...",
  "address": "2436 Rayburn House Office Building..."
}
```

### `events_meta.json`
LLM-generated enrichment, keyed by `eventId`.

```json
{
  "2025-01-14-hr28-sports-act": {
    "summary": "This bill prohibits transgender women from competing in female sports...",
    "why_yes": "Supporters argue it protects fairness in women's sports...",
    "why_no": "Opponents argue it discriminates against transgender youth...",
    "trump_signal": "Trump has explicitly campaigned on banning transgender athletes...",
    "tags": ["transgender", "women's sports", "Title IX"],
    "enriched": "2026-05-23T10:00:00Z"
  }
}
```

Missing entries fall back to the raw `description` field in the UI.

### `rankings.json`
Computed scores, regenerated by `generate_rankings.js`.

```json
{
  "generated": "2026-05-23T...",
  "senate": [{ "rank": 1, "partyRank": 1, "name": "Bill Cassidy", "score": 100.0, "pro": 26, "total": 26, ... }],
  "house": [...],
  "meta": { "totalEvents": 136, "senateEvents": 26, "houseEvents": 21 }
}
```

Score = `pro_votes / total_eligible_votes * 100`. Senate and House ranked separately (they vote on different bills). Minimum 3 votes to appear.

---

## npm Scripts

Run all of these from `/export/git/3-bad-dogs/trumpstoadies/` on the **developer machine**.

| Script | What it does |
|---|---|
| `npm run dev` | Local dev server at `localhost:4321/toadies/` with hot reload |
| `npm run build` | Build static site to `dist/` |
| `npm run enrich` | Run LLM enrichment on any events missing from `events_meta.json` (incremental — skips already-enriched) |
| `npm run rankings` | Regenerate `rankings.json` from current `actions.json` |
| `npm run update:enrich` | Same as `enrich` |
| `npm run update:rankings` | Same as `rankings` |
| `npm run update:deploy` | Build + rsync `dist/` to optiplex |
| `npm run update` | **Full pipeline:** enrich → rankings → build → rsync to optiplex |

### Standard deploy workflow

```bash
cd /export/git/3-bad-dogs/trumpstoadies
npm run update
```

That's it for a content + code change. The `rsync` in `update:deploy` pushes only changed files.

### Code-only deploy (no new votes)

```bash
npm run build
rsync -av --delete dist/ root@optiplex:/export/homeassistant/trumpstoadies/dist/
```

### Data-only deploy (new votes ingested, no code change)

```bash
# After running ingest_vote.js or backfill.js:
npm run rankings         # recompute scores
npm run enrich           # LLM-enrich any new events
npm run update:deploy    # build + push
# Also sync data files so server has the latest:
rsync -av src/data/ root@optiplex:/export/homeassistant/trumpstoadies/data/
```

---

## Automatic Update Pipeline (fully hands-off)

Once running, the system updates itself without any manual intervention:

```
Every 15 min (enrich_pending.js cron):
  ├── Check if laptop Ollama is reachable (192.168.1.47:11434, 3s timeout)
  ├── If offline → log "Ollama not reachable", exit (tries again in 15 min)
  └── If online → enrich any pending events → rebuild site

4x/day at 00:00, 06:00, 12:00, 18:00 UTC (check_new_votes.js cron):
  ├── Poll Senate XML for new votes since lastSenateRoll
  ├── Probe House rolls since lastHouseRoll
  ├── Ingest any new trackable votes into actions.json
  ├── Regenerate rankings.json
  └── Rebuild site (enrichment handled by separate 15-min cron)
```

**Laptop offline handling:** `enrich_pending.js` checks both `http://192.168.1.47:11434` (laptop LAN) and `http://localhost:11434`. If neither responds within 3 seconds, it exits cleanly and tries again at the next 15-min tick. No backlog builds up — it processes whatever is pending each time it runs.

**Failure tracking:** Events that fail enrichment after 3 attempts get flagged in `events_meta.json`:
```json
{
  "2025-XX-XX-some-event": {
    "failed": true,
    "attempts": 3,
    "gaveUp": true,
    "lastError": "No JSON found in response",
    "lastTried": "2026-05-23T..."
  }
}
```
These show up in the ingest log as `NEEDS MANUAL REVIEW`. They fall back to the raw description in the UI. To retry them, delete the entry from `events_meta.json` on optiplex and the next enrichment run will pick them up.

---

## Adding a New Vote Manually

Use `ingest_vote.js` directly:

```bash
# House vote
node ingest_vote.js --house 2026/205 --topic "Social Issues"

# Senate vote
node ingest_vote.js --senate 119/2/145 --topic "Nominations"

# Oppose flag — for votes where Nay = with Trump (war powers, anti-tariff resolutions)
node ingest_vote.js --senate 119/2/129 --topic "Foreign Policy" --oppose

# Dry run — see what would be ingested without writing anything
node ingest_vote.js --house 2026/205 --topic "Social Issues" --dry-run
```

**Finding vote identifiers:**
- House: `https://clerk.house.gov/Votes/YYYY` — find the roll number
- Senate: `https://www.senate.gov/legislative/votes_new.htm` — find the vote number and session

**After ingesting:**
```bash
npm run update  # or manually: rankings → enrich → deploy
```

---

## Cron Job (Auto-Ingestion)

The cron runs **inside the Docker container** on optiplex, 4x per day at midnight, 6am, noon, and 6pm UTC.

```
0 0,6,12,18 * * * /usr/bin/node /app/check_new_votes.js >> /app/state/.ingest.log 2>&1
```

### What the cron does

1. Fetches the Senate vote list XML for the current congress/session
2. Probes House roll numbers sequentially starting from `lastHouseRoll + 1`
3. For each new vote, checks if it should be tracked (question type + title filters)
4. If the topic can be inferred, ingests it via `ingestHouse`/`ingestSenate`
5. If topic can't be inferred, logs a warning with the manual ingest command
6. If any new votes were ingested, rebuilds the site and syncs `dist/` to nginx

### State file

`/export/homeassistant/trumpstoadies/state/.vote_state.json`:
```json
{
  "lastHouseRoll": 191,
  "lastSenateRoll": 130,
  "ingested": []
}
```

This tracks the highest roll number seen so the cron only checks new ones. **If you reset this to 0, the cron will re-probe everything from the beginning** (safe but slow).

### Ingest log

```bash
tail -50 /export/homeassistant/trumpstoadies/state/.ingest.log
```

Look for `WARNING: Could not infer topic` lines — those are votes the cron saw but skipped. Add them manually with `ingest_vote.js --topic "..."`.

### Updating for a new Congress session or year

Edit these constants at the top of `check_new_votes.js`:
```js
const CONGRESS = 119;   // update when 119th Congress ends
const SESSION  = 2;     // update when session changes (1=odd years, 2=even years)
const YEAR     = 2026;  // update each January
```

Then rebuild the container image:
```bash
cd /export/homeassistant/trumpstoadies
docker compose up -d --build
```

### Vote filtering logic

The cron only tracks votes with these `question` types:
- `On Passage`
- `On the Nomination`
- `On the Joint Resolution`
- `On the Resolution of Ratification`
- `On the Motion to Discharge`

And skips votes whose title matches: `providing for consideration|rule for consideration|previous question|cloture|adjourn|en bloc|motion to recommit|smithsonian|commemorat|post office`

**Topic inference** (used to classify tracked votes):
- `Nominations` — title contains: confirm, nominat, secretary, ambassador, judge, director, attorney general
- `Foreign Policy` — title contains: iran, ukraine, russia, china, taiwan, nato, war powers, sanction, tariff, trade
- `Social Issues` — title contains: immigration, border, transgender, abortion, gun, health, education, sport, etc.
- `Social Issues` — **default fallback** so nothing is dropped

---

## LLM Enrichment

### Dependencies

- **Ollama** at `http://localhost:11434` — must be running on the developer machine
- **Model:** `mistral:7b-instruct` (4.4GB, Q4_K_M) — must be installed
- **GPU:** NVIDIA RTX 1000 Ada (6GB VRAM) — enrichment takes ~5-8s/event on GPU vs ~60s on CPU

Check ollama is up: `curl http://localhost:11434/api/tags`  
Check model is installed: `ollama list | grep mistral`

### How it works

`enrich_events.js` reads `actions.json`, finds all unique events, skips any already in `events_meta.json`, and calls the Ollama API for each remaining one.

For each event it sends a prompt containing the bill title, description, topic, and chamber, and asks for JSON with 5 fields: `summary`, `why_yes`, `why_no`, `trump_signal`, `tags`.

Results are written to `events_meta.json` **after each successful event** so progress is saved if you interrupt it. Re-running is safe — it only processes missing entries.

### Re-enriching everything (e.g. after prompt changes)

```bash
echo '{}' > src/data/events_meta.json
npm run enrich
```

This wipes all enrichments and starts fresh. Takes ~15 minutes for 136 events on GPU.

### If enrichment fails for some events

The LLM occasionally returns non-JSON. Failed events are logged and skipped — they'll fall back to the raw description in the UI. Re-running `npm run enrich` will retry them.

```bash
# Check how many are enriched vs total events
node -e "
const m=JSON.parse(require('fs').readFileSync('src/data/events_meta.json'));
const a=JSON.parse(require('fs').readFileSync('src/data/actions.json'));
const total=[...new Set(a.filter(x=>x.eventId).map(x=>x.eventId))].length;
console.log(Object.keys(m).length+'/'+total+' enriched');
"
```

---

## Container Management

The container lives at `/export/homeassistant/trumpstoadies/` on optiplex, managed by its **own** `docker-compose.yaml` (separate from the main Home Assistant stack).

```bash
ssh root@optiplex

# Status
docker ps | grep trumpstoadies
docker logs trumpstoadies --tail 50

# Restart (nginx config change, no code change)
cd /export/homeassistant/trumpstoadies
docker compose restart

# Full rebuild (Dockerfile, nginx.conf, or script changes)
docker compose up -d --build

# Check cron is running inside container
docker exec trumpstoadies ps | grep cron
docker exec trumpstoadies cat /etc/crontabs/root

# Run the cron manually (test it)
docker exec trumpstoadies node /app/check_new_votes.js

# Check ingest log
tail -50 /export/homeassistant/trumpstoadies/state/.ingest.log
```

### When to rebuild the image

Rebuild (`docker compose up -d --build`) when you change:
- `Dockerfile`
- `nginx.conf`
- `check_new_votes.js` or `ingest_vote.js` (the scripts baked into the image)
- `astro.config.mjs` or any Astro source files

You do **not** need to rebuild for:
- Changes to `data/` files — bind-mounted, live immediately
- Changes to `dist/` — bind-mounted, nginx serves them immediately after rsync

### Bind mounts

| Host path | Container path | Purpose |
|---|---|---|
| `./data/` | `/app/src/data/` | Live data — actions, subjects, rankings, meta |
| `./state/` | `/app/state/` | Cron state file + ingest log |
| `./dist/` | `/app/dist/` and `/usr/share/nginx/html/` | Built site — written by cron builds, served by nginx |
| `./nginx.conf` | `/etc/nginx/conf.d/default.conf` | nginx routing config (read-only) |

---

## Reverse Proxy

The site is exposed via the main nginx reverse proxy on optiplex:

- **Config file:** `/export/homeassistant/nginx/conf.d/reverse-proxy.conf`  
- **Canonical source:** `mikecirioli/thingino-roku-viewer` repo root

The relevant block:
```nginx
location /toadies/ {
    proxy_pass http://192.168.1.245:8100;
    ...
}
```

`192.168.1.245` is optiplex's LAN IP. The site has **no auth** — it's public.

After editing `reverse-proxy.conf`, always:
```bash
ssh root@optiplex "nginx -t && nginx -s reload"
```

---

## Source Data — Where Votes Come From

### House votes
- **URL pattern:** `https://clerk.house.gov/cgi-bin/vote.asp?year=YYYY&rollnumber=NNN`
- Redirects to: `https://clerk.house.gov/evs/YYYY/rollNNN.xml`
- XML root: `<rollcall-vote>`, vote values: `Yea`/`Nay` or `Aye`/`No` (depends on vote type — the `<vote-type>` field says which)
- Legislator IDs: bioguide IDs directly in `name-id` attribute

### Senate votes
- **URL pattern:** `https://www.senate.gov/legislative/LIS/roll_call_votes/vote{congress}{session}/vote_{congress}_{session}_{rollnum:05d}.xml`
- Example: `https://www.senate.gov/legislative/LIS/roll_call_votes/vote1192/vote_119_2_00129.xml`
- XML root: `<roll_call_vote>`, vote values: `Yea`/`Nay`
- Legislator IDs: LIS IDs — must be mapped to bioguide IDs via `legislators-current.yaml`

### Senate vote list (for discovery)
- `https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_{congress}_{session}.xml`
- Lists all votes in a session with question, issue, title — used by `check_new_votes.js` to discover new votes

### `legislators-current.yaml`
This file maps LIS IDs (Senate internal) to bioguide IDs (the universal legislator ID). It's sourced from the [unitedstates/congress-legislators](https://github.com/unitedstates/congress-legislators) project. Update it when new senators are sworn in:

```bash
curl -sL https://raw.githubusercontent.com/unitedstates/congress-legislators/main/legislators-current.yaml \
  -o /export/git/3-bad-dogs/trumpstoadies/legislators-current.yaml
# Then copy to server:
rsync legislators-current.yaml root@optiplex:/export/homeassistant/trumpstoadies/
# And rebuild container (it's baked in):
ssh root@optiplex "cd /export/homeassistant/trumpstoadies && docker compose up -d --build"
```

---

## Pages

| URL | Source file | Description |
|---|---|---|
| `/toadies/` | `src/pages/index.astro` | Feed — all events, newest first, with vote breakdown and LLM summary |
| `/toadies/people/` | `src/pages/people.astro` | Directory of all tracked people, filterable |
| `/toadies/issues/` | `src/pages/issues.astro` | Events grouped by topic |
| `/toadies/rankings/` | `src/pages/rankings/index.astro` | Toadie leaderboard, Senate and House tabs |
| `/toadies/lies/` | `src/pages/lies.astro` | Manually curated (data from `lies.json`) |
| `/toadies/events/[id]/` | `src/pages/events/[id].astro` | Event detail — full vote breakdown + AI summary |
| `/toadies/subjects/[id]/` | `src/pages/subjects/[id].astro` | Person detail — all tracked votes, contact info |

All pages are statically generated at build time — there's no server-side rendering.

---

## Common Tasks

### "The cron ingested a junk vote, how do I remove it?"

Find the action ID prefix (e.g. `h-res-123-2026`) and delete those actions from `data/actions.json` on the server, then rebuild:

```bash
ssh root@optiplex
node -e "
const fs = require('fs');
const path = '/export/homeassistant/trumpstoadies/data/actions.json';
const data = JSON.parse(fs.readFileSync(path));
const filtered = data.filter(a => !a.id.startsWith('PREFIX-TO-REMOVE'));
fs.writeFileSync(path, JSON.stringify(filtered, null, 2));
console.log('Removed', data.length - filtered.length, 'actions');
"
# Then trigger a rebuild from dev machine:
npm run update:deploy
```

### "A vote was mis-classified as the wrong topic"

Edit the actions directly in `data/actions.json` on the server (change `topic` field), or re-ingest with the correct topic (which replaces all actions with that prefix):

```bash
node ingest_vote.js --house 2026/NNN --topic "Foreign Policy"
npm run update
```

### "The cron is skipping votes I want tracked"

Check the ingest log:
```bash
tail -100 /export/homeassistant/trumpstoadies/state/.ingest.log | grep WARNING
```

Manually ingest any skipped votes:
```bash
node ingest_vote.js --senate 119/2/NNN --topic "Social Issues"
npm run update
```

### "How do I see what's about to be ingested without writing anything?"

```bash
node ingest_vote.js --house 2026/NNN --topic "Social Issues" --dry-run
```

### "The site looks broken after a deploy"

Check the nginx is serving the right files:
```bash
ssh root@optiplex "curl -s -o /dev/null -w '%{http_code}' http://localhost:8100/toadies/"
# Should be 200

# Check for broken links
ssh root@optiplex "curl -s http://localhost:8100/toadies/ | grep -o 'href=\"//'"
# Should return nothing — double-slash means astro.config.mjs base URL was missing during build
```

If you see `//` links: `astro.config.mjs` was not present when the image was built. Ensure it's on the server and rebuild: `docker compose up -d --build`.

---

## Deployment Checklist

When making changes:

- [ ] Code changes only → `npm run build && rsync dist/ ...`
- [ ] New votes ingested → `npm run rankings && npm run enrich && npm run update:deploy` + sync `src/data/`
- [ ] `check_new_votes.js` or `ingest_vote.js` changed → also rebuild container image
- [ ] `astro.config.mjs` must always be present on the server before a container rebuild
- [ ] After any nginx config change → `nginx -t && nginx -s reload` on optiplex

---

## Repository Layout

```
/export/git/3-bad-dogs/trumpstoadies/
├── src/
│   ├── data/           JSON data files (source of truth during dev)
│   ├── pages/          Astro page components
│   ├── layouts/        Layout.astro (shared header/nav)
│   └── components/     (none currently)
├── dist/               Built output (gitignored, generated by npm run build)
├── .briefs/            Architecture decision docs
├── ingest_vote.js      Single-vote ingestion CLI + module
├── check_new_votes.js  Cron polling script
├── enrich_events.js    LLM enrichment script
├── generate_rankings.js Toadie score computation
├── backfill.js         Curated historical backfill (run once)
├── full_backfill.js    Full historical backfill (run once)
├── parse_rollcall_xml.js  Legacy script (used to seed original 6 events)
├── legislators-current.yaml  LIS→Bioguide mapping
├── astro.config.mjs    base: '/toadies' — MUST be present for correct URLs
├── nginx.conf          nginx config baked into container
└── docker-compose.yaml Container definition
```
