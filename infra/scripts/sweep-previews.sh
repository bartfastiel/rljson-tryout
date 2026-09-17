#!/usr/bin/env bash
set -euo pipefail

# Destroys the preview workspaces whose pull requests are no longer open:
# the safety net behind the preview-destroy workflow for the cases it
# misses, such as a destroy that failed on a stale state lock or a GitHub
# outage, or a pull request closed while its own pipeline run was still
# about to apply the preview. Every `pr-<number>` workspace of the
# workloads stage is checked against the pull request's state; `OPEN`
# keeps the preview, `CLOSED` and `MERGED` hand the workspace to
# destroy-workloads.sh, and a state that cannot be read leaves the
# workspace alone and fails the run, so a hiccup of the GitHub API never
# destroys a live preview.
#
# Run from the workloads stage directory after `terraform init` there and
# in the cluster stage directory. gh needs GH_TOKEN with read access to
# pull requests and GH_REPO naming the repository. The summary lands in
# GITHUB_STEP_SUMMARY when GitHub Actions sets it, otherwise on standard
# output.

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
summary_file="${GITHUB_STEP_SUMMARY:-/dev/stdout}"

# Captured first so that a failing listing fails the sweep instead of
# passing as "no preview exists".
workspaces="$(terraform workspace list)"
mapfile -t previews < <(printf '%s\n' "${workspaces}" | sed -e 's/^\*//' -e 's/^[[:space:]]*//' | grep '^pr-' || true)

declare -A state_of
stale=()
unknown=()
for workspace in "${previews[@]}"; do
  number="${workspace#pr-}"
  if state="$(gh pr view "${number}" --json state --jq .state 2>&1)"; then
    case "${state}" in
      OPEN)
        state_of["${workspace}"]="open"
        ;;
      CLOSED | MERGED)
        state_of["${workspace}"]="${state,,}"
        stale+=("${workspace}")
        ;;
      *)
        state_of["${workspace}"]="unexpected state ${state}"
        unknown+=("${workspace}")
        ;;
    esac
  else
    state_of["${workspace}"]="could not be read: ${state}"
    unknown+=("${workspace}")
  fi
done

# The destroy script writes its own table; it is collected in a file so
# that the sweep's table, which names the outcome, comes first.
workloads_summary="$(mktemp)"
trap 'rm -f "${workloads_summary}"' EXIT
destroy_exit_code=0
if [ "${#stale[@]}" -gt 0 ]; then
  echo "Destroying the previews of closed pull requests: ${stale[*]}"
  GITHUB_STEP_SUMMARY="${workloads_summary}" "${script_directory}/destroy-workloads.sh" "${stale[@]}" || destroy_exit_code=$?
else
  echo "Every preview belongs to an open pull request; nothing to destroy."
fi

if [ "${destroy_exit_code}" -eq 0 ]; then
  stale_action="destroyed"
else
  stale_action="destroy failed with exit code ${destroy_exit_code}, see the Workloads table"
fi

{
  echo "## Preview sweep"
  echo
  if [ "${#previews[@]}" -eq 0 ]; then
    echo "No preview workspace exists."
  else
    echo "| Workspace | Pull request | State | Action |"
    echo "| --- | --- | --- | --- |"
    for workspace in "${previews[@]}"; do
      case "${state_of[${workspace}]}" in
        closed | merged) action="${stale_action}" ;;
        *) action="kept" ;;
      esac
      echo "| ${workspace} | #${workspace#pr-} | ${state_of[${workspace}]} | ${action} |"
    done
  fi
  echo
  cat "${workloads_summary}"
} >> "${summary_file}"

if [ "${destroy_exit_code}" -ne 0 ]; then
  exit "${destroy_exit_code}"
fi
if [ "${#unknown[@]}" -gt 0 ]; then
  echo "::error::The pull request state of ${unknown[*]} could not be read; these previews were kept. See the summary."
  exit 1
fi
