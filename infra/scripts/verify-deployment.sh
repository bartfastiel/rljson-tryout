#!/usr/bin/env bash
set -euo pipefail

# Proves that every deployed base URL serves the expected commit over https
# with a Let's Encrypt certificate, redirects http, reports a settled
# discovery role, lists species and serves the web app. In production curl
# verifies the certificate chain, so the
# health poll only succeeds once Let's Encrypt has issued, and the issuer
# must be the production one. Previews are signed by the staging issuer,
# whose chain no runner trusts: with ALLOW_STAGING_CERTIFICATE=true the
# https probes skip the chain check and the issuer must carry the
# `(STAGING)` mark instead, so a preview can never quietly consume the
# production rate limit. With three or more URLs the nodes behind them
# form one rljson network, and the script additionally waits until every
# node lists every other node as seen in the discovery topology and exactly
# one of them is the hub; a single URL (a preview) keeps the per-node check.
#   DEPLOYMENT_URLS            space separated https base URLs, no trailing slash
#   EXPECTED_COMMIT            the commit /health has to report
#   ALLOW_STAGING_CERTIFICATE  true for previews, default false
#   VERIFY_TIMEOUT_SECONDS     how long to wait per URL for that commit, and for the
#                              network to settle, default 300

: "${DEPLOYMENT_URLS:?DEPLOYMENT_URLS must list the https base URLs to verify}"
: "${EXPECTED_COMMIT:?EXPECTED_COMMIT must name the commit /health has to report}"
allow_staging_certificate="${ALLOW_STAGING_CERTIFICATE:-false}"
timeout_seconds="${VERIFY_TIMEOUT_SECONDS:-300}"

fail() {
  echo "::error::$*"
  exit 1
}

case "${allow_staging_certificate}" in
  true)
    certificate_options=(-k)
    expected_issuer="Let's Encrypt staging"
    ;;
  false)
    certificate_options=()
    expected_issuer="Let's Encrypt production"
    ;;
  *)
    fail "ALLOW_STAGING_CERTIFICATE must be true or false, got: ${allow_staging_certificate}"
    ;;
esac

issuer_matches() {
  case "${allow_staging_certificate}:$1" in
    "true:"*"Let's Encrypt"*"(STAGING)"*) return 0 ;;
    "false:"*"(STAGING)"*) return 1 ;;
    "false:"*"Let's Encrypt"*) return 0 ;;
    *) return 1 ;;
  esac
}

# shellcheck disable=SC2206 # the variable is a space separated list by contract
urls=(${DEPLOYMENT_URLS})
if [ "${#urls[@]}" -eq 0 ]; then
  fail "DEPLOYMENT_URLS holds no URL"
fi

# The single-shot probes retry on transport errors; -sS keeps curl quiet
# except for the error message that explains an empty answer.
probe() {
  curl -sS --retry 3 --retry-connrefused --max-time 10 "${certificate_options[@]}" "$@"
}

served_issuer() {
  timeout 15 openssl s_client -connect "$1:443" -servername "$1" < /dev/null 2> /dev/null | openssl x509 -noout -issuer 2> /dev/null || true
}

