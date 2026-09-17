#!/usr/bin/env bash
set -euo pipefail

# Stands in for curl in verify-deployment.test.ts. It recognises the request
# by the URL, which is the last argument, records every call in FAKE_LOG and
# answers from these variables:
#   FAKE_HEALTH_COMMIT       commit /health reports once ready
#   FAKE_HEALTH_READY_AFTER  number of /health calls that report an old commit first
#   FAKE_REDIRECT            what http://.../health answers as "<code> <redirect url>"
#   FAKE_STATUS              JSON body of /status once settled
#   FAKE_STATUS_READY_AFTER  number of /status calls that report the role starting first
#   FAKE_SPECIES             JSON body of /api/species
#   FAKE_WEB_APP             what / answers as "<code> <content type>"
#   FAKE_STATE_DIRECTORY     where the number of /health calls is counted

printf '%s\n' "curl $*" >> "${FAKE_LOG}"
url="${*: -1}"
counter_file="${FAKE_STATE_DIRECTORY}/health-calls"

case "${url}" in
  https://*/health)
    calls=$(($(cat "${counter_file}" 2> /dev/null || echo 0) + 1))
    printf '%s' "${calls}" > "${counter_file}"
    if [ "${calls}" -le "${FAKE_HEALTH_READY_AFTER}" ]; then
      printf '{"status":"ok","name":"node1","version":"0.0.0","commit":"0000000000000000000000000000000000000000"}'
    else
      printf '{"status":"ok","name":"node1","version":"0.0.0","commit":"%s"}' "${FAKE_HEALTH_COMMIT}"
    fi
    ;;
  http://*/health)
    printf '%s' "${FAKE_REDIRECT}"
    ;;
  https://*/status)
    status_counter_file="${FAKE_STATE_DIRECTORY}/status-calls"
    status_calls=$(($(cat "${status_counter_file}" 2> /dev/null || echo 0) + 1))
    printf '%s' "${status_calls}" > "${status_counter_file}"
    if [ "${status_calls}" -le "${FAKE_STATUS_READY_AFTER:-0}" ]; then
      printf '{"nodeName":"node1","nodeId":"id-node1","role":"starting","hubAddress":null}'
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
