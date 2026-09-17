#!/usr/bin/env bash
set -euo pipefail

# Stands in for curl in verify-deployment.test.ts. It recognises the request
# by the URL, which is the last argument, records every call in FAKE_LOG and
# answers from these variables:
#   FAKE_HEALTH_COMMIT             commit /health reports once ready
#   FAKE_HEALTH_READY_AFTER        number of /health calls that report an old commit first
#   FAKE_REDIRECT                  what http://.../health answers as "<code> <redirect url>";
#                                  __HEALTH_URL__ stands for the https health URL of the host asked
#   FAKE_STATUS                    JSON body of /status once settled, for hosts FAKE_STATUS_BY_HOST does not name
#   FAKE_STATUS_READY_AFTER        number of /status calls that report the role starting first
#   FAKE_STATUS_BY_HOST            JSON object from host to the /status body of that host
#   FAKE_UNSETTLED_STATUS_BY_HOST  JSON object from host to the /status body a host answers with
#                                  for its first FAKE_NETWORK_SETTLED_AFTER calls
#   FAKE_NETWORK_SETTLED_AFTER     number of /status calls per host that answer the unsettled body
#   FAKE_SPECIES                   JSON body of /api/species
#   FAKE_WEB_APP                   what / answers as "<code> <content type>"
#   FAKE_STATE_DIRECTORY           where the calls per route (and per host for /status) are counted

printf '%s\n' "curl $*" >> "${FAKE_LOG}"
url="${*: -1}"
host="${url#http://}"
host="${host#https://}"
host="${host%%/*}"
counter_file="${FAKE_STATE_DIRECTORY}/health-calls"

count_call() {
  local file="$1"
  local calls
  calls=$(($(cat "${file}" 2> /dev/null || echo 0) + 1))
  printf '%s' "${calls}" > "${file}"
  echo "${calls}"
}

status_of_host() {
  printf '%s' "$1" | jq -c --arg host "${host}" '.[$host]'
}

case "${url}" in
  https://*/health)
    calls="$(count_call "${counter_file}")"
    if [ "${calls}" -le "${FAKE_HEALTH_READY_AFTER}" ]; then
      printf '{"status":"ok","name":"node1","version":"0.0.0","commit":"0000000000000000000000000000000000000000"}'
    else
      printf '{"status":"ok","name":"node1","version":"0.0.0","commit":"%s"}' "${FAKE_HEALTH_COMMIT}"
    fi
    ;;
  http://*/health)
    printf '%s' "${FAKE_REDIRECT//__HEALTH_URL__/https://${host}/health}"
    ;;
  https://*/status)
    status_calls="$(count_call "${FAKE_STATE_DIRECTORY}/status-calls")"
    if [ "${status_calls}" -le "${FAKE_STATUS_READY_AFTER:-0}" ]; then
      printf '{"nodeName":"node1","nodeId":"id-node1","role":"starting","hubAddress":null}'
    elif [ -n "${FAKE_STATUS_BY_HOST:-}" ] && printf '%s' "${FAKE_STATUS_BY_HOST}" | jq -e --arg host "${host}" 'has($host)' > /dev/null; then
      host_calls="$(count_call "${FAKE_STATE_DIRECTORY}/status-calls-${host}")"
      if [ "${host_calls}" -le "${FAKE_NETWORK_SETTLED_AFTER:-0}" ]; then
        status_of_host "${FAKE_UNSETTLED_STATUS_BY_HOST}"
      else
        status_of_host "${FAKE_STATUS_BY_HOST}"
      fi
    else
      printf '%s' "${FAKE_STATUS}"
    fi
    ;;
  https://*/api/species)
    printf '%s' "${FAKE_SPECIES}"
    ;;
  https://*/)
    printf '%s' "${FAKE_WEB_APP}"
    ;;
  *)
    echo "unexpected curl call: $*" >&2
    exit 2
    ;;
esac
