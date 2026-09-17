#!/usr/bin/env bash
set -euo pipefail

# Stands in for gh in sweep-previews.test.ts: answers `pr view <number>
# --json state --jq .state` from FAKE_PULL_REQUEST_STATES, a space
# separated list of <number>=<state>, and fails like gh for any other
# number. Every call is recorded in FAKE_LOG.

printf '%s\n' "gh $*" >> "${FAKE_LOG}"
if [ "${1:-} ${2:-}" != "pr view" ]; then
  echo "unexpected gh call: $*" >&2
  exit 2
fi
number="${3}"
for entry in ${FAKE_PULL_REQUEST_STATES}; do
  if [ "${entry%%=*}" = "${number}" ]; then
    echo "${entry#*=}"
    exit 0
  fi
done
echo "GraphQL: Could not resolve to a PullRequest with the number of ${number}. (repository.pullRequest)" >&2
exit 1
