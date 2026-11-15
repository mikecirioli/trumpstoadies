# CONTINUE.md - Trump's Toadies Project

## November 13–15, 2026 Overhaul & Production Launch Summary

### 1. Production Hosting & DNS Configuration
* **GitHub Pages**: Configured automated CI/CD pipeline via GitHub Actions (`.github/workflows/deploy.yml`) building the Astro static site and publishing to GitHub Pages on repository `3-bad-dogs/trumpstoadies`.
* **Primary Domain**: `trumpstoadies.com` with enforced HTTPS via Let's Encrypt / GitHub Pages.
* **Alias Domain**: `trumpsbootlickers.com` configured to permanently redirect (301) to `trumpstoadies.com`.
* **Optiplex Mirror**: Static builds synced directly to `/export/homeassistant/trumpstoadies/dist/` and served at `https://cirioli.duckdns.org/toadies/`.

### 2. Data Pipeline & Vote Synchronization
* **Data Refresh**: Ingested and enriched all House and Senate roll-call votes through November 12, 2026 (258 tracked roll-call votes total: 183 House, 75 Senate).
* **AI Synthesis**: Event metadata synthesized and enriched with non-partisan summaries, Trump alignment signals, and "why yes / why no" arguments (`events_meta.json`).
* **Member Rankings**: Computed loyalty rankings across all 532 sitting members of the 119th Congress (`rankings.json`).
* **Automated Checker**: `check_new_votes.js` checks Senate (`vote_menu_119_2.xml`) and House live feeds and triggers builds upon new votes.

### 3. Site Redesign & Key Features
* **Interactive Scoreboard & Delegation Map** (`src/components/ScoreboardMap.astro`):
  * Pure SVG choropleth of all 50 states color-coded by delegation Trump loyalty or midterm seat change.
  * Zoom and pan controls, auto-fit on load, and alphabetical state jump dropdown.
  * Interactive delegation card listing Senators and Representatives with individual loyalty scores and links.
* **Congressional Outliers & Spotlights** (`src/components/LeaderboardTabs.astro`):
  * **Top Loyalists**: Highest loyalty scores across Congress.
  * **Crossover Democrats**: Democratic members voting most frequently with Trump's agenda.
  * **Rare GOP Defectors**: Republican lawmakers breaking ranks most often.
  * **Live Search**: Client-side instant filter across all 532 members by name, state, party, and chamber.
* **Site Explainer & Methodology** (`src/components/SiteExplainer.astro`, `src/pages/about.astro`):
  * Clear guide to badge definitions, data provenance (`senate.gov`, `clerk.house.gov`), and loyalty score math.
* **2026 Midterm Election Cross-Correlation** (`src/components/MidtermAnalysis.astro`):
  * Interactive Cook PVI vs Loyalty Score quadrant scatter plot visualizer.
  * "Loyalty Penalty" analysis in swing districts (88.9% defeat rate for swing GOP with >93% loyalty).
  * Map overlay layer toggle (Loyalty Heatmap vs 2026 Midterm Shift).
  * Incumbent accountability table tagging ousted and retiring lawmakers in the post-election lame-duck session.
* **Trump's Lies & Snopes Fact-Checks** (`src/pages/lies.astro`, `src/data/lies.json`):
  * Curated false and misleading statements investigated and rated by Snopes.
  * Instant search and topic filter pills.
  * Direct links to primary source transcripts and Snopes investigations.
* **Site Footer**:
  * Displays dynamic last updated date and total roll-call vote count from `rankings.json`.

---

## Historical Context: May & June 2026

### May 22, 2026 (Initial Astro Migration)
* Resolved Nginx subpath routing under `/toadies/` by setting `alias /usr/share/nginx/html/;` in container configuration.

### June 12, 2026 (Ollama Enrichment Investigation)
* Investigated container cron data stagnation; identified unreachable Ollama endpoint when host/laptop firewall blocked port 11434. Subsequent enrichments run reliably.
