#!/usr/bin/env bash
set -euo pipefail

# Destroys workspaces of the workloads stage: without arguments every
# workspace except `default`, with arguments only the named ones. Preview
# workspaces (`pr-*`) go first, `production` last. Preview workspaces are
# deleted afterwards, `production` is kept empty so that the next apply
# reuses it. A named workspace that does not exist is reported and skipped,
# because a pull request that never got a preview has nothing to destroy.
# The Down workflow runs this without arguments before it destroys the
# cluster, because the workloads stage reads the cluster's kubeconfig from
# the cluster state and cannot even plan once that output is gone; the
# preview workflows name the workspaces of closed pull requests.
#
# When the cluster is already unreachable (its state has no kubeconfig
# output, or the Kubernetes API server behind it does not answer) every
# workspace is treated as orphaned: its state is deleted with
# `terraform workspace delete -force` instead of being destroyed, since
# everything it describes dies with the server anyway. `production` is
# deleted too in that case; `terraform workspace select -or-create` brings
# it back on the next apply.
#
# Run from the workloads stage directory after `terraform init` there and
# in the cluster stage directory. Variables the stage requires come from
# the environment (`TF_VAR_*`); their values do not matter for a destroy.
# The summary lands in GITHUB_STEP_SUMMARY when GitHub Actions sets it,
# otherwise on standard output.

cluster_directory="${CLUSTER_DIRECTORY:-../cluster}"
summary_file="${GITHUB_STEP_SUMMARY:-/dev/stdout}"

for requested in "$@"; do
  if [ "${requested}" = default ] || ! [[ "${requested}" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
    echo "::error::\"${requested}\" is not a workspace this script destroys: name production or a pr-<number> workspace."
    exit 2
  fi
done

# The kubeconfig output is sensitive: its presence is tested through the
# exit code only and its value never reaches a terminal or a log.
cluster_is_reachable() {
  local server_ipv4 body attempt
  if ! terraform -chdir="${cluster_directory}" output -raw kubeconfig > /dev/null 2>&1; then
    echo "The cluster state has no kubeconfig output: the cluster is gone or was never handed over."
    return 1
  fi
  server_ipv4="$(terraform -chdir="${cluster_directory}" output -raw server_ipv4)"
  # k3s runs the API server with anonymous authentication off, so a 401
  # Status body proves the server answers just as well as a version body.
  for attempt in 1 2 3; do
    if [ "${attempt}" -gt 1 ]; then
      sleep 10
    fi
    body="$(curl -sk --max-time 10 "https://${server_ipv4}:6443/version" || true)"
    if printf '%s' "${body}" | grep -Eq '"gitVersion"|"code": ?40[13]'; then
      echo "The Kubernetes API server at ${server_ipv4} answers (attempt ${attempt})."
      return 0
    fi
  done
  echo "The Kubernetes API server at ${server_ipv4} did not answer in three attempts: the server is gone."
  return 1
}

list_workspaces() {
  terraform workspace list | sed -e 's/^\*//' -e 's/^[[:space:]]*//' -e '/^$/d' -e '/^default$/d'
}

count_resources() {
  # grep -c prints 0 and exits 1 when nothing matches; the count is wanted either way.
  terraform state list 2> /dev/null | grep -vc '^data\.' || true
}

summary_rows=()
current_workspace=""
remaining_workspaces=()

# Whatever happens, the summary collected so far reaches the run summary
# and the log group is closed, so a failure half way through still shows
# which workspaces are gone and which were not touched.
finish() {
  local exit_code=$?
  local untouched row summary
  if [ -n "${current_workspace}" ]; then
    echo "::endgroup::"
    if [ "${exit_code}" -ne 0 ]; then
      terraform workspace select default > /dev/null 2>&1 || true
      summary_rows+=("| ${current_workspace} | failed with exit code ${exit_code}, see the log |")
      for untouched in "${remaining_workspaces[@]}"; do
        summary_rows+=("| ${untouched} | not touched because ${current_workspace} failed |")
      done
      echo "::error::Destroying workspace ${current_workspace} failed with exit code ${exit_code}."
    fi
  fi
  summary="## Workloads"$'\n'
  if [ "${#summary_rows[@]}" -gt 0 ]; then
    summary+=$'\n'"| Workspace | Result |"$'\n'"| --- | --- |"
    for row in "${summary_rows[@]}"; do
      summary+=$'\n'"${row}"
    done
  elif [ "${exit_code}" -ne 0 ]; then
    summary+=$'\n'"The script failed with exit code ${exit_code} before any workspace was touched, see the log."
  else
    summary+=$'\n'"No workspace besides default existed."
  fi
  printf '%s\n' "${summary}" >> "${summary_file}"
}
trap finish EXIT

existing_workspaces="$(list_workspaces)"
if [ "$#" -gt 0 ]; then
  workspaces=""
  for requested in "$@"; do
    if printf '%s\n' "${workspaces}" | grep -qx "${requested}"; then
      continue
    fi
    if printf '%s\n' "${existing_workspaces}" | grep -qx "${requested}"; then
      workspaces+="${requested}"$'\n'
    else
      echo "Workspace ${requested} does not exist; nothing to destroy."
      summary_rows+=("| ${requested} | does not exist, nothing to destroy |")
    fi
  done
else
  workspaces="${existing_workspaces}"
fi
previews="$(printf '%s\n' "${workspaces}" | grep '^pr-' || true)"
others="$(printf '%s\n' "${workspaces}" | grep -v '^pr-' | grep -vx 'production' || true)"
production="$(printf '%s\n' "${workspaces}" | grep -x 'production' || true)"
mapfile -t ordered < <(printf '%s\n' "${previews}" "${others}" "${production}" | sed '/^$/d')

if [ "${#ordered[@]}" -eq 0 ]; then
  if [ "$#" -eq 0 ]; then
    echo "No workloads workspace besides default exists; nothing to destroy."
  fi
  exit 0
fi

if cluster_is_reachable; then
  mode=destroy
else
  mode=orphan
fi
echo "Workspaces in destroy order (${mode} mode):"
printf -- '- %s\n' "${ordered[@]}"

for index in "${!ordered[@]}"; do
  current_workspace="${ordered[index]}"
  remaining_workspaces=("${ordered[@]:index+1}")
  echo "::group::Workspace ${current_workspace}"
  terraform workspace select "${current_workspace}"
  resource_count="$(count_resources)"
  if [ "${mode}" = destroy ]; then
    terraform destroy -input=false -auto-approve -no-color
  fi
  terraform workspace select default
  if [ "${mode}" = orphan ]; then
    terraform workspace delete -force "${current_workspace}"
    result="cluster unreachable: state with ${resource_count} resources removed, workspace deleted"
  elif [ "${current_workspace}" = production ]; then
    result="${resource_count} resources destroyed, workspace kept"
  else
    terraform workspace delete "${current_workspace}"
    result="${resource_count} resources destroyed, workspace deleted"
  fi
  echo "${current_workspace}: ${result}"
  summary_rows+=("| ${current_workspace} | ${result} |")
  echo "::endgroup::"
  current_workspace=""
done
