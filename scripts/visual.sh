#!/usr/bin/env bash
# Compare the catalogue's screenshots, with the browser running in Playwright's Linux
# image (the same image, on the same CPU architecture, as CI). Arguments go to
# Playwright: `npm run test:visual -- --update-snapshots=changed` accepts changes.
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -p "require('@playwright/test/package.json').version")
image="mcr.microsoft.com/playwright:v${version}-noble"
name="admit-one-visual-$$"

npm run build-storybook

docker run --detach --rm --init --ipc=host --name "$name" --publish 127.0.0.1:3000:3000 \
  --user pwuser --workdir /home/pwuser "$image" \
  npx -y "playwright@${version}" run-server --port 3000 --host 0.0.0.0 >/dev/null
trap 'docker stop "$name" >/dev/null 2>&1 || true' EXIT

for _ in $(seq 1 120); do
  if docker logs "$name" 2>&1 | grep -q "Listening on"; then break; fi
  sleep 1
done
docker logs "$name" 2>&1 | grep -q "Listening on" || { docker logs "$name"; exit 1; }

PW_VISUAL_WS="ws://127.0.0.1:3000/" npx playwright test --config=playwright.visual.config.ts "$@"
