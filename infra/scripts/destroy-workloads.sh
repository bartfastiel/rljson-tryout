#!/usr/bin/env bash
set -euo pipefail

# Destroys every workspace of the workloads stage except `default`: preview
# workspaces (`pr-*`) first, `production` last. Preview workspaces are
# deleted afterwards, `production` is kept empty so that the next apply
# reuses it. The Down workflow runs this before it destroys the cluster,
# because the workloads stage reads the cluster's kubeconfig from the
# cluster state and cannot even plan once that output is gone.
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
    body="$(curl -sk --max-time 10 "https://${server_ipv4}:6443/version" || true)"
    if printf '%s' "${body}" | grep -Eq '"gitVersion"|"code": ?40[13]'; then
      echo "The Kubernetes API server at ${server_ipv4} answers (attempt ${attempt})."
      return 0
    fi
    sleep 10
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

workspaces="$(list_workspaces)"
previews="$(printf '%s\n' "${workspaces}" | grep '^pr-' || true)"
others="$(printf '%s\n' "${workspaces}" | grep -v '^pr-' | grep -vx 'production' || true)"
production="$(printf '%s\n' "${workspaces}" | grep -x 'production' || true)"
mapfile -t ordered < <(printf '%s\n' "${previews}" "${others}" "${production}" | sed '/^$/d')

if [ "${#ordered[@]}" -eq 0 ]; then
  echo "No workloads workspace besides default exists; nothing to destroy."
  printf '## Workloads\n\nNo workspace besides `default` existed.\n' >> "${summary_file}"
  exit 0
fi

if cluster_is_reachable; then
  mode=destroy
else
  mode=orphan
fi
echo "Workspaces in destroy order (${mode} mode):"
printf -- '- %s\n' "${ordered[@]}"

summary="## Workloads"$'\n\n'"| Workspace | Result |"$'\n'"| --- | --- |"
for workspace in "${ordered[@]}"; do
  echo "::group::Workspace ${workspace}"
  terraform workspace select "${workspace}"
  resource_count="$(count_resources)"
  if [ "${mode}" = destroy ]; then
    terraform destroy -input=false -auto-approve -no-color
  fi
  terraform workspace select default
  if [ "${mode}" = orphan ]; then
    terraform workspace delete -force "${workspace}"
    result="cluster unreachable: state with ${resource_count} resources removed, workspace deleted"
  elif [ "${workspace}" = production ]; then
    result="${resource_count} resources destroyed, workspace kept"
  else
    terraform workspace delete "${workspace}"
    result="${resource_count} resources destroyed, workspace deleted"
  fi
  echo "${workspace}: ${result}"
  summary+=$'\n'"| ${workspace} | ${result} |"
  echo "::endgroup::"
done

printf '%s\n' "${summary}" >> "${summary_file}"
