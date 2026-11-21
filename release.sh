#!/usr/bin/env bash
# Cut a signed, self-hosted Firefox release of Joget Skin and publish
# updates.json to GitHub Pages. See docs/15-auto-update.md.
#
# Usage:
#   ./release.sh                 # current version if not yet tagged, otherwise bump patch
#   ./release.sh 1.4.2           # set this version (commits if the tree version differs)
#   ./release.sh --dry-run
#   ./release.sh --dry-run 1.4.2
#
# --dry-run does the local steps (version bump, commit, tag, generate
# updates.json from a placeholder xpi) and skips anything that talks to the
# network: AMO (sign.sh), gh release, git push, and the Pages publish push.
set -euo pipefail

OWNER="noowxela"
NAME="joget-skin"
ADDON_ID="joget-skin@alexwoon"
REMOTE="origin"
PAGES_BRANCH="gh-pages"
UPDATE_PATH="updates.json"

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

DRY_RUN=0
TARGET=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --help|-h)
      sed -n '2,16p' "$0"
      exit 0
      ;;
    -*)
      echo "unknown option: $arg" >&2
      exit 1
      ;;
    *)
      if [ -n "$TARGET" ]; then
        echo "unexpected extra argument: $arg" >&2
        exit 1
      fi
      TARGET="$arg"
      ;;
  esac
done

if [ -n "$TARGET" ] && [[ "$TARGET" == v* ]]; then
  echo "pass the version without a leading v (got $TARGET)" >&2
  exit 1
fi
if [ -n "$TARGET" ] && [[ ! "$TARGET" =~ ^[0-9]+(\.[0-9]+)*$ ]]; then
  echo "version must look like 1.4.1, not $TARGET" >&2
  exit 1
fi

log() { printf '%s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

if [ "$DRY_RUN" -eq 1 ]; then
  warn "dry-run: will not call AMO, gh, or git push; local commit/tag may still happen"
fi

# --- clean tree (ignore personal files we never commit) ---
dirty=""
while IFS= read -r line || [ -n "$line" ]; do
  [ -z "$line" ] && continue
  path="${line#???}"
  case "$line" in
    R*|" R"*|C*|" C"*) path="${path#* -> }" ;;
  esac
  case "$path" in
    .amo-upload-uuid|AGENTS.md) continue ;;
  esac
  dirty="${dirty}${line}
"
done < <(git status --porcelain)

if [ -n "$dirty" ]; then
  printf '%s' "$dirty"
  die "working tree is not clean (aside from .amo-upload-uuid / AGENTS.md)"
fi

current="$(node --input-type=module -e 'import fs from "fs"; console.log(JSON.parse(fs.readFileSync("manifest.json","utf8")).version)')"
pkgver="$(node --input-type=module -e 'import fs from "fs"; console.log(JSON.parse(fs.readFileSync("package.json","utf8")).version)')"
[ "$current" = "$pkgver" ] || die "manifest.json version ($current) != package.json version ($pkgver)"

tag_exists() { git rev-parse -q --verify "refs/tags/v$1" >/dev/null; }

