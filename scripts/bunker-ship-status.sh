#!/bin/bash
# =============================================================================
# bunker-ship-status.sh — did the outbox actually reach the bar?
# -----------------------------------------------------------------------------
# The Mac's Syncthing folder is `sendonly` against a ~2 TB library it never
# pulls, so its web UI reports "Out of Sync" permanently (media-courier.md §7).
# That makes the UI useless as a "safe to delete the local copy" signal. This
# asks the local REST API the question that does have an answer: how many bytes
# does the bar still need from us?
#
# DELIVERED = needBytes 0 for every device sharing the folder.
#
# Read-only: GETs against 127.0.0.1:8384 only. Changes nothing, anywhere.
# Env: BUNKER_SYNC_FOLDER (default bunkerclub-media)
# Exit: 0 delivered · 1 cannot ask · 2 no peer paired yet · 3 still in flight
# =============================================================================
set -uo pipefail
FOLDER="${BUNKER_SYNC_FOLDER:-bunkerclub-media}"
CFG="$HOME/Library/Application Support/Syncthing/config.xml"
API=$(sed -n 's/.*<apikey>\(.*\)<\/apikey>.*/\1/p' "$CFG" 2>/dev/null | head -1)
[ -n "$API" ] || { echo "error: no Syncthing API key in $CFG (is Syncthing installed?)" >&2; exit 1; }
st() { curl -sS --max-time 10 -H "X-API-Key: $API" "http://127.0.0.1:8384$1"; }

ME=$(st /rest/system/status | python3 -c 'import json,sys; print(json.load(sys.stdin)["myID"])') \
  || { echo "error: Syncthing is not answering on 127.0.0.1:8384" >&2; exit 1; }
PEERS=$(st "/rest/config/folders/$FOLDER" \
  | python3 -c "import json,sys; print(' '.join(d['deviceID'] for d in json.load(sys.stdin).get('devices',[]) if d['deviceID']!='$ME'))")
[ -n "$PEERS" ] || { echo "no remote device shares '$FOLDER' yet — pair the PC first (runbook §4)"; exit 2; }

DEVJSON=$(st /rest/config/devices)
rc=0
for d in $PEERS; do
  NAME=$(printf '%s' "$DEVJSON" | python3 -c "
import json,sys; print(next((x['name'] for x in json.load(sys.stdin) if x['deviceID']=='$d'), '$d'[:7]))")
  st "/rest/db/completion?folder=$FOLDER&device=$d" | NAME="$NAME" python3 -c "
import json,os,sys
c = json.load(sys.stdin); n = c.get('needBytes', -1)
print('  %-18s %-10s needBytes=%-12d needItems=%-4d %3d%%  remoteState=%s'
      % (os.environ['NAME'], 'DELIVERED' if n == 0 else 'IN FLIGHT', n,
         c.get('needItems', -1), round(c.get('completion', 0)), c.get('remoteState', '?')))
sys.exit(0 if n == 0 else 3)" || rc=3
done
[ "$rc" -eq 0 ] && echo "  -> DELIVERED. The local copy in the outbox is safe to delete."
exit $rc
