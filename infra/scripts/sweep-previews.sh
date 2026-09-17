#!/usr/bin/env bash
set -euo pipefail

# Destroys the preview workspaces whose pull requests are no longer open:
# the safety net behind the preview-destroy workflow for the cases it
# misses, such as a destroy that failed or a pull request closed while the
# system was down. Every `pr-<number>` workspace of the workloads stage is
# checked against the pull request's state; `OPEN` keeps the preview,
# `CLOSED` and `MERGED` hand the workspace to destroy-workloads.sh, and a
# state that cannot be read leaves the workspace alone and fails the run,
# so a hiccup of the GitHub API never destroys a live preview.
#
# Run from the workloads stage directory after `terraform init` there and
# in the cluster stage directory. gh needs GH_TOKEN with read access to
# pull requests and GH_REPO naming the repository. The summary lands in
# GITHUB_STEP_SUMMARY when GitHub Actions sets it, otherwise on standard
# output.

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
summary_file="${GITHUB_STEP_SUMMARY:-/dev/stdout}"

mapfile -t previews < <(terraform workspace list | sed -e 's/^\*//' -e 's/^[[:space:]]*//' | grep '^pr-' || true)

stale=()
unknown=()
rows=()
for workspace in "${previews[@]}"; do
  number="${workspace#pr-}"
  if state="$(gh pr view "${number}" --json state --jq .state 2>&1)"; then
    case "${state}" in
      OPEN)
        rows+=("| ${workspace} | #${number} | open | kept |")
        ;;
      CLOSED | MERGED)
        stale+=("${workspace}")
        rows+=("| ${workspace} | #${number} | ${state,,} | destroyed |")
        ;;
      *)
        unknown+=("${workspace}")
        rows+=("| ${workspace} | #${number} | unexpected state ${state} | kept |")
        ;;
    esac
  else
    unknown+=("${workspace}")
    rows+=("| ${workspace} | #${number} | could not be read: ${state} | kept |")
  fi
done

{
  echo "## Preview sweep"
  echo
  if [ "${#rows[@]}" -eq 0 ]; then
    echo "No preview workspace exists."
  else
    echo "| Workspace | Pull request | State | Action |"
    echo "| --- | --- | --- | --- |"
    printf '%s\n' "${rows[@]}"
  fi
  echo
} >> "${summary_file}"

if [ "${#stale[@]}" -gt 0 ]; then
  echo "Destroying the previews of closed pull requests: ${stale[*]}"
  "${script_directory}/destroy-workloads.sh" "${stale[@]}"
else
  echo "Every preview belongs to an open pull request; nothing to destroy."
fi

if [ "${#unknown[@]}" -gt 0 ]; then
  echo "::error::The pull request state of ${unknown[*]} could not be read; these previews were kept. See the summary."
  exit 1
fi
