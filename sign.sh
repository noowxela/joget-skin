#!/usr/bin/env bash
# Sign the extension on AMO as an UNLISTED add-on (self-distribution, not public).
# Needs .env (copy .env.example) with your AMO API credentials from
# https://addons.mozilla.org/developers/addon/api/key/ . This script never prints them.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "Missing .env — copy .env.example to .env and fill in AMO_JWT_ISSUER / AMO_JWT_SECRET." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
. ./.env
set +a
if [ -z "${AMO_JWT_ISSUER:-}" ] || [ -z "${AMO_JWT_SECRET:-}" ]; then
  echo "AMO_JWT_ISSUER / AMO_JWT_SECRET are empty in .env." >&2
  exit 1
fi

npx --yes web-ext sign \
  --channel=unlisted \
  --source-dir . \
  --artifacts-dir web-ext-artifacts \
  --api-key="$AMO_JWT_ISSUER" \
  --api-secret="$AMO_JWT_SECRET" \
  --ignore-files "screenshots/**" "themes/v1.1-indigo/**" "*.zip" "node_modules/**" \
                 "sign.sh" "package.json" "package-lock.json" ".env" ".env.example" ".gitignore"
