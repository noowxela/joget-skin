#!/usr/bin/env node
/**
 * Unit tests for scripts/gen-updates-json.mjs (no Joget, no Playwright).
 *
 *   node tests/updates-json.test.mjs
 */
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import {
  sha256File,
  compareVersions,
  releaseAssetUrl,
  makeEntry,
  mergeEntry,
  stringify,
  generate,
  HASH_RE,
} from "../scripts/gen-updates-json.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const GEN = path.join(ROOT, "scripts/gen-updates-json.mjs");

let failed = 0;
let ran = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function test(name, fn) {
  ran++;
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jskin-updates-"));
}

function writeXpi(dir, name, body) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, body);
  return file;
}

test("sha256File matches crypto and HASH_RE", () => {
  const dir = tmpDir();
  const file = writeXpi(dir, "a.xpi", "hello-xpi");
  const hash = sha256File(file);
  const expect = "sha256:" + crypto.createHash("sha256").update("hello-xpi").digest("hex");
  assert(hash === expect, `hash ${hash} != ${expect}`);
  assert(HASH_RE.test(hash), "HASH_RE rejected a valid sha256");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("compareVersions orders dotted versions (1.4.10 > 1.4.9)", () => {
  assert(compareVersions("1.4.0", "1.4.1") < 0, "1.4.0 should be < 1.4.1");
  assert(compareVersions("1.4.1", "1.4.1") === 0, "equal");
  assert(compareVersions("1.4.10", "1.4.9") > 0, "1.4.10 should be > 1.4.9");
  assert(compareVersions("2.0", "1.9.9") > 0, "2.0 should be > 1.9.9");
});

test("releaseAssetUrl uses the GitHub Releases download URL", () => {
  const url = releaseAssetUrl("1.4.1");
  assert(
    url === "https://github.com/noowxela/joget-skin/releases/download/v1.4.1/joget-skin-1.4.1.xpi",
    url,
  );
});

test("makeEntry builds a valid update object and rejects bad inputs", () => {
  const hash = "sha256:" + "a".repeat(64);
  const entry = makeEntry({
    version: "1.4.1",
    updateLink: "https://example.com/joget-skin-1.4.1.xpi",
    updateHash: hash,
    minVersion: "142.0",
  });
  assert(entry.version === "1.4.1", "version");
  assert(entry.update_link.startsWith("https://"), "link");
  assert(entry.update_hash === hash, "hash");
  assert(entry.applications.gecko.strict_min_version === "142.0", "min version");

  const rejects = [
    () => makeEntry({ version: "v1.4.1", updateLink: "https://x", updateHash: hash }),
    () => makeEntry({ version: "1.4.1-beta", updateLink: "https://x", updateHash: hash }),
    () => makeEntry({ version: "1.4.1", updateLink: "http://insecure.example/x.xpi", updateHash: hash }),
    () => makeEntry({ version: "1.4.1", updateLink: "https://x", updateHash: "sha256:deadbeef" }),
    () => makeEntry({ version: "1.4.1", updateLink: "https://x", updateHash: "sha256:" + "A".repeat(64) }),
  ];
  for (const fn of rejects) {
    let threw = false;
    try { fn(); } catch (e) { threw = true; }
    assert(threw, "expected a rejection");
  }
});

test("mergeEntry keeps other versions and addon ids, replaces same version, sorts", () => {
  const hash = (n) => "sha256:" + String(n).repeat(64);
  const start = {
    addons: {
      "other@id": { updates: [{ version: "9.0", update_link: "https://example.com/9.xpi", update_hash: hash(1) }] },
      "joget-skin@alexwoon": {
        updates: [
          { version: "1.4.9", update_link: "https://example.com/1.4.9.xpi", update_hash: hash(2) },
          { version: "1.4.0", update_link: "https://example.com/old-1.4.0.xpi", update_hash: hash(3) },
        ],
      },
    },
  };
  const mid = mergeEntry(start, "joget-skin@alexwoon", makeEntry({
    version: "1.4.0",
    updateLink: "https://example.com/new-1.4.0.xpi",
    updateHash: hash(4),
    minVersion: "142.0",
  }));
  const out = mergeEntry(mid, "joget-skin@alexwoon", makeEntry({
    version: "1.4.10",
    updateLink: "https://example.com/1.4.10.xpi",
    updateHash: hash(5),
    minVersion: "142.0",
  }));
  const updates = out.addons["joget-skin@alexwoon"].updates;
  assert(updates.map((u) => u.version).join(",") === "1.4.0,1.4.9,1.4.10", updates.map((u) => u.version).join(","));
  assert(updates[0].update_link === "https://example.com/new-1.4.0.xpi", "same version was not replaced");
  assert(out.addons["other@id"].updates.length === 1, "other addon id was dropped");
  assert(stringify(out).endsWith("\n") && stringify(out).includes("  "), "pretty-printed with trailing newline");
});

test("CLI writes a merged updates.json and hashes the xpi", () => {
  const dir = tmpDir();
  const xpi = writeXpi(dir, "joget-skin-1.4.1.xpi", "signed-bytes");
  const input = path.join(dir, "in.json");
  const output = path.join(dir, "out.json");
  fs.writeFileSync(input, stringify({
    addons: {
      "joget-skin@alexwoon": {
        updates: [{
          version: "1.3.10",
          update_link: "https://github.com/noowxela/joget-skin/releases/download/v1.3.10/joget-skin-1.3.10.xpi",
          update_hash: "sha256:" + "b".repeat(64),
        }],
      },
    },
  }));
  const result = spawnSync(process.execPath, [
    GEN,
    "--id", "joget-skin@alexwoon",
    "--version", "1.4.1",
    "--xpi", xpi,
    "--min-version", "142.0",
    "--input", input,
    "--output", output,
  ], { encoding: "utf8" });
  assert(result.status === 0, `cli failed: ${result.stderr || result.stdout}`);
  const doc = JSON.parse(fs.readFileSync(output, "utf8"));
  const updates = doc.addons["joget-skin@alexwoon"].updates;
  assert(updates.length === 2, "expected to keep 1.3.10 and add 1.4.1");
  const added = updates.find((u) => u.version === "1.4.1");
  const expectHash = sha256File(xpi);
  assert(added.update_hash === expectHash, added.update_hash);
  assert(
    added.update_link === "https://github.com/noowxela/joget-skin/releases/download/v1.4.1/joget-skin-1.4.1.xpi",
    added.update_link,
  );
  assert(added.applications.gecko.strict_min_version === "142.0", "min version missing");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("CLI rejects a leading v and a non-https link", () => {
  const dir = tmpDir();
  const xpi = writeXpi(dir, "a.xpi", "x");
  const v = spawnSync(process.execPath, [GEN, "--version", "v1.4.1", "--xpi", xpi, "--id", "joget-skin@alexwoon"], { encoding: "utf8" });
  assert(v.status !== 0 && /leading v|dotted numeric/i.test(v.stderr), `v-prefix: status=${v.status} ${v.stderr}`);
  const http = spawnSync(process.execPath, [
    GEN, "--version", "1.4.1", "--xpi", xpi, "--id", "joget-skin@alexwoon",
    "--update-link", "http://example.com/a.xpi",
  ], { encoding: "utf8" });
  assert(http.status !== 0 && /https:\/\//.test(http.stderr), `http: status=${http.status} ${http.stderr}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("generate() reads id and min-version from this repo's manifest", () => {
  const dir = tmpDir();
  const xpi = writeXpi(dir, "b.xpi", "bytes");
  const doc = generate({ version: "1.4.1", xpi });
  const entry = doc.addons["joget-skin@alexwoon"].updates.find((u) => u.version === "1.4.1");
  assert(entry, "missing 1.4.1 entry");
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  assert(entry.applications.gecko.strict_min_version === manifest.browser_specific_settings.gecko.strict_min_version, "min version not taken from manifest");
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(`\n${ran - failed}/${ran} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
