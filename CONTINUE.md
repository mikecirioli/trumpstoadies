# CONTINUE.md - Trump's Toadies Project - May 22, 2026

## Summary of Work Done Today:

Today's work focused on resolving persistent link errors on the `trumpstoadies` Astro site, which were caused by Nginx misconfigurations when handling requests with the `/toadies/` subpath.

**Key Issues & Actions:**

*   **Link Errors:** Top-level navigation links and "View All Votes & Details" links were found to be broken, returning 404 errors.
*   **Nginx Routing Problem:** The root cause was identified as Nginx's inability to correctly route requests for `/toadies/*` to the statically served Astro build files located in `/usr/share/nginx/html/` within the Docker container.
*   **Iterative Nginx Configuration Attempts:** Several Nginx configuration adjustments were made:
    *   Modified `trumpstoadies/nginx.conf` to include `absolute_redirect off;` (which did not resolve the issue).
    *   Adjusted `proxy_pass` in the main `reverse-proxy.conf`.
    *   Explored `Dockerfile` and `docker-compose.yaml` for correct volume mounting of the Nginx configuration.
*   **Final Nginx Configuration:** The core fix involved modifying `trumpstoadies/nginx.conf` to include a specific `location /toadies/` block with an `alias /usr/share/nginx/html/;` directive. This correctly maps requests starting with `/toadies/` to the root of the static assets served by Nginx.
*   **Redeployment:** The `trumpstoadies` Docker container was rebuilt and redeployed after updating the `nginx.conf` and ensuring it was correctly mounted into the container via `docker-compose.yaml`.
*   **Verification:** Manual checks of the critical navigation links were performed to confirm functionality.

## Data Update Issue Investigation (June 12, 2026):

**Problem:** `trumpstoadies` has not been getting new data since June 11th, contrary to its expected daily update schedule.

**Initial Investigation Steps & Findings:**

1.  **Checked Docker container logs for `trumpstoadies` on `optiplex`:** Logs revealed primarily Nginx access logs, indicating the container was serving web content.
2.  **Inspected `trumpstoadies/data` directory on `optiplex`:** Confirmed that `actions.json`, `events_meta.json`, and `rankings.json` were last updated on June 11th, around 00:00-00:15 UTC. `lies.json` and `subjects.json` were older. This confirmed the user's observation of no new data today.
3.  **Checked host cron jobs (`crontab -l` for root and mcirioli) on `optiplex`:** No `trumpstoadies`-related cron jobs were found.
4.  **Read `trumpstoadies/Dockerfile`:** Discovered that cron is intended to run *inside* the `trumpstoadies` Docker container, managing data ingestion and enrichment scripts (`check_new_votes.js`, `enrich_pending.js`). Cron jobs write output to `/app/state/.ingest.log` inside the container.
5.  **Read `trumpstoadies/docker-entrypoint.sh`:** Confirmed `dcron` is explicitly started in the background (`crond -b -l 8`) when the container starts.
6.  **Inspected `/app/state/.ingest.log` inside the container (`docker exec trumpstoadies cat /app/state/.ingest.log`):**
    *   Found numerous `"/usr/local/bin/node: not found"` errors at the beginning, suggesting a PATH issue for `node` within the cron environment.
    *   Crucially, found repeated entries starting June 11th around `09:00:04.830Z` stating **`[enrich] Ollama not reachable — skipping enrichment`**. This is the direct cause of the data not being updated.
7.  **Verified `node` path inside container (`docker exec trumpstoadies which node`):** Confirmed `node` is at `/usr/bin/node`, indicating the `/usr/local/bin/node` error might be a cron-specific PATH issue.
8.  **Pinged `192.168.1.47` from inside the container (`docker exec trumpstoadies ping -c 3 192.168.1.47`):** The ping was successful (0% packet loss), confirming network connectivity from the container to the machine at that IP.
9.  **Checked if Ollama was listening on `optiplex` (`ssh root@optiplex "ss -tuln | grep 11434"`):** No service was listening on port `11434` on `optiplex`.
10. **User Clarification (Callie's Laptop):** Callie clarified that Ollama runs 24x7 on her laptop (`callie`) at `192.168.1.47:11434`.
11. **Verified Ollama Listening on Callie's Laptop (`ss -tuln | grep 11434` on laptop):** Output confirmed Ollama is listening on `0.0.0.0:11434` (all interfaces) for both IPv4 and IPv6, meaning it's configured to accept external connections.

**Current Root Cause Identification for Data Stagnation:**

Ollama is correctly configured and listening on Callie's laptop (`192.168.1.47:11434`), and network connectivity exists at the IP level between `optiplex` and Callie's laptop. Therefore, the "Ollama not reachable" error from the `trumpstoadies` container is now almost certainly due to a **firewall on Callie's laptop blocking incoming TCP connections on port `11434`**.

**Next Steps to Resolve Data Stagnation (requires user action on Callie's laptop):**

**Callie, please check and adjust your firewall settings on your laptop (`callie`):**

1.  **Identify your Firewall:** This depends on your operating system:
    *   **Linux (e.g., Ubuntu, Debian, Pop!_OS):** You likely use `ufw` or `iptables`.
    *   **macOS:** System Settings -> Network -> Firewall.
    *   **Windows:** Windows Defender Firewall.
2.  **Ensure Port `11434` is Open:**
    *   **For `ufw` (Linux):**
        *   Check status: `sudo ufw status`
        *   If active, add a rule: `sudo ufw allow 11434/tcp`
    *   **For macOS Firewall:**
        *   Ensure the firewall is off, or add a specific rule to allow incoming connections to the Ollama application or port `11434`.
    *   **For Windows Defender Firewall:**
        *   Create an inbound rule to allow incoming TCP connections on port `11434`.

Once the firewall is configured to allow incoming connections on port `11434`, the `trumpstoadies` container should be able to connect to Ollama. After you've done this, please let me know, and I will manually trigger the enrichment process to verify.

**Future Task:**

*   Implement displaying the last update time in the footer of the website. (Not addressed in this session).