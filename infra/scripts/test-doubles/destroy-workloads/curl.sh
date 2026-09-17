#!/usr/bin/env bash
set -euo pipefail

# Stands in for curl in destroy-workloads.test.ts: with FAKE_API_ANSWERS=yes
# it prints the 401 Status body k3s returns to anonymous requests, otherwise
# nothing, like a server that is gone.

printf '%s\n' "curl $*" >> "${FAKE_LOG}"
if [ "${FAKE_API_ANSWERS}" = yes ]; then
  printf '{"kind":"Status","apiVersion":"v1","status":"Failure","code":401}'
fi
