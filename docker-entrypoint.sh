#!/bin/sh
set -e
mkdir -p /app/state
crond -b -l 8
exec nginx -g "daemon off;"
