#!/bin/sh
# Runs before `npm run dev`. Stops backends left over from earlier dev sessions
# (e.g. a closed terminal) and waits until the port is actually released:
# the API shuts down gracefully, so `kill` returning doesn't mean the port is free.
PORT="${PORT:-3000}"

# [n] keeps the pattern from matching this script's own command line.
pkill -f '[n]odemon src/app.js'
lsof -ti "tcp:$PORT" -sTCP:LISTEN | xargs kill 2>/dev/null

i=0
while lsof -ti "tcp:$PORT" -sTCP:LISTEN >/dev/null; do
  i=$((i + 1))
  if [ "$i" -ge 20 ]; then
    echo "[predev] port $PORT still busy after 10s, force-killing"
    lsof -ti "tcp:$PORT" -sTCP:LISTEN | xargs kill -9 2>/dev/null
    sleep 0.5
    break
  fi
  sleep 0.5
done
exit 0
