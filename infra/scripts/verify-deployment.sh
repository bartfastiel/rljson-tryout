#!/usr/bin/env bash
set -euo pipefail

# Proves that every deployed base URL serves the expected commit over https
# with a certificate the runner trusts, redirects http, lists species and
# serves the web app. curl verifies the certificate chain, so the health
# poll only succeeds once Let's Encrypt has issued; the issuer line
# documents which authority signed.
#   DEPLOYMENT_URLS         space separated https base URLs, no trailing slash
#   EXPECTED_COMMIT         the commit /health has to report
#   VERIFY_TIMEOUT_SECONDS  how long to wait per URL for that commit, default 300

: "${DEPLOYMENT_URLS:?DEPLOYMENT_URLS must list the https base URLs to verify}"
: "${EXPECTED_COMMIT:?EXPECTED_COMMIT must name the commit /health has to report}"
timeout_seconds="${VERIFY_TIMEOUT_SECONDS:-300}"

fail() {
  echo "::error::$*"
  exit 1
}

for base_url in ${DEPLOYMENT_URLS}; do
  host="${base_url#https://}"
  health_url="${base_url}/health"
  deadline=$((SECONDS + timeout_seconds))
  while true; do
    payload="$(curl -s --max-time 10 "${health_url}" || true)"
    commit="$(printf '%s' "${payload}" | jq -r '.commit // empty' 2> /dev/null || true)"
    if [ "${commit}" = "${EXPECTED_COMMIT}" ]; then
      break
    fi
    if ((SECONDS >= deadline)); then
      fail "${health_url} did not report commit ${EXPECTED_COMMIT} within ${timeout_seconds} seconds. Last payload: ${payload}"
    fi
    sleep 10
  done
  echo "${health_url} answered:"
  printf '%s\n' "${payload}"

  issuer="$(timeout 15 openssl s_client -connect "${host}:443" -servername "${host}" < /dev/null 2> /dev/null | openssl x509 -noout -issuer 2> /dev/null || true)"
  case "${issuer}" in
    *"Let's Encrypt"*)
      echo "${health_url} certificate issuer: ${issuer}"
      ;;
    *)
      fail "${health_url} does not serve a Let's Encrypt certificate, got: ${issuer}"
      ;;
  esac

  plain_http_url="http://${host}/health"
  redirect="$(curl -s -o /dev/null --max-time 10 -w '%{http_code} %{redirect_url}' "${plain_http_url}" || true)"
  case "${redirect}" in
    "301 ${health_url}" | "307 ${health_url}" | "308 ${health_url}")
      echo "${plain_http_url} redirects: ${redirect}"
      ;;
    *)
      fail "${plain_http_url} does not redirect to ${health_url}, got: ${redirect}"
      ;;
  esac

  species_url="${base_url}/api/species"
  species_count="$(curl -s --max-time 10 "${species_url}" | jq 'if type == "array" then length else -1 end' 2> /dev/null || echo -1)"
  if [ "${species_count}" -lt 1 ]; then
    fail "${species_url} does not answer with a non-empty JSON array"
  fi
  echo "${species_url} lists ${species_count} species"

  web_app_url="${base_url}/"
  web_app_answer="$(curl -s -o /dev/null --max-time 10 -w '%{http_code} %{content_type}' "${web_app_url}" || true)"
  case "${web_app_answer}" in
    "200 text/html"*)
      echo "${web_app_url} serves the web app: ${web_app_answer}"
      ;;
    *)
      fail "${web_app_url} does not serve the web app, got: ${web_app_answer}"
      ;;
  esac
done
