# Brief: Static Deployment Pipeline — GitHub Pages + Custom Domain

**Status**: Ready to build  
**Date**: 2026-05-23  
**Verdict**: BUILD — straightforward, ~1 hour

---

## Problem

The site runs on optiplex behind a DuckDNS domain. Publishing it publicly under a real domain requires a static host. The ingest/build pipeline already runs on the host; we just need a deploy step that pushes the built `dist/` to GitHub Pages after each successful build.

---

## Current State

- Container cron (4x/day) ingests new votes → rebuilds `dist/` → written to bind-mount at `/export/homeassistant/trumpstoadies/dist/`
- nginx in the container serves that `dist/` at `cirioli.duckdns.org/toadies/`
- `astro.config.mjs` has `base: '/toadies'` — must change to `'/'` for a root-domain deployment
- Host has `git 2.34.1`, active crontab, SSH key infrastructure already in place (DuckDNS script runs via cron)

---

## Proposed Design

### Two-config approach

Keep the existing `/toadies`-prefixed build for local use on optiplex. Add a separate build target for the public deployment with `base: '/'`.

`astro.config.mjs` stays as-is (local). A second config `astro.config.public.mjs` with `base: '/'` is used only by the deploy script.

```js
// astro.config.public.mjs
export default defineConfig({ base: '/' });
```

Astro supports `--config` flag: `astro build --config astro.config.public.mjs`

### Host deploy script: `push-deploy.sh`

Lives at `/export/homeassistant/trumpstoadies/push-deploy.sh`. Run by host crontab, offset from the container cron by ~10 min to let the build finish.

```bash
#!/bin/bash
# Rebuild with public base URL, push to GitHub Pages
DEPLOY_REPO=~/gh-pages/trumpstoadies   # shallow clone of the gh-pages branch
SITE_DIR=/export/homeassistant/trumpstoadies

cd $SITE_DIR

# Build with public config (reads live data from bind-mount)
npm run build -- --config astro.config.public.mjs

# Push to GitHub Pages repo
rsync -av --delete --exclude='.git' dist-public/ $DEPLOY_REPO/
cd $DEPLOY_REPO
git add -A
git diff --cached --quiet && exit 0   # nothing changed, skip push
git commit -m "deploy: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git push origin gh-pages
```

### GitHub Pages repo setup

- New **public** repo: `mikecirioli/trumpstoadies` (or whatever domain slug fits)
- Single `gh-pages` branch — GitHub Pages serves from branch root
- Custom domain: add `CNAME` file containing the domain (e.g. `trumpstoadies.vote`)
- GitHub repo Settings → Pages → Custom domain → enforce HTTPS

### Cron schedule

Container cron fires at `0 0,6,12,18` UTC. Host deploy cron fires 15 min later:

```cron
15 0,6,12,18 * * * /export/homeassistant/trumpstoadies/push-deploy.sh >> /export/homeassistant/trumpstoadies/state/.deploy.log 2>&1
```

---

## Files to Create / Modify

| File | Action |
|---|---|
| `astro.config.public.mjs` | New — `base: '/'`, used only for public builds |
| `push-deploy.sh` | New — rebuild with public config + git push to gh-pages |
| Host crontab | Add deploy entry offset 15 min from container cron |
| GitHub repo | New public repo with gh-pages branch + CNAME |
| `.gitignore` in deploy repo | Exclude nothing — full dist goes in |

---

## DNS

Point your domain's A/CNAME records at GitHub Pages IPs:
```
A     185.199.108.153
A     185.199.109.153
A     185.199.110.153
A     185.199.111.153
```
Or CNAME to `mikecirioli.github.io` if using a subdomain.

GitHub handles the Let's Encrypt cert automatically once the DNS propagates.

---

## Risks / Gotchas

- **Two configs, one data source**: both builds read from the same bind-mounted `data/` — no duplication, but the public build must run after the container has written updated data. The 15-min offset handles this.
- **Build output dir collision**: `astro build` defaults to `dist/`. The public build needs `outDir: 'dist-public'` in the public config to avoid clobbering the local nginx dist.
- **SSH key on host**: `push-deploy.sh` needs the host's SSH key to have push access to the GitHub repo. Already works for other git operations — just needs the new repo added.
- **First deploy**: shallow clone the gh-pages branch to `~/gh-pages/trumpstoadies/` once manually, then the script handles subsequent pushes.
- **Rate limiting**: 4 pushes/day is well within GitHub's limits.

---

## Estimated Effort

- `astro.config.public.mjs` + `outDir` tweak: 5 min
- `push-deploy.sh`: 15 min
- GitHub repo + Pages config + CNAME: 10 min
- DNS records: 5 min (propagation: up to 1hr)
- Host crontab entry: 2 min

**Total: ~45 minutes to live**
