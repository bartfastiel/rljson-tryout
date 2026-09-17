#!/usr/bin/env bash
set -euo pipefail

# Stands in for terraform in destroy-workloads.test.ts. It answers the
# subcommands the destroy script uses and records every call in FAKE_LOG.
#   FAKE_WORKSPACES          space separated names `workspace list` shows
#   FAKE_KUBECONFIG_PRESENT  yes when the cluster state has the output
#   FAKE_FAIL_DESTROY_IN     workspace whose destroy exits 1
#   FAKE_FAIL_WORKSPACE_LIST yes makes `workspace list` exit 1
#   FAKE_STATE_DIRECTORY     where the selected workspace is remembered

log() {
  printf '%s\n' "$*" >> "${FAKE_LOG}"
}

current_workspace_file="${FAKE_STATE_DIRECTORY}/current-workspace"
current_workspace() {
  cat "${current_workspace_file}" 2> /dev/null || echo default
}

if [[ "${1:-}" == -chdir=* ]]; then
  shift
fi

case "${1:-} ${2:-}" in
  "workspace list")
    if [ "${FAKE_FAIL_WORKSPACE_LIST:-no}" = yes ]; then
      echo "Error: the fake workspace list fails on purpose" >&2
      exit 1
    fi
    for workspace in ${FAKE_WORKSPACES}; do
      if [ "${workspace}" = "$(current_workspace)" ]; then
        echo "* ${workspace}"
      else
        echo "  ${workspace}"
      fi
    done
    echo
    ;;
  "workspace select")
    log "select ${3}"
    printf '%s' "${3}" > "${current_workspace_file}"
    ;;
  "workspace delete")
    log "delete ${*:3}"
    ;;
  "state list")
    echo "data.terraform_remote_state.cluster"
    for index in 1 2 3 4 5; do
      echo "module.production.fake_resource.item[\"${index}\"]"
    done
    ;;
  "output -raw")
    log "output ${3}"
    case "${3}" in
      kubeconfig)
        if [ "${FAKE_KUBECONFIG_PRESENT}" != yes ]; then
          echo 'Error: Output "kubeconfig" not found' >&2
          exit 1
        fi
        echo "apiVersion: v1"
        ;;
      server_ipv4)
        echo "192.0.2.10"
        ;;
      *)
        echo "unexpected output ${3}" >&2
        exit 2
        ;;
    esac
    ;;
  "destroy "*)
    log "destroy in $(current_workspace)"
    if [ "$(current_workspace)" = "${FAKE_FAIL_DESTROY_IN:-}" ]; then
      echo "Error: the fake destroy fails on purpose" >&2
      exit 1
    fi
    echo "Destroy complete!"
    ;;
  *)
    echo "unexpected terraform call: $*" >&2
    exit 2
    ;;
esac
