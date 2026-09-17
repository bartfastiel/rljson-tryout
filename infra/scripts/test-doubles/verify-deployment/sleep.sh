#!/usr/bin/env bash
set -euo pipefail

# Stands in for sleep in verify-deployment.test.ts: records the call and
# returns at once.

printf '%s\n' "sleep $*" >> "${FAKE_LOG}"
