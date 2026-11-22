#!/usr/bin/env node
/**
 * Unit tests for scripts/gen-pages.mjs (no Joget, no Playwright).
 *
 *   node tests/pages.test.mjs
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import {
  parseChangelog,
  assertHasVersion,
  escapeHtml,
  renderInline,
  renderIndex,
  generate,
  HEADING_RE,
} from "../scripts/gen-pages.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const GEN = path.join(ROOT, "scripts/gen-pages.mjs");

let failed = 0;
let ran = 0;
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function test(name, fn) {
  ran++;
  try { fn(); console.log(`PASS  ${name}`); }
  catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.message}`); }
}

const SAMPLE = `# 更新日志

这是引言，含 [链接](https://example.com/x) 和 \`code\`。

## 1.4.2 — 2026-12-01

即将发布的说明。

### 新增
- 新功能 **加粗**
- 含 <script>alert(1)</script> 的项

### 改进
- 改了一点

## 1.4.1 — 2026-11-22

第一个自动更新版本。

### 新增
- 自托管自动更新
`;

test("HEADING_RE accepts em dash and hyphen, rejects junk", () => {
  assert(HEADING_RE.test("## 1.4.1 — 2026-11-22"), "em dash");
  assert(HEADING_RE.test("## 1.4.1 - 2026-11-22"), "hyphen");
  assert(!HEADING_RE.test("## soon"), "no date");
  assert(!HEADING_RE.test("## 1.4.1"), "version only");
});

test("parseChangelog reads versions, dates, sections, intro", () => {
  const doc = parseChangelog(SAMPLE);
  assert(doc.title === "更新日志", doc.title);
  assert(doc.intro[0].includes("引言"), doc.intro[0]);
  assert(doc.versions.map((v) => v.version).join(",") === "1.4.2,1.4.1", doc.versions.map((v) => v.version).join(","));
  assert(doc.versions[0].date === "2026-12-01", doc.versions[0].date);
  assert(doc.versions[0].sections["新增"].length === 2, "新增");
  assert(doc.versions[0].sections["改进"][0] === "改了一点", "改进");
  assert(doc.versions[1].notes[0].includes("自动更新"), doc.versions[1].notes[0]);
});

test("assertHasVersion fails with a clear message", () => {
  const doc = parseChangelog(SAMPLE);
  assertHasVersion(doc, "1.4.1");
  let err;
  try { assertHasVersion(doc, "1.4.0"); } catch (e) { err = e; }
  assert(err && /CHANGELOG.md has no "## 1.4.0" entry/.test(err.message), String(err && err.message));
});

test("HTML is escaped; inline markdown still works", () => {
  assert(escapeHtml("<x>") === "&lt;x&gt;", "escape");
  const html = renderInline("看 [这里](https://example.com/a) 和 `x` 与 **粗** 以及 <b>raw</b>");
  assert(html.includes('<a href="https://example.com/a">这里</a>'), html);
  assert(html.includes("<code>x</code>"), html);
  assert(html.includes("<strong>粗</strong>"), html);
  assert(html.includes("&lt;b&gt;raw&lt;/b&gt;"), html);
  assert(!html.includes("<b>raw</b>"), "raw tag leaked");
});

test("renderIndex uses the requested latest version and contains entries", () => {
  const doc = parseChangelog(SAMPLE);
  const html = renderIndex(doc, { latestVersion: "1.4.1", xpiUrl: "https://github.com/noowxela/joget-skin/releases/download/v1.4.1/joget-skin-1.4.1.xpi" });
  assert(html.includes("下载 1.4.1 签名包"), "download label");
  assert(html.includes("joget-skin-1.4.1.xpi"), "xpi url");
  assert(html.includes('id="v1.4.1"'), "anchor");
  assert(html.includes("自托管自动更新"), "1.4.1 body");
  assert(html.includes("1.4.2"), "still lists newer changelog entry");
  assert(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "xss escaped");
  assert(!html.includes("<script>alert(1)</script>"), "script leaked");
  assert(html.includes("prefers-color-scheme: dark"), "dark mode");
  assert(html.includes("updates.json"), "updates link");
});

test("generate writes only HTML files, never updates.json", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jskin-pages-"));
  const md = path.join(dir, "CHANGELOG.md");
  fs.writeFileSync(md, SAMPLE);
  const out = path.join(dir, "site");
  const result = generate({ changelog: md, requireVersion: "1.4.1", latestVersion: "1.4.1", outputDir: out });
  assert(Object.keys(result.files).sort().join(",") === "changelog.html,index.html", Object.keys(result.files).join(","));
  assert(!Object.keys(result.files).includes("updates.json"), "must not emit updates.json");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("CLI --check-only and --require-version, and writes files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jskin-pages-cli-"));
  const md = path.join(dir, "CHANGELOG.md");
  fs.writeFileSync(md, SAMPLE);
  const ok = spawnSync(process.execPath, [GEN, "--changelog", md, "--require-version", "1.4.1", "--check-only"], { encoding: "utf8" });
  assert(ok.status === 0, ok.stderr || ok.stdout);
  const bad = spawnSync(process.execPath, [GEN, "--changelog", md, "--require-version", "9.9.9", "--check-only"], { encoding: "utf8" });
  assert(bad.status !== 0 && /## 9.9.9/.test(bad.stderr), bad.stderr);
  const out = path.join(dir, "site");
  const wrote = spawnSync(process.execPath, [
    GEN, "--changelog", md, "--output-dir", out,
    "--latest-version", "1.4.1", "--require-version", "1.4.1",
  ], { encoding: "utf8" });
  assert(wrote.status === 0, wrote.stderr || wrote.stdout);
  const index = fs.readFileSync(path.join(out, "index.html"), "utf8");
  const log = fs.readFileSync(path.join(out, "changelog.html"), "utf8");
  assert(index.includes("下载 1.4.1"), index.slice(0, 200));
  assert(log.includes("更新日志"), "changelog page");
  assert(!fs.existsSync(path.join(out, "updates.json")), "CLI must not write updates.json");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("repo CHANGELOG.md parses and includes 1.4.1 through 1.0.0", () => {
  const md = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
  const doc = parseChangelog(md);
  const versions = doc.versions.map((v) => v.version);
  assert(versions[0] === "1.4.1", "newest should be 1.4.1, got " + versions[0]);
  assert(versions.includes("1.4.0") && versions.includes("1.3.10") && versions.includes("1.1.0") && versions.includes("1.0.0"), versions.join(","));
  assertHasVersion(doc, "1.4.1");
  const html = renderIndex(doc, { latestVersion: "1.4.1" });
  assert(html.includes("下载 1.4.1 签名包"), "live changelog download");
  assert(html.includes("自托管自动更新") || html.includes("自动更新"), "1.4.1 text");
});

console.log(`\n${ran - failed}/${ran} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
