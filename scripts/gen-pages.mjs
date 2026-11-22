#!/usr/bin/env node
/**
 * Render CHANGELOG.md to a self-contained GitHub Pages index (and changelog.html).
 * No dependencies. Does not write or modify updates.json.
 *
 *   node scripts/gen-pages.mjs \
 *     --changelog CHANGELOG.md \
 *     --output-dir ./site \
 *     --latest-version 1.4.1 \
 *     --require-version 1.4.1
 *
 *   node scripts/gen-pages.mjs --changelog CHANGELOG.md --require-version 1.4.1 --check-only
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const HEADING_RE = /^##\s+v?(\d+(?:\.\d+)*)\s+[—–-]\s+(\d{4}-\d{2}-\d{2})\s*$/;
export const SECTION_NAMES = ["新增", "改进", "修复"];

const DEFAULT_REPO = "https://github.com/noowxela/joget-skin";
const DEFAULT_PAGES = "https://noowxela.github.io/joget-skin";

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderInline(text) {
  const escaped = escapeHtml(text);
  // links, then `code`, then **bold** — after escaping, brackets and asterisks remain
  return escaped
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

export function parseChangelog(md) {
  const lines = String(md).replace(/\r\n/g, "\n").split("\n");
  let title = "更新日志";
  const intro = [];
  const versions = [];
  let current = null;
  let section = null;
  let inIntro = true;

  const flushPara = (target, buf) => {
    const t = buf.join("\n").trim();
    if (t) target.push(t);
    buf.length = 0;
  };

  let para = [];

  const startVersion = (version, date) => {
    if (current) flushPara(section ? current.sections[section] : current.notes, para);
    current = { version, date, notes: [], sections: { 新增: [], 改进: [], 修复: [] }, extra: {} };
    versions.push(current);
    section = null;
    inIntro = false;
    para = [];
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (line.startsWith("# ") && inIntro && !current) {
      title = line.slice(2).trim() || title;
      continue;
    }
    const hm = line.match(HEADING_RE);
    if (hm) {
      startVersion(hm[1], hm[2]);
      continue;
    }
    const sm = line.match(/^###\s+(.+?)\s*$/);
    if (sm && current) {
      flushPara(section ? (SECTION_NAMES.includes(section) ? current.sections[section] : current.extra[section]) : current.notes, para);
      section = sm[1].trim();
      if (!SECTION_NAMES.includes(section) && !current.extra[section]) current.extra[section] = [];
      continue;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      const item = line.slice(2).trim();
      if (current) {
        flushPara(section ? (SECTION_NAMES.includes(section) ? current.sections[section] : current.extra[section]) : current.notes, para);
        const bucket = !section ? current.notes
          : (SECTION_NAMES.includes(section) ? current.sections[section] : current.extra[section]);
        bucket.push(item);
      } else {
        flushPara(intro, para);
        intro.push(item);
      }
      continue;
    }
    if (line.trim() === "") {
      if (current) {
        flushPara(section ? (SECTION_NAMES.includes(section) ? current.sections[section] : current.extra[section]) : current.notes, para);
      } else {
        flushPara(intro, para);
      }
      continue;
    }
    para.push(line);
  }
  if (current) {
    flushPara(section ? (SECTION_NAMES.includes(section) ? current.sections[section] : current.extra[section]) : current.notes, para);
  } else {
    flushPara(intro, para);
  }

  return { title, intro, versions };
}

export function assertHasVersion(doc, version) {
  if (!version) throw new Error("--require-version needs a value");
  if (!doc.versions.some((v) => v.version === version)) {
    const known = doc.versions.map((v) => v.version).join(", ") || "(none)";
    throw new Error(
      `CHANGELOG.md has no "## ${version}" entry; add one before running release.sh. Known versions: ${known}`,
    );
  }
}

export function xpiUrl(version, { repo = DEFAULT_REPO } = {}) {
  return `${repo}/releases/download/v${version}/joget-skin-${version}.xpi`;
}

function sectionList(label, items) {
  if (!items || !items.length) return "";
  const lis = items.map((item) => `          <li>${renderInline(item)}</li>`).join("\n");
  return `        <h3>${escapeHtml(label)}</h3>\n        <ul>\n${lis}\n        </ul>`;
}

function renderVersion(v) {
  const notes = v.notes.map((n) => `        <p>${renderInline(n)}</p>`).join("\n");
  const parts = [notes];
  for (const name of SECTION_NAMES) parts.push(sectionList(name, v.sections[name]));
  for (const [name, items] of Object.entries(v.extra || {})) parts.push(sectionList(name, items));
  return `      <article class="release" id="v${escapeHtml(v.version)}">
        <h2><a href="#v${escapeHtml(v.version)}">${escapeHtml(v.version)}</a> <time datetime="${escapeHtml(v.date)}">${escapeHtml(v.date)}</time></h2>
${parts.filter(Boolean).join("\n")}
      </article>`;
}

export function renderIndex(doc, opts = {}) {
  const latest = opts.latestVersion || (doc.versions[0] && doc.versions[0].version);
  if (!latest) throw new Error("no versions in CHANGELOG.md");
  const repo = opts.repo || DEFAULT_REPO;
  const pages = opts.pagesUrl || DEFAULT_PAGES;
  const updatesUrl = opts.updatesUrl || `${pages}/updates.json`;
  const download = opts.xpiUrl || xpiUrl(latest, { repo });
  const nav = doc.versions.map((v) => `<a href="#v${escapeHtml(v.version)}">${escapeHtml(v.version)}</a>`).join(" · ");
  const intro = doc.intro.map((p) => `      <p>${renderInline(p)}</p>`).join("\n");
  const articles = doc.versions.map(renderVersion).join("\n");

  return `<!DOCTYPE html>
<html lang="zh-Hans">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Joget Skin — 给 Joget DX 9 用的 Firefox 扩展</title>
  <meta name="description" content="Joget Skin 的安装说明、自动更新方式和更新日志。">
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f4f2ec;
      --fg: #1c1b16;
      --muted: #5c5a53;
      --border: #d4d0c4;
      --surface: #fffcf5;
      --accent: #1f4f43;
      --accent-fg: #f4f2ec;
      --link: #1a4a78;
      --chip: #e8e4d8;
      --shadow: 0 1px 0 rgba(28, 27, 22, 0.06);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #141412;
        --fg: #eceae3;
        --muted: #a8a59b;
        --border: #3a3933;
        --surface: #1c1c18;
        --accent: #9ec9bb;
        --accent-fg: #141412;
        --link: #9cbcdd;
        --chip: #2a2924;
        --shadow: 0 1px 0 rgba(0, 0, 0, 0.4);
      }
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--fg);
      font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Noto Sans SC", "Segoe UI", sans-serif;
    }
    a { color: var(--link); text-underline-offset: 0.15em; }
    a:hover { text-decoration-thickness: 2px; }
    main {
      max-width: 42rem;
      margin: 0 auto;
      padding: 2.5rem 1.25rem 4.5rem;
    }
    .eyebrow {
      margin: 0 0 0.4rem;
      color: var(--muted);
      font-size: 0.82rem;
      letter-spacing: 0.04em;
    }
    h1 {
      margin: 0 0 0.6rem;
      font-size: 1.85rem;
      font-weight: 650;
      letter-spacing: -0.02em;
      line-height: 1.25;
    }
    .lead { margin: 0 0 1.25rem; color: var(--muted); }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.6rem 0.9rem;
      align-items: center;
      margin: 0 0 1.75rem;
    }
    .btn {
      display: inline-block;
      padding: 0.45rem 0.9rem;
      border-radius: 8px;
      background: var(--accent);
      color: var(--accent-fg);
      text-decoration: none;
      font-weight: 600;
      box-shadow: var(--shadow);
    }
    .btn:hover { filter: brightness(1.05); text-decoration: none; }
    .links { color: var(--muted); font-size: 0.95rem; }
    .links a { margin-right: 0.7rem; }
    section.card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1rem 1.1rem 0.85rem;
      margin: 0 0 1rem;
    }
    section.card h2, #changelog-title {
      margin: 0 0 0.6rem;
      font-size: 1.05rem;
    }
    ol { margin: 0.2rem 0 0.4rem; padding-left: 1.25rem; }
    ol li { margin: 0.25rem 0; }
    .versions {
      margin: 0 0 1.25rem;
      padding: 0.7rem 0 0;
      color: var(--muted);
      font-size: 0.92rem;
      line-height: 1.85;
    }
    .release {
      border-top: 1px solid var(--border);
      padding: 1.25rem 0 0.4rem;
    }
    .release h2 {
      margin: 0 0 0.55rem;
      font-size: 1.2rem;
      font-weight: 650;
    }
    .release h2 a { color: inherit; text-decoration: none; }
    .release h2 a:hover { text-decoration: underline; }
    .release time {
      margin-left: 0.45rem;
      color: var(--muted);
      font-size: 0.92rem;
      font-weight: 500;
    }
    .release h3 {
      margin: 0.85rem 0 0.3rem;
      font-size: 0.78rem;
      font-weight: 650;
      letter-spacing: 0.08em;
      color: var(--muted);
      text-transform: none;
    }
    .release ul { margin: 0.15rem 0 0.4rem; padding-left: 1.2rem; }
    .release li { margin: 0.28rem 0; }
    .release p { margin: 0.4rem 0 0.6rem; }
    code {
      font: 0.9em/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      background: var(--chip);
      padding: 0.05em 0.35em;
      border-radius: 4px;
    }
    footer {
      margin-top: 2.5rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border);
      color: var(--muted);
      font-size: 0.88rem;
    }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">Firefox 扩展 · Joget DX 9</p>
    <h1>Joget Skin</h1>
    <p class="lead">给 Joget DX 9 用的个人扩展：整理 Builder 和 userview 界面，并加上一些好用的工具。不在 AMO 公开目录上架，用签过名的 xpi 自己分发。</p>
    <p class="actions">
      <a class="btn" href="${escapeHtml(download)}">下载 ${escapeHtml(latest)} 签名包（.xpi）</a>
      <span class="links">
        <a href="${escapeHtml(repo)}/releases">所有版本</a>
        <a href="#install">安装说明</a>
        <a href="#changelog">更新日志</a>
        <a href="changelog.html">仅日志</a>
        <a href="${escapeHtml(repo)}">源代码</a>
      </span>
    </p>

    <section class="card" id="install">
      <h2>安装</h2>
      <ol>
        <li>下载上面的签名包（或到 <a href="${escapeHtml(repo)}/releases">Releases</a> 选一个版本）。</li>
        <li>在 Firefox 打开 <code>about:addons</code> → 齿轮菜单 → 「从文件安装附加组件」，选这个 <code>.xpi</code> 文件。</li>
        <li>第一个会自动更新的版本是 <strong>1.4.1</strong>。如果现在装的是更早的版本，需要按上面的步骤再装一次 1.4.1 或更新的签名包。</li>
      </ol>
    </section>

    <section class="card" id="updates">
      <h2>自动更新</h2>
      <p>装好带 <code>update_url</code> 的签名包之后，Firefox 大约每 24 小时会查一次更新清单，发现更高版本就自动下载并替换。也可以在 <code>about:addons</code> 的齿轮菜单里点「检查更新」，马上检查一次。</p>
      <p>从 <code>about:debugging</code> 临时加载源码文件夹适合开发，<strong>不会</strong>自动更新，Firefox 重启后也要重新加载。</p>
      <p>给 Firefox 看的更新清单：<a href="${escapeHtml(updatesUrl)}"><code>updates.json</code></a>。</p>
    </section>

    <h2 id="changelog-title"><a id="changelog"></a>更新日志</h2>
${intro}
    <nav class="versions">${nav}</nav>
${articles}

    <footer>
      <p>gecko id <code>joget-skin@alexwoon</code> · 需要 Firefox 142 或更高版本。日志原文在仓库的 <a href="${escapeHtml(repo)}/blob/main/CHANGELOG.md">CHANGELOG.md</a>。</p>
    </footer>
  </main>
</body>
</html>
`;
}

export function renderChangelogPage(doc, opts = {}) {
  // Same document with a short header that points home — useful permalink.
  const html = renderIndex(doc, opts);
  return html
    .replace("<title>Joget Skin — 给 Joget DX 9 用的 Firefox 扩展</title>", "<title>Joget Skin 更新日志</title>")
    .replace(
      '    <p class="eyebrow">Firefox 扩展 · Joget DX 9</p>\n    <h1>Joget Skin</h1>',
      '    <p class="eyebrow"><a href="./">Joget Skin</a> · 更新日志</p>\n    <h1>更新日志</h1>',
    );
}

export function generate(opts) {
  const md = fs.readFileSync(opts.changelog, "utf8");
  const doc = parseChangelog(md);
  if (opts.requireVersion) assertHasVersion(doc, opts.requireVersion);
  if (opts.checkOnly) return { doc, files: {} };
  const latest = opts.latestVersion || opts.requireVersion || (doc.versions[0] && doc.versions[0].version);
  const renderOpts = {
    latestVersion: latest,
    repo: opts.repo,
    pagesUrl: opts.pagesUrl,
    updatesUrl: opts.updatesUrl,
    xpiUrl: opts.xpiUrl || (latest && xpiUrl(latest, { repo: opts.repo })),
  };
  return {
    doc,
    files: {
      "index.html": renderIndex(doc, renderOpts),
      "changelog.html": renderChangelogPage(doc, renderOpts),
    },
  };
}

function usage(code = 1) {
  console.error(`Usage: node scripts/gen-pages.mjs [options]
  --changelog <file>        default: CHANGELOG.md
  --output-dir <dir>        write index.html and changelog.html here
  --latest-version <ver>    version used for the download button
  --require-version <ver>   fail if CHANGELOG.md has no heading for this version
  --check-only              only check --require-version; write nothing
  --xpi-url <url>           override the download URL
  --repo <url>              default: ${DEFAULT_REPO}
  --updates-url <url>       default: ${DEFAULT_PAGES}/updates.json`);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = {};
  const keys = {
    "--changelog": "changelog",
    "--output-dir": "outputDir",
    "--latest-version": "latestVersion",
    "--require-version": "requireVersion",
    "--xpi-url": "xpiUrl",
    "--repo": "repo",
    "--updates-url": "updatesUrl",
    "--pages-url": "pagesUrl",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") usage(0);
    if (a === "--check-only") { opts.checkOnly = true; continue; }
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

function isMain() {
  const entry = process.argv[1] && path.resolve(process.argv[1]);
  return entry && entry === fileURLToPath(import.meta.url);
}

if (isMain()) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const changelog = path.resolve(opts.changelog || "CHANGELOG.md");
    if (!fs.existsSync(changelog)) throw new Error(`CHANGELOG.md not found at ${changelog}`);
    const result = generate({ ...opts, changelog });
    if (opts.checkOnly) {
      console.log(`CHANGELOG.md has ## ${opts.requireVersion || result.doc.versions[0].version}`);
      process.exit(0);
    }
    const outDir = path.resolve(opts.outputDir || ".");
    fs.mkdirSync(outDir, { recursive: true });
    for (const [name, body] of Object.entries(result.files)) {
      fs.writeFileSync(path.join(outDir, name), body);
    }
    console.log(`wrote ${path.join(outDir, "index.html")} and changelog.html (${result.doc.versions.length} versions)`);
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}
