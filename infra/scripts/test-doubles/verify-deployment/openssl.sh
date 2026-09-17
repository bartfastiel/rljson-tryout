#!/usr/bin/env bash
set -euo pipefail

# Stands in for openssl in verify-deployment.test.ts: `s_client` swallows
# its input like the real handshake, `x509 -issuer` prints FAKE_ISSUER.

printf '%s\n' "openssl $*" >> "${FAKE_LOG}"
case "${1:-}" in
  s_client)
    cat > /dev/null
    echo "fake certificate"
    ;;
  x509)
    cat > /dev/null
    printf '%s\n' "${FAKE_ISSUER}"
    ;;
  *)
    echo "unexpected openssl call: $*" >&2
    exit 2
    ;;
esac
