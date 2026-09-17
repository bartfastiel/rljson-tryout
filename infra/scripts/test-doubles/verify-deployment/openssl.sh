#!/usr/bin/env bash
set -euo pipefail

# Stands in for openssl in verify-deployment.test.ts: `s_client` swallows
# its input like the real handshake, `x509 -issuer` prints Traefik's
# default issuer for the first FAKE_ISSUER_READY_AFTER calls and
# FAKE_ISSUER afterwards, like a certificate that is still being issued.
#   FAKE_STATE_DIRECTORY  where the number of x509 calls is counted

printf '%s\n' "openssl $*" >> "${FAKE_LOG}"
counter_file="${FAKE_STATE_DIRECTORY}/issuer-calls"
case "${1:-}" in
  s_client)
    cat > /dev/null
    echo "fake certificate"
    ;;
  x509)
    cat > /dev/null
    calls=$(($(cat "${counter_file}" 2> /dev/null || echo 0) + 1))
    printf '%s' "${calls}" > "${counter_file}"
    if [ "${calls}" -le "${FAKE_ISSUER_READY_AFTER:-0}" ]; then
      echo "issuer=CN=TRAEFIK DEFAULT CERT"
    else
      printf '%s\n' "${FAKE_ISSUER}"
    fi
    ;;
  *)
    echo "unexpected openssl call: $*" >&2
    exit 2
    ;;
esac
