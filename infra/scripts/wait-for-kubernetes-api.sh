#!/usr/bin/env bash
set -euo pipefail

# Polls the Kubernetes API server of the cluster stage until it answers.
# Run from infra/terraform/cluster after an apply. k3s runs the API server
# with anonymous authentication off, so the expected answer is a 401
# Status body; a version body is accepted too.

server_ipv4="$(terraform output -raw server_ipv4)"
version_url="https://${server_ipv4}:6443/version"
deadline=$((SECONDS + 720))
body=""
until printf '%s' "${body}" | grep -Eq '"gitVersion"|"code": ?40[13]'; do
  if ((SECONDS >= deadline)); then
    echo "::error::${version_url} did not answer within twelve minutes. Last body: ${body}"
    exit 1
  fi
  sleep 10
  body="$(curl -sk --max-time 10 "${version_url}" || true)"
done
echo "${version_url} answered:"
printf '%s\n' "${body}"
