# CONTINUE.md - Trump's Toadies

## Current State (May 2026)

Site is fully functional. All 1,555 actions across 6 events are visible.

**Live at**: `cirioli.duckdns.org/toadies/`

### Events in the feed

| eventId | Date | Topic | Actions |
|---|---|---|---|
| `2025-01-14-hr28-sports-act` | 2025-01-14 | Social Issues | 417 |
| `2025-01-24-hegseth-confirmation` | 2025-01-24 | Nominations | 100 |
| `2026-03-04-iran-war-powers-resolution` | 2026-03-04 | Foreign Policy | 99 |
| `2026-03-05-iran-war-powers-resolution` | 2026-03-05 | Foreign Policy | 430 |
| `2026-05-19-sjres185-iran-war-powers` | 2026-05-19 | Foreign Policy | 96 |
| `2026-05-20-hr2616-protect-kids-act` | 2026-05-20 | Social Issues | 413 |

---

## How to deploy / add votes

See **README.md** — it has the full workflow for adding new votes and deploying.

---

## Known issues

- Senator Armstrong (R-OK, LIS `S440`) missing from `legislators-current.yaml` — 1 vote not ingested from S.J.Res. 185.
- Container is managed separately from the main HA docker-compose. Start with:
  `ssh root@optiplex "cd /export/homeassistant/trumpstoadies && docker compose up -d"`
