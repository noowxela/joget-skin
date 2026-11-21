#!/usr/bin/env node
/**
 * Merge one Firefox self-hosted update entry into an updates.json.
 * No dependencies. See docs/15-auto-update.md.
 *
 *   node scripts/gen-updates-json.mjs \
 *     --id joget-skin@alexwoon \
 *     --version 1.4.1 \
 *     --xpi path/to/joget-skin-1.4.1.xpi \
 *     --update-link https://github.com/noowxela/joget-skin/releases/download/v1.4.1/joget-skin-1.4.1.xpi \
 *     --min-version 142.0 \
 *     --input updates.json \
 *     --output updates.json
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const DEFAULT_OWNER = "noowxela";
const DEFAULT_REPO = "joget-skin";

export const HASH_RE = /^(sha256:[0-9a-f]{64}|sha512:[0-9a-f]{128})$/;
export const VERSION_RE = /^\d+(\.\d+)*$/;

export function sha256File(file) {
  const buf = fs.readFileSync(file);
  return "sha256:" + crypto.createHash("sha256").update(buf).digest("hex");
}

export function compareVersions(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10));
  const pb = String(b).split(".").map((n) => parseInt(n, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

export function releaseAssetUrl(version, { owner = DEFAULT_OWNER, repo = DEFAULT_REPO } = {}) {
  return `https://github.com/${owner}/${repo}/releases/download/v${version}/joget-skin-${version}.xpi`;
}

export function makeEntry({ version, updateLink, updateHash, minVersion }) {
  if (!VERSION_RE.test(version) || version.startsWith("v")) {
    throw new Error(`version must be dotted numeric without a leading v, got ${JSON.stringify(version)}`);
  }
  if (typeof updateLink !== "string" || !updateLink.startsWith("https://")) {
    throw new Error("update_link must be an https:// URL");
  }
  if (!HASH_RE.test(updateHash)) {
    throw new Error(`update_hash must be sha256:<64 hex> or sha512:<128 hex>, got ${JSON.stringify(updateHash)}`);
  }
  const entry = {
    version,
    update_link: updateLink,
    update_hash: updateHash,
  };
  if (minVersion) {
    entry.applications = { gecko: { strict_min_version: String(minVersion) } };
  }
  return entry;
}

export function mergeEntry(doc, addonId, entry) {
  if (!addonId) throw new Error("addon id is required");
  const out = doc && typeof doc === "object" ? structuredClone(doc) : { addons: {} };
  if (!out.addons || typeof out.addons !== "object" || Array.isArray(out.addons)) {
    out.addons = {};
  }
  const addon = out.addons[addonId] && typeof out.addons[addonId] === "object"
    ? out.addons[addonId]
    : { updates: [] };
  const updates = Array.isArray(addon.updates) ? addon.updates.filter((u) => u && u.version) : [];
  const next = updates.filter((u) => u.version !== entry.version);
  next.push(entry);
  next.sort((a, b) => compareVersions(a.version, b.version));
  out.addons[addonId] = { ...addon, updates: next };
  return out;
}

export function stringify(doc) {
  return JSON.stringify(doc, null, 2) + "\n";
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function defaultsFromManifest() {
  const manifestPath = path.join(repoRoot(), "manifest.json");
  if (!fs.existsSync(manifestPath)) return {};
  const m = readJson(manifestPath);
  const gecko = (m.browser_specific_settings && m.browser_specific_settings.gecko) || {};
  return { id: gecko.id, minVersion: gecko.strict_min_version, version: m.version };
}

function usage(code = 1) {
  console.error(`Usage: node scripts/gen-updates-json.mjs [options]
  --id <gecko-id>         default: browser_specific_settings.gecko.id in manifest.json
  --version <x.y.z>       required (no leading v)
  --xpi <path>            signed xpi; sha256 is taken from this file
  --hash sha256:<hex>     use this hash instead of reading --xpi
  --update-link <url>     default: GitHub Release asset URL for this version
  --min-version <ver>     default: gecko.strict_min_version in manifest.json
  --input <file>          existing updates.json to merge (keeps all versions)
  --output <file>         default: stdout`);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") usage(0);
    const keys = {
      "--id": "id",
      "--version": "version",
      "--xpi": "xpi",
      "--hash": "hash",
      "--update-link": "updateLink",
      "--min-version": "minVersion",
      "--input": "input",
      "--output": "output",
    };
    if (keys[a]) {
      const v = argv[++i];
      if (v == null || v.startsWith("--")) throw new Error(`${a} needs a value`);
      opts[keys[a]] = v;
      continue;
    }
    throw new Error(`unknown argument: ${a}`);
  }
  return opts;
}

export function generate(opts) {
  const defaults = defaultsFromManifest();
  const version = opts.version || defaults.version;
  const id = opts.id || defaults.id;
  if (!version) throw new Error("--version is required");
  if (!id) throw new Error("--id is required");
  let updateHash = opts.hash;
  if (updateHash && !HASH_RE.test(updateHash)) {
    throw new Error(`update_hash must be sha256:<64 hex> or sha512:<128 hex>, got ${JSON.stringify(updateHash)}`);
  }
  if (!updateHash) {
    if (!opts.xpi) throw new Error("provide --xpi or --hash");
    updateHash = sha256File(opts.xpi);
  }
  const updateLink = opts.updateLink || releaseAssetUrl(version);
  const entry = makeEntry({
    version,
    updateLink,
    updateHash,
    minVersion: opts.minVersion || defaults.minVersion,
  });
  const existing = opts.input ? readJson(opts.input) : { addons: {} };
  return mergeEntry(existing, id, entry);
}

function isMain() {
  const entry = process.argv[1] && path.resolve(process.argv[1]);
  return entry && entry === fileURLToPath(import.meta.url);
}

if (isMain()) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const doc = generate(opts);
    const text = stringify(doc);
    if (opts.output) {
      fs.mkdirSync(path.dirname(path.resolve(opts.output)), { recursive: true });
      fs.writeFileSync(opts.output, text);
    } else {
      process.stdout.write(text);
    }
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}
