# Troubleshooting

## Site Not Updating

If the site is not updating with new votes, it's likely that the `check_new_votes.js` script is not running. Here's how to troubleshoot:

1.  **Check the container:** The `trumpstoadies` project runs inside a Docker container on the `optiplex` server. Make sure the container is running:
    ```bash
    ssh root@optiplex 'docker ps'
    ```
    You should see a container with the name `trumpstoadies`.

2.  **Check the cron job:** There is a cron job inside the container that runs the `check_new_votes.js` script. Check the crontab:
    ```bash
    ssh root@optiplex 'docker exec trumpstoadies crontab -l'
    ```
    You should see a line for `check_new_votes.js` that runs every 6 hours.

3.  **Check for hanging processes:** The script can sometimes hang. Check for running processes inside the container:
    ```bash
    ssh root@optiplex 'docker exec trumpstoadies ps aux'
    ```
    If you see a `check_new_votes.js` process that has been running for a long time, it's likely hung. Kill the process by its PID:
    ```bash
    ssh root@optiplex 'docker exec trumpstoadies kill <PID>'
    ```

4.  **Check the logs:** The cron job logs its output to `/app/state/.ingest.log` inside the container. Check the logs for errors:
    ```bash
    ssh root@optiplex 'docker exec trumpstoadies tail -n 100 /app/state/.ingest.log'
    ```