bump_patch() {
  local v="$1"
  if [[ ! "$v" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    die "cannot bump patch of non-X.Y.Z version: $v"
  fi
  echo "${BASH_REMATCH[1]}.${BASH_REMATCH[2]}.$((BASH_REMATCH[3] + 1))"
}

if [ -z "$TARGET" ]; then
  if tag_exists "$current"; then
    TARGET="$(bump_patch "$current")"
    log "v$current already tagged; bumping patch to $TARGET"
  else
    TARGET="$current"
    log "v$current is not tagged yet; releasing this version"
  fi
fi

set_versions() {
  local ver="$1"
  TARGET_VERSION="$ver" node --input-type=module -e '
    import fs from "fs";
    const v = process.env.TARGET_VERSION;
    for (const f of ["manifest.json", "package.json"]) {
      const j = JSON.parse(fs.readFileSync(f, "utf8"));
      j.version = v;
      fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
    }
  '
}

if [ "$current" != "$TARGET" ]; then
  set_versions "$TARGET"
  git add -- manifest.json package.json
  git commit -m "v${TARGET}: bump version for release"
  log "committed version bump $current → $TARGET"
else
  log "manifest already at $TARGET; no version-bump commit"
fi

if tag_exists "$TARGET"; then
  tagged="$(git rev-parse "v${TARGET}^{commit}")"
  head="$(git rev-parse HEAD)"
  if [ "$tagged" != "$head" ]; then
    die "tag v$TARGET already exists on $tagged, not HEAD $head"
  fi
  log "tag v$TARGET already points at HEAD"
else
  git tag -a "v$TARGET" -m "v$TARGET"
  log "created tag v$TARGET"
fi

XPI_NAME="joget-skin-${TARGET}.xpi"
XPI_LINK="https://github.com/${OWNER}/${NAME}/releases/download/v${TARGET}/${XPI_NAME}"
SIGNED_XPI=""

if [ "$DRY_RUN" -eq 1 ]; then
  mkdir -p web-ext-artifacts
  SIGNED_XPI="web-ext-artifacts/${XPI_NAME}"
  printf 'dry-run placeholder xpi for %s\n' "$TARGET" > "$SIGNED_XPI"
  warn "dry-run: skipped sign.sh (AMO); placeholder $SIGNED_XPI will not be published"
else
  [ -f .env ] || die "missing .env (needed by sign.sh for AMO credentials). Copy .env.example to .env and fill it in; this script never reads that file itself."
  bash ./sign.sh
  found=""
  for f in web-ext-artifacts/*-"$TARGET".xpi; do
    [ -e "$f" ] || continue
    found="$f"
    break
  done
  # prefer the newest match if several
  for f in web-ext-artifacts/*-"$TARGET".xpi; do
    [ -e "$f" ] || continue
    if [ -z "$found" ] || [ "$f" -nt "$found" ]; then
      found="$f"
    fi
  done
  [ -n "$found" ] || die "sign.sh finished but no web-ext-artifacts/*-${TARGET}.xpi was produced"
  cp "$found" "web-ext-artifacts/${XPI_NAME}"
  SIGNED_XPI="web-ext-artifacts/${XPI_NAME}"
  log "signed xpi: $found → $SIGNED_XPI"
fi

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/joget-skin-release.XXXXXX")"
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

EXISTING="$WORKDIR/updates.in.json"
if [ "$DRY_RUN" -eq 0 ]; then
  if git ls-remote --exit-code "$REMOTE" "refs/heads/${PAGES_BRANCH}" >/dev/null 2>&1; then
    git fetch "$REMOTE" "$PAGES_BRANCH"
    git show "FETCH_HEAD:${UPDATE_PATH}" > "$EXISTING" 2>/dev/null || true
  elif git show-ref --verify --quiet "refs/heads/${PAGES_BRANCH}"; then
    git show "${PAGES_BRANCH}:${UPDATE_PATH}" > "$EXISTING" 2>/dev/null || true
  fi
elif [ -n "${UPDATES_JSON:-}" ] && [ -f "${UPDATES_JSON}" ]; then
  cp "$UPDATES_JSON" "$EXISTING"
fi

min_version="$(node --input-type=module -e 'import fs from "fs"; console.log(JSON.parse(fs.readFileSync("manifest.json","utf8")).browser_specific_settings.gecko.strict_min_version)')"
gen_cmd=(
  node scripts/gen-updates-json.mjs
  --id "$ADDON_ID"
  --version "$TARGET"
  --xpi "$SIGNED_XPI"
  --update-link "$XPI_LINK"
  --min-version "$min_version"
  --output "$WORKDIR/updates.json"
)
if [ -s "$EXISTING" ]; then
  gen_cmd+=(--input "$EXISTING")
fi
"${gen_cmd[@]}"
log "generated updates.json:"
cat "$WORKDIR/updates.json"

if [ "$DRY_RUN" -eq 1 ]; then
  mkdir -p web-ext-artifacts
  cp "$WORKDIR/updates.json" web-ext-artifacts/updates.dry-run.json
  log "dry-run: wrote web-ext-artifacts/updates.dry-run.json"
  log "dry-run: would create GitHub release v$TARGET with $XPI_NAME"
  log "dry-run: would publish updates.json to $REMOTE $PAGES_BRANCH ($UPDATE_PATH)"
  log "dry-run: would git push $REMOTE HEAD and tag v$TARGET"
  log "dry-run complete for v$TARGET"
  exit 0
fi

git remote get-url "$REMOTE" >/dev/null 2>&1 || die "no git remote named $REMOTE. Create the GitHub repo and add it first (see docs/15-auto-update.md)."

git push "$REMOTE" HEAD
git push "$REMOTE" "v$TARGET"

if gh release view "v$TARGET" --repo "${OWNER}/${NAME}" >/dev/null 2>&1; then
  warn "release v$TARGET already exists; uploading $XPI_NAME"
  gh release upload "v$TARGET" "$SIGNED_XPI" --repo "${OWNER}/${NAME}" --clobber
else
  gh release create "v$TARGET" "$SIGNED_XPI" \
    --repo "${OWNER}/${NAME}" \
    --title "Joget Skin v$TARGET" \
    --notes "Signed self-hosted build of Joget Skin v${TARGET}. Install the .xpi once (about:addons → Install Add-on From File); later versions update automatically. See docs/15-auto-update.md."
fi

PAGES_DIR="$WORKDIR/pages"
if git ls-remote --exit-code "$REMOTE" "refs/heads/${PAGES_BRANCH}" >/dev/null 2>&1; then
  git fetch "$REMOTE" "$PAGES_BRANCH"
  git worktree add "$PAGES_DIR" "${PAGES_BRANCH}" || {
    git branch -f "$PAGES_BRANCH" FETCH_HEAD
    git worktree add "$PAGES_DIR" "$PAGES_BRANCH"
  }
else
  git worktree add --detach "$PAGES_DIR" HEAD
  git -C "$PAGES_DIR" checkout --orphan "$PAGES_BRANCH"
  git -C "$PAGES_DIR" rm -rf --ignore-unmatch . >/dev/null 2>&1 || true
  # checkout --orphan keeps the files in the tree; clear them so we only publish the feed
  find "$PAGES_DIR" -mindepth 1 -maxdepth 1 ! -name ".git" -exec rm -rf {} +
fi

cp "$WORKDIR/updates.json" "$PAGES_DIR/$UPDATE_PATH"
# Minimal index so the Pages root is not a 404. Do not copy docs/ or source.
cat > "$PAGES_DIR/index.html" <<EOF
<!DOCTYPE html>
<meta charset="utf-8">
<title>Joget Skin updates</title>
<p>Firefox update manifest: <a href="./updates.json">updates.json</a></p>
EOF

git -C "$PAGES_DIR" add -- "$UPDATE_PATH" index.html
if git -C "$PAGES_DIR" diff --cached --quiet; then
  log "gh-pages already up to date"
else
  git -C "$PAGES_DIR" commit -m "updates.json for v$TARGET"
  git -C "$PAGES_DIR" push "$REMOTE" "$PAGES_BRANCH"
fi

git worktree remove "$PAGES_DIR" --force

# Best-effort: turn Pages on the first time. Failure is not fatal; the branch is already pushed.
if ! gh api "repos/${OWNER}/${NAME}/pages" >/dev/null 2>&1; then
  if gh api -X POST "repos/${OWNER}/${NAME}/pages" \
      -f build_type=legacy \
      -F "source[branch]=${PAGES_BRANCH}" \
      -F "source[path]=/" >/dev/null 2>&1; then
    log "enabled GitHub Pages from ${PAGES_BRANCH} /"
  else
    warn "could not enable GitHub Pages automatically. In the GitHub repo: Settings → Pages → Deploy from branch → ${PAGES_BRANCH} / (root)."
  fi
fi

log "published https://${OWNER}.github.io/${NAME}/updates.json"
log "release https://github.com/${OWNER}/${NAME}/releases/tag/v${TARGET}"
log "done v$TARGET"
