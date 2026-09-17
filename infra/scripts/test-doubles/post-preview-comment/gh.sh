#!/usr/bin/env bash
set -euo pipefail

# Stands in for gh in post-preview-comment.test.ts. It understands the
# `gh api` calls the script makes, records every call in FAKE_LOG, saves
# the JSON payload of a POST or PATCH under FAKE_STATE_DIRECTORY and runs
# the `--jq` filter with the real jq like gh does.
#   FAKE_COMMENTS  JSON array the comments listing answers with

printf '%s\n' "gh $*" >> "${FAKE_LOG}"
if [ "${1:-}" != api ]; then
  echo "unexpected gh call: $*" >&2
  exit 2
fi
shift

method=GET
filter=.
path=""
read_input=no
while [ "$#" -gt 0 ]; do
  case "$1" in
    --method)
      method="$2"
      shift 2
      ;;
    --jq)
      filter="$2"
      shift 2
      ;;
    --input)
      read_input=yes
      shift 2
      ;;
    --paginate)
      shift
      ;;
    *)
      path="$1"
      shift
      ;;
  esac
done

case "${method} ${path}" in
  "GET repos/"*"/issues/"*"/comments")
    response="${FAKE_COMMENTS}"
    ;;
  "PATCH repos/"*"/issues/comments/"*)
    comment_id="${path##*/}"
    [ "${read_input}" = yes ] && cat > "${FAKE_STATE_DIRECTORY}/patch-${comment_id}.json"
    response="$(jq -n --arg url "https://github.com/example/repository/pull/1#issuecomment-${comment_id}" '{ html_url: $url }')"
    ;;
  "POST repos/"*"/issues/"*"/comments")
    [ "${read_input}" = yes ] && cat > "${FAKE_STATE_DIRECTORY}/post.json"
    response="$(jq -n '{ html_url: "https://github.com/example/repository/pull/1#issuecomment-999" }')"
    ;;
  *)
    echo "unexpected gh api call: ${method} ${path}" >&2
    exit 2
    ;;
esac
# The jq of Git Bash on Windows ends its lines with a carriage return,
# which gh on the runner never does.
printf '%s' "${response}" | jq -r "${filter}" | tr -d '\r'
