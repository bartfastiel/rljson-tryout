#!/usr/bin/env bash
set -euo pipefail

# Proves that the kubeconfig output of the cluster stage works and that
# exactly one node is Ready. Run from infra/terraform/cluster after an
# apply. The kubeconfig grants cluster administrator rights: it lives in a
# file with mode 600 for the duration of this script and is never printed.

kubeconfig_file="$(mktemp)"
chmod 600 "${kubeconfig_file}"
trap 'rm -f "${kubeconfig_file}"' EXIT
terraform output -raw kubeconfig > "${kubeconfig_file}"
kubectl --kubeconfig "${kubeconfig_file}" wait node --all --for=condition=Ready --timeout=180s
nodes="$(kubectl --kubeconfig "${kubeconfig_file}" get nodes -o wide)"
printf '%s\n' "${nodes}"
ready_count="$(printf '%s\n' "${nodes}" | tail -n +2 | awk '$2 == "Ready"' | wc -l)"
if [ "${ready_count}" -ne 1 ]; then
  echo "::error::Expected exactly one node in Ready, found ${ready_count}."
  exit 1
fi