# The certificate is ordered when the ingress appears, so the served
# issuer is polled together with the commit: Traefik answers with its
# default certificate until cert-manager has stored the issued one.
for base_url in "${urls[@]}"; do
  host="${base_url#https://}"
  health_url="${base_url}/health"
  deadline=$((SECONDS + timeout_seconds))
  while true; do
    payload="$(curl -sS --max-time 10 "${certificate_options[@]}" "${health_url}" || true)"
    commit="$(printf '%s' "${payload}" | jq -r '.commit // empty' 2> /dev/null || true)"
    issuer="$(served_issuer "${host}")"
    if [ "${commit}" = "${EXPECTED_COMMIT}" ] && issuer_matches "${issuer}"; then
      break
    fi
    if ((SECONDS >= deadline)); then
      if [ "${commit}" != "${EXPECTED_COMMIT}" ]; then
        fail "${health_url} did not report commit ${EXPECTED_COMMIT} within ${timeout_seconds} seconds. Last payload: ${payload}"
      fi
      fail "${health_url} does not serve a ${expected_issuer} certificate after ${timeout_seconds} seconds, got: ${issuer}"
    fi
    sleep 10
  done
  echo "${health_url} answered:"
  printf '%s\n' "${payload}"
  echo "${health_url} certificate issuer: ${issuer}"

  plain_http_url="http://${host}/health"
  redirect="$(probe -o /dev/null -w '%{http_code} %{redirect_url}' "${plain_http_url}" || true)"
  case "${redirect}" in
    "301 ${health_url}" | "307 ${health_url}" | "308 ${health_url}")
      echo "${plain_http_url} redirects: ${redirect}"
      ;;
    *)
      fail "${plain_http_url} does not redirect to ${health_url}, got: ${redirect}"
      ;;
  esac

  # Discovery has settled when the node reports a role other than
  # `starting`: `standalone` while it is the only node of its domain,
  # `hub` or `client` once it has peers. `starting` is a legitimate
  # transient (a node defers while an earlier peer has not answered a
  # probe yet), so the role is polled with the same patience as the commit.
  status_url="${base_url}/status"
  deadline=$((SECONDS + timeout_seconds))
  while true; do
    status_body="$(probe "${status_url}" || true)"
    status_role="$(printf '%s' "${status_body}" | jq -r '.role // empty' 2> /dev/null || true)"
    case "${status_role}" in
      standalone | hub | client)
        break
        ;;
    esac
    if ((SECONDS >= deadline)); then
      fail "${status_url} did not report a settled role (standalone, hub or client) within ${timeout_seconds} seconds, got: ${status_body}"
    fi
    sleep 10
  done
  echo "${status_url} reports: $(printf '%s' "${status_body}" | jq -c '{nodeName, nodeId, role, hubAddress}')"

  species_url="${base_url}/api/species"
  species_body="$(probe "${species_url}" || true)"
  # An empty body makes jq print nothing, so the count defaults to -1.
  species_count="$(printf '%s' "${species_body}" | jq 'if type == "array" then length else -1 end' 2> /dev/null || true)"
  species_count="${species_count:--1}"
  if [ "${species_count}" -lt 1 ]; then
    fail "${species_url} does not answer with a non-empty JSON array, got: ${species_body}"
  fi
  echo "${species_url} lists ${species_count} species"

  web_app_url="${base_url}/"
  web_app_answer="$(probe -o /dev/null -w '%{http_code} %{content_type}' "${web_app_url}" || true)"
  case "${web_app_answer}" in
    "200 text/html"*)
      echo "${web_app_url} serves the web app: ${web_app_answer}"
      ;;
    *)
      fail "${web_app_url} does not serve the web app, got: ${web_app_answer}"
      ;;
  esac
done

# With three or more URLs the nodes behind them form one rljson network.
# The apex host is an alias of the first node, so the statuses are grouped
# by node id before the roles are counted: the network has settled when at
# least two distinct nodes answer, every one of them lists every node of
# the environment as seen in the discovery topology, exactly one is the
# hub and the others are clients. A cold start needs one broadcast
# interval to agree on the hub and a rollout brings the nodes up one after
# the other, so the network is polled as patiently as the commit.
if [ "${#urls[@]}" -lt 3 ]; then
  exit 0
fi

network_statuses() {
  for base_url in "${urls[@]}"; do
    probe "${base_url}/status" 2> /dev/null || true
    echo
  done | jq -cs '[.[] | select(type == "object" and .nodeId != null)] | reduce .[] as $status ([]; if any(.[]; .nodeId == $status.nodeId) then . else . + [$status] end)' 2> /dev/null || echo '[]'
}

network_summary() {
  jq -c '
    length as $count
    | {
        settled: (
          $count >= 2
          and ([.[] | select(.role == "hub")] | length) == 1
          and all(.[]; .role == "hub" or .role == "client")
          and all(.[]; ((.nodes // []) | length) == $count and all((.nodes // [])[]; .self or .seenInTopology))
        ),
        roles: (map("\(.nodeName) \(.role)") | join(", ")),
        views: map("\(.nodeName) sees " + ([(.nodes // [])[] | select(.self | not) | "\(.name // .url)\(if .seenInTopology then "" else " (not in topology)" end)"] | join(", ")))
      }'
}

deadline=$((SECONDS + timeout_seconds))
while true; do
  summary="$(network_statuses | network_summary)"
  roles="$(printf '%s' "${summary}" | jq -r '.roles')"
  if [ "$(printf '%s' "${summary}" | jq -r '.settled')" = "true" ]; then
    break
  fi
  if ((SECONDS >= deadline)); then
    fail "The ${#urls[@]} URLs did not settle into one network with exactly one hub and every node seen by every other node within ${timeout_seconds} seconds. Last roles: ${roles:-none}"
  fi
  sleep 10
done
echo "network settled with the roles: ${roles}"
printf '%s' "${summary}" | jq -r '.views[]'
