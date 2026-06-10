# Trump's Toadies

Tracks congressional votes and nominations aligned with (or opposing) Donald Trump's positions. Built with Astro, served via nginx in Docker, reverse-proxied at `cirioli.duckdns.org/toadies/`.

---

## Deployment

**Server**: `root@optiplex`  
**Deploy path**: `/export/homeassistant/trumpstoadies/`  
**Port**: 8100 → proxied at `/toadies/` via `/export/homeassistant/nginx/conf.d/reverse-proxy.conf`  
**Compose**: `/export/homeassistant/trumpstoadies/docker-compose.yaml` (separate from main HA compose)

### Standard deploy (content changes only)

```bash
cd /export/git/3-bad-dogs/trumpstoadies
npm run build
rsync -av --delete ./dist/ root@optiplex:/export/homeassistant/trumpstoadies/dist/
ssh root@optiplex "cd /export/homeassistant/trumpstoadies && docker compose restart"
```

The `dist/` folder is volume-mounted — no rebuild of the Docker image needed for content changes.

### Full rebuild (if Dockerfile or nginx.conf changed)

```bash
# Sync ALL required files first — astro.config.mjs must be present or links break
rsync -av \
  Dockerfile docker-compose.yaml docker-entrypoint.sh nginx.conf \
  astro.config.mjs tsconfig.json package.json package-lock.json \
  ingest_vote.js check_new_votes.js parse_rollcall_xml.js legislators-current.yaml \
  root@optiplex:/export/homeassistant/trumpstoadies/
rsync -av src/ root@optiplex:/export/homeassistant/trumpstoadies/src/
ssh root@optiplex "cd /export/homeassistant/trumpstoadies && docker compose up -d --build"
```

> **Important**: `astro.config.mjs` sets `base: '/toadies'`. If it's missing from the server build context, all internal links become `//broken`.


### Verify

```bash
ssh root@optiplex "curl -s -o /dev/null -w '%{http_code}' http://localhost:8100/toadies/"
```

---

## Adding a New Vote or Nomination

### Step 1: Get the XML

**House votes** — download the rollcall XML from:  
`https://clerk.house.gov/Votes/<year><rollnum>` → click "XML" link  
File format: `<rollcall-vote>` root element, legislator bioguide IDs in `name-id` attributes.  
Save as e.g. `hr1234_vote.xml` in the project root.

**Senate votes** — download from:  
`https://www.senate.gov/legislative/LIS/roll_call_votes/vote<congress><session>/vote_<congress>_<session>_<rollnum>.xml`  
File format: `<roll_call_vote>` root element, legislators identified by LIS ID.  
Save as e.g. `senate_vote_NNN.xml` in the project root.

### Step 2: Add a metadata block to `parse_rollcall_xml.js`

Add a new metadata object in the `run()` function following the existing pattern:

```js
const myVoteMetadata = {
    prefix: 'hr1234-119-2',          // unique prefix for this vote's action IDs
    date: '2026-06-01',              // vote date (YYYY-MM-DD)
    topic: 'Foreign Policy',         // Social Issues | Foreign Policy | Nominations
    title: 'Short Bill Title',       // used in individual action titles
    legisNum: 'H.R. 1234',          // bill/nomination number
    description: 'Long bill title for description field',
    sourceUrl: 'https://clerk.house.gov/Votes/2026NNN',
    proVote: 'Yea',                  // which vote value = "toady" alignment
    eventId: '2026-06-01-hr1234-short-slug',   // URL slug — must be unique
    eventTitle: 'H.R. 1234: Short Bill Title'  // shown in the feed and event page
};
```

Then call the appropriate parser at the bottom of `run()`:

```js
await parseHouseXML('hr1234_vote.xml', myVoteMetadata);   // House
await parseSenateXML('senate_vote_NNN.xml', myVoteMetadata); // Senate
```

> **Note on `proVote`**: set to the vote value that represents alignment WITH Trump.
> For most bills: `'Yea'`. For war powers / anti-Trump resolutions: `'Nay'` (voting against removal = supporting Trump's action).

### Step 3: Run the script

```bash
cd /export/git/3-bad-dogs/trumpstoadies
node parse_rollcall_xml.js
```

The script is additive — it replaces only actions matching its prefix, leaving everything else intact.

### Step 4: Build and deploy

```bash
npm run build
rsync -av --delete ./dist/ root@optiplex:/export/homeassistant/trumpstoadies/dist/
ssh root@optiplex "cd /export/homeassistant/trumpstoadies && docker compose restart"
```

---

## Adding a New Subject (person)

Subjects (legislators, cabinet officials) live in `src/data/subjects.json`.

- **Congressional legislators**: run `node merge_data.js` to pull from `legislators-current.yaml` (update that file first from the [unitedstates project](https://github.com/unitedstates/congress-legislators)).
- **Cabinet/admin officials**: edit the `cabinet` array directly in `merge_data.js`, then run it.

---

## Data Files

| File | Description |
|---|---|
| `src/data/actions.json` | All individual votes/actions. Each action has `eventId` + `eventTitle`. |
| `src/data/subjects.json` | All tracked people (legislators + admin officials). |
| `src/data/lies.json` | Manually curated lies/reversals. |
| `legislators-current.yaml` | Source of truth for congressional bioguide IDs → LIS IDs. Keep this current. |
| `*.xml` | Raw vote XML files downloaded from clerk.house.gov or senate.gov. |

### Required fields on each action

```json
{
  "id": "<prefix>-<bioguideId>",
  "subjectId": "<bioguideId>",
  "date": "YYYY-MM-DD",
  "topic": "Social Issues",
  "title": "Voted Yea on ...",
  "description": "Voted Yea on H.R. NNN: ...",
  "sourceUrl": "https://...",
  "alignment": "pro",
  "eventId": "YYYY-MM-DD-slug",
  "eventTitle": "Human-readable event title"
}
```

Missing `eventId` causes the action to be silently dropped from the feed.

---

## Local Dev

```bash
cd /export/git/3-bad-dogs/trumpstoadies
npm install
npm run dev        # http://localhost:4321/toadies/
npm run build      # builds to ./dist/
npm run preview    # preview the built site locally
```

## Known Issues

- Senator Armstrong (R-OK, LIS ID `S440`) is missing from `legislators-current.yaml` — his vote on S.J.Res. 185 was not ingested. Update the YAML when a new version is available.
- The `hr-iran-res-38-*` actions (House vote on H. Con. Res. 38, 2026-03-05) were produced by the now-superseded `parse_house.js` / `parse_house_v2.js` scripts. They have correct `eventId` values and don't need reprocessing.
