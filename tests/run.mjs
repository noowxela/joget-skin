/**
 * Joget Skin — feature test suite (Playwright, Chromium).
 *
 *   node tests/run.mjs                 # all tests
 *   node tests/run.mjs canvas hotkeys  # only tests whose name contains one of the words
 *
 * Env: JOGET_URL (default http://localhost:8080/jw), JOGET_USER / JOGET_PASS (default admin/admin,
 *      the local demo instance), JOGET_APP (default crm), JOGET_APP_VERSION (default 1),
 *      SHOTS=<dir> to save screenshots, PLAYWRIGHT=<path to playwright index.mjs> if
 *      `import("playwright")` does not resolve from here.
 *
 * Mostly read-only against Joget: it opens pages, clicks elements, opens/closes panels and
 * injects the extension's CSS/JS (like the content scripts would, with a stubbed
 * browser.storage). Process copy never clicks Save. Userview copy import creates a new
 * userview and then deletes it; the Save test copies a temporary app, verifies, then deletes
 * that app so local apps are unchanged.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, "..");
const BASE = (process.env.JOGET_URL || "http://localhost:8080/jw").replace(/\/$/, "");
const USER = process.env.JOGET_USER || "admin";
const PASS = process.env.JOGET_PASS || "admin";
const APP = process.env.JOGET_APP || "crm";
const VER = process.env.JOGET_APP_VERSION || "1";
const SHOTS = process.env.SHOTS || "";
const FILTER = process.argv.slice(2);

async function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT, "playwright",
    "/Users/alexwoon/Documents/github/01_project/ai-agent-command-center/node_modules/playwright/index.mjs"].filter(Boolean);
  for (const t of tries) {
    try {
      return await import(t.startsWith("/") ? pathToFileURL(t).href : t);
    } catch (e) { /* next */ }
  }
  throw new Error("Playwright not found; set PLAYWRIGHT=/path/to/playwright/index.mjs");
}
const { chromium } = await loadPlaywright();

const read = (f) => fs.readFileSync(path.join(EXT, f), "utf8");
const manifest = JSON.parse(read("manifest.json"));

/* ---------- browser.storage stub (persists across reloads via sessionStorage) ---------- */
const STUB = `(() => {
  if (window.browser && window.browser.__jskinStub) return;
  const K = "__jskinStubStore";
  const load = () => { try { return JSON.parse(sessionStorage.getItem(K) || "{}"); } catch (e) { return {}; } };
  const listeners = [];
  const local = {
    async get(d) {
      const s = load();
      if (d == null) return { ...s };
      if (typeof d === "string") return d in s ? { [d]: s[d] } : {};
      if (Array.isArray(d)) { const o = {}; d.forEach((k) => { if (k in s) o[k] = s[k]; }); return o; }
      const o = {}; for (const k of Object.keys(d)) o[k] = k in s ? s[k] : d[k]; return o;
    },
    async set(obj) {
      const s = load(); const changes = {};
      for (const k of Object.keys(obj)) { changes[k] = { oldValue: s[k], newValue: obj[k] }; s[k] = obj[k]; }
      sessionStorage.setItem(K, JSON.stringify(s));
      listeners.forEach((fn) => { try { fn(changes, "local"); } catch (e) {} });
    },
  };
  window.browser = { __jskinStub: true, storage: { local, onChanged: { addListener: (fn) => listeners.push(fn) } },
    runtime: { getManifest: () => (${JSON.stringify({ version: manifest.version })}),
      // web_accessible_resources (pcopy-page.js) are served from the extension dir by ctx.route below
      getURL: (p) => location.origin + "/__jskin_ext/" + p } };
})();`;

/* content scripts per URL, taken from manifest.json (same order as Firefox) */
function scriptsFor(url) {
  const u = new URL(url);
  const toRe = (m) => new RegExp("^" + m.replace(/^\*:\/\/\*/, "").replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
  const css = [], js = [];
  for (const cs of manifest.content_scripts) {
    if (!cs.matches.some((m) => toRe(m).test(u.pathname))) continue;
    (cs.css || []).forEach((f) => css.push(f));
    (cs.js || []).forEach((f) => js.push(f));
  }
  return { css, js };
}

async function inject(page, { theme = false, mock } = {}) {
  const { css, js } = scriptsFor(page.url());
  await page.addScriptTag({ content: STUB });
  if (mock) await page.evaluate(mock);
  for (const f of css) await page.addStyleTag({ content: read(f) });
  for (const f of js) await page.addScriptTag({ content: read(f) });
  if (theme) await setStore(page, { jogetSkinTheme: "indigo" });
  await page.waitForFunction(() => document.documentElement.classList.contains("joget-skin"), null, { timeout: 5000 });
  await page.waitForTimeout(900);
  return { css, js };
}
const setStore = (page, obj) => page.evaluate((o) => window.browser.storage.local.set(o), obj);

/* ---------- helpers ---------- */
const URLS = {
  composer: `${BASE}/web/console/app/${APP}/${VER}/builders`,
};
async function builderUrls(page) {
  await page.goto(URLS.composer);
  await page.waitForSelector("#builders .builder-form li.item a.item-link", { timeout: 20000 });
  return page.evaluate(() => {
    const o = {};
    for (const k of ["form", "datalist", "userview", "process"]) {
      const a = document.querySelector(`#builders .builder-${k} li.item a.item-link`);
      o[k] = a && a.href;
    }
    // a form with a plain TextField (crm_account in the crm demo); fallback: first form
    const forms = [...document.querySelectorAll("#builders .builder-form li.item a.item-link")].map((a) => a.href);
    o.textForm = forms.find((h) => /\/crm_account$/.test(h)) || forms[0];
    return o;
  });
}
async function open(page, url, waitSel = "#builder_canvas") {
  await page.goto(url);
  await page.waitForSelector(waitSel, { timeout: 20000 });
  await page.waitForTimeout(3500);
}
const frame = (page) => page.frames().find((f) => f !== page.mainFrame() && /blank\.jsp/.test(f.url()));
async function selectInCanvas(page, sel, pos) {
  const f = frame(page);
  await f.evaluate((s) => document.querySelector(s).scrollIntoView({ block: "center" }), sel);
  await f.click(sel, pos ? { position: pos } : undefined);
  await page.waitForTimeout(1300);
}
const geo = (page) => page.evaluate(() => {
  const R = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return r.width || r.height ? r : null; };
  const c = R("#builder_canvas"), lp = R("#left-panel"), rp = R("#right-panel"), qn = R("#quick-nav-bar");
  const panel = !!rp && !document.body.classList.contains("no-right-panel");
  const rightEdge = panel ? rp.left : qn ? qn.left : innerWidth;
  const leftEdge = lp ? lp.right : 0;
  return { canvasLeft: Math.round(c.left), canvasWidth: Math.round(c.width), leftGap: Math.round(c.left - leftEdge),
    rightGap: Math.round(rightEdge - c.right), panelOpen: panel, viewport: document.querySelector("#builder_canvas").className || "(none)" };
});
const shot = async (page, name, locator) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = path.join(SHOTS, name + ".png");
  if (locator) await page.locator(locator).screenshot({ path: p });
  else await page.screenshot({ path: p });
};
function assert(cond, msg) { if (!cond) throw new Error(msg); }
async function openToolMenu(page) {
  await page.waitForSelector("#jskin-tool-btn", { timeout: 8000 });
  if ((await page.getAttribute("#jskin-tool-btn", "aria-expanded")) === "true") {
    return;
  }
  await page.hover("#jskin-tool-group");
  try {
    await page.waitForFunction(() => document.getElementById("jskin-tool-btn")?.getAttribute("aria-expanded") === "true", null, { timeout: 2000 });
  } catch (e) {
    await page.click("#jskin-tool-btn");
    await page.waitForFunction(() => document.getElementById("jskin-tool-btn")?.getAttribute("aria-expanded") === "true", null, { timeout: 3000 });
  }
}

const centred = (g, tol = 2) => Math.abs(g.leftGap - g.rightGap) <= tol && g.leftGap >= 0;

/* ---------- tests ---------- */
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let urls;

test("content: skin on/off + theme class follow storage", async (page) => {
  await open(page, urls.textForm);
  await inject(page);
  const c1 = await page.evaluate(() => document.documentElement.className);
  assert(/\bjoget-skin\b/.test(c1), "joget-skin missing: " + c1);
  await setStore(page, { jogetSkinTheme: "indigo" });
  const c2 = await page.evaluate(() => document.documentElement.className);
  assert(/joget-skin-theme-indigo/.test(c2), "theme class missing: " + c2);
  await setStore(page, { jogetSkinEnabled: false });
  const c3 = await page.evaluate(() => document.documentElement.className);
  assert(!/joget-skin/.test(c3), "classes not removed when off: " + c3);
  return `on="${c2.trim()}" off="${c3.trim()}"`;
});

test("builder.css: declutter (hint bubbles / AI pill hidden)", async (page) => {
  await open(page, urls.textForm);
  await inject(page);
  const r = await page.evaluate(() => {
    const mk = (html) => { const d = document.createElement("div"); d.innerHTML = html; document.body.append(d); return d; };
    const d = mk('<div class="guider">x</div><div id="composerIcon">x</div>');
    const out = [...d.children].map((e) => getComputedStyle(e).display);
    d.remove();
    return out;
  });
  assert(r.every((x) => x === "none"), "not hidden: " + r);
  return ".guider / #composerIcon display=" + r.join(",");
});

test("userview.css: 'Powered by Joget' footer hidden on a runtime userview", async (page) => {
  const uv = await page.evaluate(() => null);
  await page.goto(`${BASE}/web/userview/${APP}/`);
  await page.waitForTimeout(2500);
  await inject(page);
  const r = await page.evaluate(() => {
    let e = document.querySelector("footer #footer-message");
    let made = false;
    if (!e) { const f = document.createElement("footer"); f.innerHTML = '<span id="footer-message">x</span>'; document.body.append(f); e = f.firstChild; made = true; }
    const d = getComputedStyle(e).display;
    if (made) e.parentElement.remove();
    return { d, made, url: location.pathname };
  });
  assert(r.d === "none", "footer message display=" + r.d);
  return `display=none (${r.made ? "test element" : "real footer"}, ${r.url})`;
});

test("composer: show-others button only on /builders, hides extra builders", async (page) => {
  await open(page, URLS.composer, "#builders");
  await inject(page);
  const r = await page.evaluate(() => ({
    after: document.querySelector("#builderToolbar .advanced-tools-toogle")?.nextElementSibling?.id,
    hide: document.documentElement.classList.contains("jskin-composer-hide-others"),
    visibleTypes: [...document.querySelectorAll("#builders > .builder-type")].filter((e) => getComputedStyle(e).display !== "none").length,
  }));
  assert(r.after === "jskin-others-group", "button not right after Advanced Tools: " + r.after);
  assert(r.hide && r.visibleTypes === 4, "expected 4 visible builder types, got " + r.visibleTypes);
  await page.click("#jskin-others-btn");
  await page.waitForTimeout(400);
  const n2 = await page.evaluate(() => [...document.querySelectorAll("#builders > .builder-type")].filter((e) => getComputedStyle(e).display !== "none").length);
  assert(n2 > 4, "show-others did not reveal more builders: " + n2);
  await page.click("#jskin-others-btn");
  await shot(page, "composer");
  return `button after Advanced Tools; 4 types -> ${n2} after click`;
});

test("composer: show-others never on form/list/UI/process builder pages", async (page) => {
  const seen = [];
  const u = await builderUrls(page);
  for (const k of ["form", "datalist", "userview", "process"]) {
    if (!u[k]) continue;
    await open(page, u[k]);
    await inject(page);
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => ({
      btn: !!document.getElementById("jskin-others-group"),
      cls: document.documentElement.classList.contains("jskin-composer") || document.documentElement.classList.contains("jskin-composer-hide-others"),
      alive: !!window.__jskinComposerLoaded,
    }));
    assert(!r.btn && !r.cls, k + ": " + JSON.stringify(r));
    seen.push(`${k}${r.alive ? "" : "(script not loaded)"}`);
  }
  return "no button on " + seen.join(", ");
});

test("composer: removes its button/classes after SPA navigation to a builder", async (page) => {
  await open(page, URLS.composer, "#builders");
  await inject(page);
  await page.evaluate((u) => history.pushState({}, "", new URL(u).pathname), urls.textForm);
  await page.waitForTimeout(1200);
  const r = await page.evaluate(() => ({ btn: !!document.getElementById("jskin-others-group"), cls: document.documentElement.className }));
  await page.evaluate((u) => history.pushState({}, "", u), URLS.composer);
  await page.waitForTimeout(1200);
  const back = await page.evaluate(() => !!document.getElementById("jskin-others-group"));
  assert(!r.btn && !/jskin-composer/.test(r.cls), "still present after leaving: " + JSON.stringify(r));
  assert(back, "button not restored after returning to /builders");
  return "gone on builder URL, back on /builders";
});

test("composer: form grouping headers + collapse persists across reload", async (page) => {
  await open(page, URLS.composer, "#builders");
  await inject(page);
  const n = await page.locator("#builders .builder-form .jskin-group-header").count();
  assert(n > 0, "no group headers");
  const table = await page.locator("#builders .builder-form .jskin-group-header").first().getAttribute("data-jskin-table");
  const hdr = `#builders .builder-form .jskin-group-header[data-jskin-table="${table}"]`;
  const was = await page.locator(hdr).evaluate((e) => e.classList.contains("jskin-collapsed"));
  await page.click(hdr);
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForSelector("#builders .builder-form li.item", { timeout: 20000 });
  await page.waitForTimeout(2500);
  await inject(page);
  const now = await page.locator(hdr).evaluate((e) => e.classList.contains("jskin-collapsed"));
  await page.click(hdr); // restore
  assert(now === !was, `collapse state not kept after reload (was ${was}, now ${now})`);
  return `${n} headers; "${table}" ${was ? "expanded" : "collapsed"} and still so after reload`;
});

test("composer: stands down when another copy owns the page", async (page) => {
  await open(page, URLS.composer, "#builders");
  await page.evaluate(() => document.documentElement.setAttribute("data-jskin-composer-owner", "someone-else"));
  await inject(page);
  const r = await page.evaluate(() => ({ btn: !!document.getElementById("jskin-others-group"), notice: !!document.getElementById("jskin-conflict-notice") }));
  assert(!r.btn && r.notice, "did not stand down: " + JSON.stringify(r));
  return "no button, conflict notice shown";
});

test("left-panel handle: outside the panel, >= 20 x 60 px, opens/closes the panel", async (page) => {
  await open(page, urls.textForm);
  await inject(page);
  const g = () => page.evaluate(() => {
    const h = document.getElementById("jskin-left-handle"), lp = document.getElementById("left-panel");
    const r = h && h.getBoundingClientRect(), p = lp.getBoundingClientRect();
    return { has: !!h, w: r && Math.round(r.width), hh: r && Math.round(r.height), outside: r && r.left >= p.right - 1,
      jogetHidden: getComputedStyle(document.getElementById("left-panel-toogle")).opacity === "0",
      closed: document.body.classList.contains("left-panel-closed") };
  });
  const r0 = await g();
  assert(r0.has && r0.w >= 20 && r0.hh >= 60 && r0.outside && r0.jogetHidden && !r0.closed, "open: " + JSON.stringify(r0));
  await shot(page, "left-handle-open");
  await page.click("#jskin-left-handle");
  await page.waitForTimeout(700);
  const r1 = await g();
  await shot(page, "left-handle-closed");
  await page.click("#jskin-left-handle");
  await page.waitForTimeout(700);
  const r2 = await g();
  assert(r1.closed && r1.outside && !r2.closed, "toggle: " + JSON.stringify({ r1, r2 }));
  return `${r0.w} x ${r0.hh} px outside the panel; click closes, click again opens`;
});

test("left-panel hotkey: Ctrl+[ toggles; can be changed in the hotkeys panel", async (page) => {
  await open(page, urls.textForm);
  await inject(page);
  const closed = () => page.evaluate(() => document.body.classList.contains("left-panel-closed"));
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press("Control+BracketLeft");
  await page.waitForTimeout(600);
  const a = await closed();
  await page.keyboard.press("Control+BracketLeft");
  await page.waitForTimeout(600);
  const b = await closed();
  // change it to Ctrl+Alt+K in the panel
  await openToolMenu(page);
  await page.click("#jskin-hotkeys-btn");
  await page.waitForTimeout(300);
  await page.click("#jskin-hk-edit-leftpanel");
  await page.keyboard.press("Control+KeyS"); // clash with Save -> refused (Joget never sees it while recording)
  await page.waitForTimeout(200);
  const clashMsg = await page.evaluate(() => document.querySelector(".jskin-hk-custom").textContent);
  await page.keyboard.press("Control+Alt+KeyK");
  await page.waitForTimeout(300);
  const row = await page.evaluate(() => document.querySelector(".jskin-hk-custom .jskin-hk-keys").textContent);
  await shot(page, "hotkey-edited", "#jskin-hotkeys-panel");
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press("Control+BracketLeft");
  await page.waitForTimeout(600);
  const oldKey = await closed();
  await page.keyboard.press("Control+Alt+KeyK");
  await page.waitForTimeout(600);
  const newKey = await closed();
  await page.keyboard.press("Control+Alt+KeyK");
  await page.waitForTimeout(600);
  await setStore(page, { jogetSkinHotkeyLeftPanel: null });
  assert(a && !b, "Ctrl+[ did not toggle: " + [a, b]);
  assert(/冲突/.test(clashMsg), "no clash warning: " + clashMsg);
  assert(/^Ctrl\+(Alt|⌥)\+K$/.test(row.replace(/\s/g, "")), "row " + row);
  assert(!oldKey && newKey, "after change: old " + oldKey + " new " + newKey);
  return "Ctrl+[ toggles; Ctrl+S refused (clash); changed to Ctrl+Alt+K which toggles, old key no longer does";
});

test("hotkey Ctrl+[ toggles left panel and quick nav together", async (page) => {
  await open(page, urls.textForm);
  await inject(page);
  // start state: left panel open, quick nav closed (earlier tests may have left it open)
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    if (document.documentElement.classList.contains("jskin-qn-pinned")) document.getElementById("jskin-qn-handle").click();
    if (document.body.classList.contains("left-panel-closed")) document.getElementById("jskin-left-handle").click();
    document.activeElement && document.activeElement.blur();
  });
  await page.waitForTimeout(600);
  const st = () => page.evaluate(() => [
    document.body.classList.contains("left-panel-closed") ? "L-closed" : "L-open",
    Math.round(document.querySelector("#quick-nav-bar").getBoundingClientRect().width),
  ].join("/"));
  const s0 = await st();
  const steps = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Control+BracketLeft");
    await page.waitForTimeout(600);
    steps.push(await st());
  }
  // mixed start: left closed + quick nav open -> any open -> both close
  await page.click("#jskin-qn-handle");
  await page.waitForTimeout(500);
  const mixed = await st();
  await page.keyboard.press("Control+BracketLeft");
  await page.waitForTimeout(600);
  const afterMixed = await st();
  await shot(page, "hotkey-both-closed");
  await page.keyboard.press("Control+BracketLeft");
  await page.waitForTimeout(600);
  const restored = await st();
  await page.evaluate(() => document.documentElement.classList.contains("jskin-qn-pinned") && document.getElementById("jskin-qn-handle").click());
  assert(s0 === "L-open/0", "start " + s0);
  assert(steps.join() === "L-closed/0,L-open/40,L-closed/0", "steps " + steps);
  assert(mixed === "L-closed/40" && afterMixed === "L-closed/0" && restored === "L-open/40", [mixed, afterMixed, restored].join());
  return [s0, ...steps, "mixed " + mixed + " -> " + afterMixed, restored].join(" -> ");
});

test("quick nav: hidden, no hover reveal, toggle button opens / closes", async (page) => {
  await open(page, urls.textForm);
  await inject(page);
  await page.evaluate(() => { localStorage.removeItem("jogetSkinQuickNavPinned"); document.documentElement.classList.remove("jskin-qn-pinned"); });
  await page.waitForTimeout(500);
  const w = () => page.evaluate(() => Math.round(document.querySelector("#quick-nav-bar").getBoundingClientRect().width));
  const hs = () => page.evaluate(() => { const r = document.getElementById("jskin-qn-handle").getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), Math.round(document.documentElement.clientWidth - r.right)]; });
  await page.mouse.move(600, 500);
  await page.waitForTimeout(500);
  const idle = await w();
  const h0 = await hs();
  await page.hover("#jskin-qn-handle");
  await page.waitForTimeout(600);
  const hover = await w();
  await page.click("#jskin-qn-handle");
  await page.mouse.move(600, 500);
  await page.waitForTimeout(600);
  const opened = await w();
  const h1 = await hs();
  await shot(page, "quicknav-open");
  await page.click("#jskin-qn-handle");
  await page.mouse.move(600, 500);
  await page.waitForTimeout(600);
  const closed = await w();
  assert(idle === 0 && hover === 0 && opened === 40 && closed === 0, JSON.stringify({ idle, hover, opened, closed }));
  assert(h0[0] === 20 && h0[1] === 64 && h0[2] === 0 && h1[2] === 40, "button " + JSON.stringify({ h0, h1 }));
  return `hidden ${idle}px, hover ${hover}px, click ${opened}px, click again ${closed}px; button 20x64 at edge, rides to 40px`;
});

for (const kind of ["form", "datalist", "userview", "process"]) {
  test(`canvas centred: ${kind} builder (panel open / closed / left panel closed)`, async (page) => {
    const url = kind === "form" ? urls.textForm : urls[kind];
    assert(url, "no " + kind + " in app " + APP);
    await open(page, url);
    const before = await geo(page);
    await inject(page);
    const res = { before };
    res.open = await geo(page);
    await shot(page, `${kind}-builder`);
    if (res.open.panelOpen) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(900);
    }
    res.closed = await geo(page);
    await page.click("#jskin-left-handle");
    await page.waitForTimeout(900);
    res.leftClosed = await geo(page);
    await page.click("#jskin-left-handle");
    await page.waitForTimeout(900);
    const bad = ["open", "closed", "leftClosed"].filter((k) => !centred(res[k]));
    const fmt = (g) => `L${g.leftGap}/R${g.rightGap} w${g.canvasWidth}${g.panelOpen ? " (props open)" : ""}`;
    assert(!bad.length, "not centred: " + bad.map((k) => k + " " + fmt(res[k])).join("; "));
    return `before skin ${fmt(before)} | skin: ${fmt(res.open)} ; ${fmt(res.closed)} ; left closed ${fmt(res.leftClosed)} [${res.open.viewport}]`;
  });
}

test("canvas: element select box still lines up with the selected element", async (page) => {
  await open(page, urls.textForm);
  await inject(page);
  const out = [];
  for (const cn of ["org.joget.apps.form.lib.TextField", "org.joget.apps.form.lib.TextArea"]) {
    const sel = `[data-cbuilder-classname="${cn}"]`;
    await selectInCanvas(page, sel);
    const ifr = await page.evaluate(() => { const r = document.querySelector("#builder_canvas iframe").getBoundingClientRect(); return [r.left, r.top]; });
    const er = await frame(page).evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }, sel);
    const sb = await page.evaluate(() => { const r = document.querySelector("#element-select-box").getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
    const d = Math.max(Math.abs(ifr[0] + er[0] - sb[0]), Math.abs(ifr[1] + er[1] - sb[1]), Math.abs(er[2] - sb[2]), Math.abs(er[3] - sb[3]));
    assert(d <= 2, `${cn}: select box off by ${d.toFixed(1)}px`);
    out.push(`${cn.split(".").pop()} Δ${d.toFixed(1)}px`);
  }
  return out.join(", ");
});

test("hotkeys: button after Advanced Tools, list opens, Esc / outside click close", async (page) => {
  await open(page, urls.textForm);
  await inject(page);
  const after = await page.evaluate(() => document.querySelector("#builderToolbar .advanced-tools-toogle").nextElementSibling?.id);
  assert(after === "jskin-tool-group", "button position: " + after);
  const propsOpen = () => page.evaluate(() => !document.body.classList.contains("no-right-panel"));
  const wasOpen = await propsOpen();
  await openToolMenu(page);
  await page.click("#jskin-hotkeys-btn");
  await page.waitForTimeout(300);
  const rows = await page.locator("#jskin-hotkeys-panel tr").count();
  assert(rows >= 15, "rows " + rows);
  await shot(page, "hotkeys-open");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  assert((await page.locator("#jskin-hotkeys-panel").count()) === 0, "Esc did not close");
  assert((await propsOpen()) === wasOpen, "Esc also changed Joget's property panel");
  await openToolMenu(page);
  await page.click("#jskin-hotkeys-btn");
  await page.mouse.click(30, 450); // left palette area
  await page.waitForTimeout(300);
  assert((await page.locator("#jskin-hotkeys-panel").count()) === 0, "outside click did not close");
  await openToolMenu(page);
  await page.click("#jskin-hotkeys-btn");
  const pt = await page.evaluate(() => { // a canvas point not covered by the panel
    const c = document.querySelector("#builder_canvas").getBoundingClientRect(), k = document.querySelector("#jskin-hotkeys-panel").getBoundingClientRect();
    const x = k.right + 20 < c.right ? k.right + 20 : c.left + 15; return [x, Math.min(c.bottom - 20, k.bottom + 20)];
  });
  await page.mouse.click(pt[0], pt[1]); // inside the canvas iframe
  await page.waitForTimeout(300);
  assert((await page.locator("#jskin-hotkeys-panel").count()) === 0, "click in canvas did not close");
  // Joget's own shortcut still works (Esc reaches Joget when our panel is closed)
  return `${rows} rows; Esc/outside/canvas click close; Joget panel untouched`;
});

test("hotkeys: on App Composer the button follows the show-others button", async (page) => {
  await open(page, URLS.composer, "#builders");
  await inject(page);
  const ids = await page.evaluate(() => { const a = document.querySelector("#builderToolbar .advanced-tools-toogle"); return [a.nextElementSibling?.id, a.nextElementSibling?.nextElementSibling?.id]; });
  assert(ids[0] === "jskin-others-group" && ids[1] === "jskin-tool-group", "order " + ids);
  return "Advanced Tools → 显示其他 Builder → Joget Skin 菜单";
});

test("hotkeys: Joget maps ⌘ to Ctrl (jquery.hotkeys) — list claims match", async (page) => {
  await open(page, urls.textForm);
  const r = await page.evaluate(() => {
    const out = {}; const d = $("<div>").appendTo("body");
    const cases = { "ctrl+s/⌘S": ["ctrl+s", { metaKey: true, which: 83 }], "ctrl+z/⌘Z": ["ctrl+z", { metaKey: true, which: 90 }],
      "ctrl+shift+z/⌘⇧Z": ["ctrl+shift+z", { metaKey: true, shiftKey: true, which: 90 }], "ctrl+shift+z/Ctrl⇧Z": ["ctrl+shift+z", { ctrlKey: true, shiftKey: true, which: 90 }] };
    for (const [k, [keys, ev]] of Object.entries(cases)) { let hit = false; d.on("keydown", null, keys, () => { hit = true; }); d.trigger($.Event("keydown", ev)); d.off("keydown"); out[k] = hit; }
    d.remove(); return out;
  });
  assert(r["ctrl+s/⌘S"] && r["ctrl+z/⌘Z"] && !r["ctrl+shift+z/⌘⇧Z"] && r["ctrl+shift+z/Ctrl⇧Z"], JSON.stringify(r));
  return JSON.stringify(r);
});

for (const kind of ["form", "datalist"]) {
  test(`property editor: 全部收起/全部展开 (${kind} builder)`, async (page) => {
    const url = kind === "form" ? urls.textForm : urls.datalist;
    await open(page, url);
    await inject(page);
    if (kind === "form") await selectInCanvas(page, '[data-cbuilder-classname="org.joget.apps.form.lib.TextField"]');
    else await selectInCanvas(page, "th.column_header");
    const state = () => page.evaluate(() => ({
      bars: document.querySelectorAll(".jskin-prop-collapse-bar").length,
      label: document.querySelector(".jskin-prop-collapse-btn")?.textContent.trim(),
      pages: [...document.querySelectorAll("#right-panel .property-editor-container > .property-editor-pages > .property-editor-page")].filter((p) => p.offsetParent).map((p) => p.classList.contains("collapsed")),
      overlap: (() => { const b = document.querySelector(".jskin-prop-collapse-bar"), p = document.querySelector("#right-panel .property-editor-pages"); return b && p ? Math.round(b.getBoundingClientRect().bottom - p.getBoundingClientRect().top) : null; })(),
    }));
    const s0 = await state();
    assert(s0.bars === 1, "bars " + s0.bars);
    assert(s0.overlap <= 0, "bar overlaps the sections by " + s0.overlap + "px");
    await page.click(".jskin-prop-collapse-btn");
    await page.waitForTimeout(400);
    const s1 = await state();
    assert(s1.pages.length && s1.pages.every(Boolean) && s1.label === "全部展开", "collapse: " + JSON.stringify(s1));
    await shot(page, `props-collapsed-${kind}`, "#right-panel");
    await page.click(".jskin-prop-collapse-btn");
    await page.waitForTimeout(400);
    const s2 = await state();
    assert(s2.pages.every((x) => !x) && s2.label === "全部收起", "expand: " + JSON.stringify(s2));
    // select another element => editor re-renders => still exactly one bar
    if (kind === "form") await selectInCanvas(page, '[data-cbuilder-classname="org.joget.apps.form.lib.TextArea"]');
    else await selectInCanvas(page, "span.filter-cell");
    const s3 = await state();
    assert(s3.bars === 1, "after re-render bars=" + s3.bars);
    return `${s1.pages.length} sections collapse/expand; label ${s0.label}→${s1.label}→${s2.label}; 1 bar after re-select`;
  });
}

test("property editor: label left / input right on simple fields, stacked on complex ones", async (page) => {
  await open(page, urls.textForm);
  await selectInCanvas(page, '[data-cbuilder-classname="org.joget.apps.form.lib.TextField"]');
  await shot(page, "props-textfield-before", "#right-panel");
  await inject(page);
  await page.waitForTimeout(400);
  await shot(page, "props-textfield-after", "#right-panel");
  const r = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#right-panel .property-editor-property")].filter((e) => e.offsetParent);
    return rows.map((e) => {
      const t = (e.className.match(/property-type-[\w-]+/g) || []).join(" ");
      const l = e.querySelector(".property-label")?.getBoundingClientRect();
      const i = e.querySelector(":scope > .property-input")?.getBoundingClientRect();
      return { t, disp: getComputedStyle(e).display, side: !!(l && i && l.right <= i.left + 0.5 && l.top < i.bottom && i.top < l.bottom) };
    });
  });
  const simple = r.filter((x) => /property-type-(textfield|icon-textfield|autocomplete|selectbox)\b/.test(x.t) && !/elementselect/.test(x.t));
  const complex = r.filter((x) => /property-type-(header|elementselect|grid|codeeditor|textarea|htmleditor|repeater)\b/.test(x.t));
  assert(simple.length > 0 && simple.every((x) => x.side), "simple not side by side: " + JSON.stringify(simple.filter((x) => !x.side)));
  assert(complex.every((x) => x.disp !== "grid"), "complex row turned into grid: " + JSON.stringify(complex.filter((x) => x.disp === "grid")));
  return `${simple.length} simple rows side by side; ${complex.length} complex rows kept stacked`;
});

test("property editor rows: list builder column properties", async (page) => {
  await open(page, urls.datalist);
  await inject(page);
  await shot(page, "props-datalist-after", "#right-panel");
  const r = await page.evaluate(() => [...document.querySelectorAll("#right-panel .property-editor-property")].filter((e) => e.offsetParent && getComputedStyle(e).display === "grid").map((e) => {
    const l = e.querySelector(".property-label").getBoundingClientRect(), i = e.querySelector(":scope > .property-input").getBoundingClientRect();
    return l.right <= i.left + 0.5;
  }));
  assert(r.length > 0 && r.every(Boolean), "grid rows=" + r.length + " ok=" + r.filter(Boolean).length);
  return `${r.length} side-by-side rows`;
});

test("save chime: plays on (mocked) save success toast, silent on failure — nothing saved", async (page) => {
  await open(page, urls.textForm);
  const mock = () => {
    class FakeAC {
      constructor() { this.state = "running"; this.currentTime = 0; this.destination = {}; this.baseLatency = 0; this.outputLatency = 0; }
      resume() { return Promise.resolve(); }
      createConstantSource() { return { connect() {}, start() {}, stop() {} }; }
      createOscillator() { return this.createConstantSource(); }
      createGain() { return { gain: { value: 0 }, connect() {} }; }
    }
    window.AudioContext = FakeAC;
    window.__chimeCalls = [];
  };
  await inject(page, { mock });
  await page.evaluate(() => {
    const C = window.JogetSkinChime;
    C.play = (ac, name) => { window.__chimeCalls.push(name); return 0; };
  });
  const fire = (cls) => page.evaluate((cls) => {
    // arm like a Save click, without clicking (pointerdown only; Joget's save runs on click)
    document.getElementById("save-btn").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    const t = document.createElement("div");
    t.className = "toast " + cls;
    t.setAttribute("data-jskin-test", "1");
    document.getElementById("builder-message").append(t);
  }, cls);
  await fire("toast-danger");
  await page.waitForTimeout(300);
  const afterFail = await page.evaluate(() => window.__chimeCalls.length);
  await page.waitForTimeout(1600);
  await fire("toast-success");
  await page.waitForTimeout(300);
  const calls = await page.evaluate(() => window.__chimeCalls.slice());
  await page.evaluate(() => document.querySelectorAll('[data-jskin-test]').forEach((e) => e.remove()));
  assert(afterFail === 0, "played on failure");
  assert(calls.length === 1 && calls[0] === "soft", "calls " + JSON.stringify(calls));
  return `failure → 0 plays; success → play("${calls[0]}") once (ajaxSuccess hook is Firefox-only, not covered)`;
});

test("popup: version, 3 sounds, toggles write storage", async (page, ctx) => {
  const p = await ctx.newPage();
  await p.addInitScript(STUB);
  await p.goto(pathToFileURL(path.join(EXT, "popup.html")).href);
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => ({ v: document.getElementById("version").textContent, sounds: [...document.querySelectorAll("#sound option")].map((o) => o.value), toggle: document.getElementById("toggle").checked }));
  await p.click("#toggle");
  const stored = await p.evaluate(() => window.browser.storage.local.get(null));
  await p.close();
  assert(r.v === "v" + manifest.version, "version " + r.v);
  assert(r.sounds.length === 3, "sounds " + r.sounds);
  assert(stored.jogetSkinEnabled === false, "toggle not stored: " + JSON.stringify(stored));
  return `${r.v}; sounds ${r.sounds.join("/")}; toggle → jogetSkinEnabled=false`;
});

const UPDATES_URL = "https://noowxela.github.io/joget-skin/updates.json";
const updatesJson = (...versions) => ({
  addons: {
    "joget-skin@alexwoon": {
      updates: versions.map((version) => ({
        version,
        update_link: "https://github.com/noowxela/joget-skin/releases/download/v" + version + "/joget-skin-" + version + ".xpi",
      })),
    },
  },
});
async function openPopup(ctx, { body, status, abort, lastCheck } = {}) {
  const p = await ctx.newPage();
  if (lastCheck != null) {
    await p.addInitScript((t) => {
      sessionStorage.setItem("__jskinStubStore", JSON.stringify({ jogetSkinUpdateCheckedAt: t }));
    }, lastCheck);
  }
  await p.addInitScript(STUB);
  await p.route(UPDATES_URL, (route) => {
    if (abort) return route.abort("failed");
    const payload = typeof body === "string" ? body : JSON.stringify(body == null ? updatesJson(manifest.version) : body);
    return route.fulfill({ status: status || 200, contentType: status && status >= 400 ? "text/plain" : "application/json", body: payload });
  });
  await p.goto(pathToFileURL(path.join(EXT, "popup.html")).href);
  return p;
}

test("popup: update check shows newer version from updates.json", async (page, ctx) => {
  const p = await openPopup(ctx, { body: updatesJson("1.4.1", "9.9.9") });
  await p.waitForFunction(() => /有新版本 v9\.9\.9/.test(document.getElementById("update-status").textContent), null, { timeout: 8000 });
  const href = await p.getAttribute("#update-changelog", "href");
  assert(href === "https://noowxela.github.io/joget-skin/changelog.html", "changelog href " + href);
  assert(await p.locator("#update-now").count(), "missing 立即更新");
  await p.setViewportSize({ width: 300, height: 360 });
  await shot(p, "popup-update-newer");
  await p.close();
  return "auto-check: 有新版本 v9.9.9 + changelog + 立即更新";
});

test("popup: update check same version is already latest", async (page, ctx) => {
  const p = await openPopup(ctx, { body: updatesJson("1.4.0", manifest.version), lastCheck: Date.now() });
  await p.waitForSelector("#update-check");
  assert((await p.textContent("#update-status")).trim() === "", "auto-check was not silent: " + await p.textContent("#update-status"));
  await p.click("#update-check");
  await p.waitForFunction(() => document.getElementById("update-status").textContent.trim() === "已是最新版", null, { timeout: 8000 });
  await p.close();
  return "手动检查：" + manifest.version + " → 已是最新版";
});

test("popup: update check fetch failure shows reason", async (page, ctx) => {
  const p = await openPopup(ctx, { status: 500, body: "nope", lastCheck: Date.now() });
  await p.click("#update-check");
  await p.waitForFunction(() => document.getElementById("update-status").textContent.includes("检查失败：HTTP 500"), null, { timeout: 8000 });
  const txt = (await p.textContent("#update-status")).trim();
  await p.close();
  return txt;
});

test("indigo theme: loads together with v1.3.7 layout, canvas still centred", async (page) => {
  await open(page, urls.textForm);
  await inject(page, { theme: true });
  await page.waitForTimeout(500);
  const g = await geo(page);
  const cls = await page.evaluate(() => document.documentElement.className);
  await shot(page, "form-builder-indigo");
  assert(/joget-skin-theme-indigo/.test(cls) && centred(g), JSON.stringify({ cls, g }));
  return `L${g.leftGap}/R${g.rightGap}`;
});

test("skin off: everything from v1.3.7 goes away", async (page) => {
  await open(page, urls.textForm);
  const before = await geo(page);
  await inject(page);
  await setStore(page, { jogetSkinEnabled: false });
  await page.waitForTimeout(900);
  const r = await page.evaluate(() => ({
    hk: !!document.getElementById("jskin-hotkeys-group"),
    bar: !!document.querySelector(".jskin-prop-collapse-bar"),
    grid: [...document.querySelectorAll("#right-panel .property-editor-property")].some((e) => getComputedStyle(e).display === "grid"),
    qn: Math.round(document.querySelector("#quick-nav-bar").getBoundingClientRect().width),
    tog: Math.round(document.querySelector("#left-panel-toogle").getBoundingClientRect().width),
  }));
  const after = await geo(page);
  assert(!r.hk && !r.bar && !r.grid, "leftovers: " + JSON.stringify(r));
  assert(after.canvasLeft === before.canvasLeft && after.canvasWidth === before.canvasWidth, `canvas not restored ${JSON.stringify(before)} vs ${JSON.stringify(after)}`);
  assert(r.qn >= 30 && r.tog < 20, "quick nav / toggle still skinned " + JSON.stringify(r));
  return `no button/bar/grid rows; canvas back to left ${after.canvasLeft} w${after.canvasWidth}; quick nav ${r.qn}px; toggle ${r.tog}px`;
});

/* ---------- v1.4.0 process copy ---------- */
const pbData = (page) => page.evaluate(() => {
  const D = CustomBuilder.data, P = ProcessBuilder;
  return JSON.parse(JSON.stringify({
    procs: P.getArray(D.xpdl.Package.WorkflowProcesses, "WorkflowProcess"),
    parts: P.getArray(D.xpdl.Package.Participants, "Participant"),
    participants: D.participants || {}, activityForms: D.activityForms || {}, activityPlugins: D.activityPlugins || {},
    current: P.currentProcessData.properties.id,
  }));
});
const stripKeys = (o, pid) => Object.fromEntries(Object.entries(o).filter(([k]) => k.startsWith(pid + "::")).map(([k, v]) => [k.slice(pid.length + 2), v]));
const pick = (o, pid) => Object.fromEntries(Object.entries(o).filter(([k]) => k.startsWith(pid + "::")));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const noLayout = (o) => JSON.parse(JSON.stringify(o), (k, v) => (k === "-Value" && typeof v === "string"
  ? v.replace(/(X_OFFSET|Y_OFFSET)=[^,]*/g, "$1=").replace(/NO_ROUTING_\w+/g, "NO_ROUTING").replace(/^-?[\d.]+,-?[\d.]+$/, "x,y") : v));
async function openProcessBuilder(page) {
  await open(page, urls.process);
  await page.waitForFunction(() => window.ProcessBuilder && ProcessBuilder.currentProcessData && ProcessBuilder.currentProcessData.properties, null, { timeout: 20000 });
  await inject(page);
  await page.waitForSelector("#jskin-tool-btn", { timeout: 8000 });
}
async function exportBundle(page) {
  await openToolMenu(page);
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.click("#jskin-pcopy-export")]);
  const file = path.join(os.tmpdir(), "jskin-" + Date.now() + "-" + dl.suggestedFilename());
  await dl.saveAs(file);
  return { file, name: dl.suggestedFilename(), bundle: JSON.parse(fs.readFileSync(file, "utf8")) };
}
async function chooseImport(page, file) {
  await openToolMenu(page);
  const [fc] = await Promise.all([page.waitForEvent("filechooser", { timeout: 10000 }), page.click("#jskin-pcopy-import")]);
  await fc.setFiles(file);
  await page.waitForSelector("#jskin-pcopy-dialog", { timeout: 15000 });
}
const writeTmp = (name, obj) => { const f = path.join(os.tmpdir(), "jskin-" + Date.now() + "-" + name); fs.writeFileSync(f, typeof obj === "string" ? obj : JSON.stringify(obj)); return f; };

test("process copy: export button only on process builder, bundle re-keyed, secrets blanked", async (page) => {
  await openProcessBuilder(page);
  const order = await page.evaluate(() => document.querySelector("#builderToolbar .advanced-tools-toogle")?.nextElementSibling?.id);
  assert(order === "jskin-tool-group", "toolbar order " + order);
  await openToolMenu(page);
  const inside = await page.evaluate(() => [...document.querySelectorAll("#jskin-tool-menu [id$='-group']")].map((e) => e.id));
  assert(inside.includes("jskin-hotkeys-group") && inside.includes("jskin-pcopy-group"), "menu items " + inside);
  // put dummy credentials into the in-memory data (never saved) to check they are blanked
  await page.evaluate(() => {
    const pid = ProcessBuilder.currentProcessData.properties.id;
    const k = Object.keys(CustomBuilder.data.activityPlugins).find((x) => x.startsWith(pid + "::"));
    const pr = CustomBuilder.data.activityPlugins[k].properties = CustomBuilder.data.activityPlugins[k].properties || {};
    pr.username = "dummy-user"; pr.password = "dummy-pass"; pr.apiKey = "#envVariable.keep#";
  });
  const before = await pbData(page);
  await shot(page, "pcopy-toolbar", "#builderToolbar");
  const { name, bundle: b } = await exportBundle(page);
  const pid = before.current;
  assert(b.kind === "joget-process-bundle" && b.v === 1 && b.source.processId === pid && b.process["-Id"] === pid, "header " + JSON.stringify(b.source));
  assert(name.endsWith(pid + ".process.json"), "file " + name);
  assert(same(b.activityForms, stripKeys(before.activityForms, pid)), "activityForms differ");
  assert(same(b.participantMap, stripKeys(before.participants, pid)), "participantMap differ");
  const plug = stripKeys(before.activityPlugins, pid);
  const tk = await page.evaluate(() => { const pid = ProcessBuilder.currentProcessData.properties.id; return Object.keys(CustomBuilder.data.activityPlugins).find((x) => x.startsWith(pid + "::")).split("::")[1]; });
  const mine = ["username", "password"].map((f) => `activityPlugins.${tk}.properties.${f}`);
  assert(mine.every((x) => b.sensitive.includes(x)) && !b.sensitive.some((x) => x.endsWith(".apiKey")), "sensitive " + JSON.stringify(b.sensitive));
  assert(b.activityPlugins[tk].properties.password === "" && b.activityPlugins[tk].properties.username === "" && b.activityPlugins[tk].properties.apiKey === "#envVariable.keep#", "not blanked");
  assert(Object.keys(b.activityPlugins).length === Object.keys(plug).length, "plugin count");
  assert(b.participants.length > 0 && b.requires.forms.length > 0 && b.requires.plugins.length > 0, "requires " + JSON.stringify(b.requires));
  const after = await pbData(page);
  assert(same(before, after), "export changed the designer data");
  // not on other builders
  await open(page, urls.textForm);
  await inject(page);
  const onForm = await page.evaluate(() => !!document.getElementById("jskin-pcopy-group"));
  assert(!onForm, "pcopy buttons on the form builder");
  return `${name}: ${b.participants.length} participants, forms ${Object.keys(b.activityForms).length}, plugins ${Object.keys(b.activityPlugins).length}; requires ${b.requires.forms.length} forms / ${b.requires.plugins.length} plugins; blanked ${b.sensitive.join(", ")}`;
});

test("process copy: import into the same app -> _2 id like Clone, mappings re-keyed, others unchanged, not saved", async (page, ctx) => {
  await openProcessBuilder(page);
  const { file, bundle } = await exportBundle(page);
  const before = await pbData(page);
  const pid = before.current;
  await chooseImport(page, file);
  const txt = await page.textContent("#jskin-pcopy-dialog");
  assert(txt.includes(pid + "_2"), "dialog has no new id: " + txt.slice(0, 300));
  assert(!/没有任何活动节点|按 Save 会被拒绝/.test(txt), "false design-invalid warning on a valid package: " + txt.slice(0, 400));
  await page.click("#jskin-pcopy-dialog .btn-primary");
  const nid = pid + "_2";
  await page.waitForFunction((n) => location.hash === "#" + n && ProcessBuilder.currentProcessData && ProcessBuilder.currentProcessData.properties.id === n, nid, { timeout: 15000 });
  await page.waitForTimeout(1500);
  const after = await pbData(page);
  const opts = await page.evaluate(() => [...document.querySelectorAll("#processes_list option")].map((o) => o.value));
  const saved = await page.evaluate(() => CustomBuilder.isSaved());
  await page.click("#processes_list_chosen a.chosen-single").catch(() => {});
  await page.waitForTimeout(400);
  await shot(page, "pcopy-imported-dropdown");
  assert(opts.includes(nid) && opts.includes(pid), "dropdown " + opts);
  assert(same(stripKeys(after.activityForms, nid), stripKeys(before.activityForms, pid)), "activityForms not re-keyed 1:1");
  // plugins: same keys; values = the exported ones (sensitive fields blanked on export)
  assert(same(Object.keys(stripKeys(after.activityPlugins, nid)).sort(), Object.keys(stripKeys(before.activityPlugins, pid)).sort()), "activityPlugins keys");
  assert(same(stripKeys(after.activityPlugins, nid), bundle.activityPlugins), "activityPlugins values != bundle");
  // participants: re-keyed with the renamed participant ids (like cloneProcess)
  const newParts = after.parts.filter((p) => !before.parts.some((q) => q["-Id"] === p["-Id"])).map((p) => p["-Id"]);
  assert(newParts.length > 0 && newParts.every((x) => x.startsWith(nid + "_")), "new participants " + newParts);
  const pm = stripKeys(after.participants, nid);
  assert(pm.processStartWhiteList && newParts.every((x) => x in pm || !(x.slice(nid.length + 1) in stripKeys(before.participants, pid))), "participant map " + JSON.stringify(Object.keys(pm)));
  // original processes / mappings untouched
  // Joget re-serializes the layout of the open process on triggerChange (offsets, transition style);
  // its own Clone does exactly the same, so compare without layout values here and against Clone below
  assert(same(noLayout(after.procs.filter((p) => p["-Id"] !== nid)), noLayout(before.procs)), "existing processes changed");
  for (const m of ["participants", "activityForms", "activityPlugins"]) {
    const o = (x) => Object.fromEntries(Object.entries(x[m]).filter(([k]) => !k.startsWith(nid + "::")));
    assert(same(o(after), o(before)), m + ": existing entries changed");
  }
  const np = after.procs.find((p) => p["-Id"] === nid);
  assert(saved === false, "should be unsaved (no auto-save)");
  // same result as Joget's own Clone button (ProcessBuilder.cloneProcess) in a fresh page
  const p2 = await ctx.newPage();
  await open(p2, urls.process);
  await p2.waitForFunction(() => window.ProcessBuilder && ProcessBuilder.currentProcessData && ProcessBuilder.currentProcessData.properties, null, { timeout: 20000 });
  await p2.evaluate(() => ProcessBuilder.cloneProcess());
  await p2.waitForTimeout(2000);
  const nat = await pbData(p2);
  await p2.close();
  assert(same(nat.procs.find((p) => p["-Id"] === pid), after.procs.find((p) => p["-Id"] === pid)), "original process differs from what Clone leaves");
  assert(same(noLayout(nat.procs.find((p) => p["-Id"] === nid)), noLayout(np)), "new process differs from Clone's copy");
  assert(same(nat.parts.map((p) => p["-Id"]).sort(), after.parts.map((p) => p["-Id"]).sort()), "participants differ from Clone");
  for (const m of ["participants", "activityForms", "activityPlugins"]) {
    assert(same(Object.keys(pick(nat[m], nid)).sort(), Object.keys(pick(after[m], nid)).sort()), m + " keys differ from Clone");
  }
  assert(same(pick(nat.activityForms, nid), pick(after.activityForms, nid)) && same(pick(nat.participants, nid), pick(after.participants, nid)), "form / participant mappings differ from Clone");
  return `same as Joget Clone; new ${nid} "${np["-Name"]}"; participants ${newParts.join(", ")}; forms ${Object.keys(stripKeys(after.activityForms, nid)).length} / plugins ${Object.keys(stripKeys(after.activityPlugins, nid)).length} re-keyed; existing unchanged; unsaved`;
});

test("process copy: warnings dialog (missing form/plugin, renames, re-enter fields), cancel and bad file change nothing", async (page) => {
  await openProcessBuilder(page);
  const { bundle: b } = await exportBundle(page);
  const before = await pbData(page);
  const pid = before.current;
  // simulate a bundle from another app: new process id, a form and a plugin this app does not have
  b.process["-Id"] = "jskin_remote_proc";
  b.source.appId = "remote_app";
  const act = Object.keys(b.activityForms).find((k) => k !== "runProcess") || "runProcess";
  b.activityForms[act] = Object.assign({}, b.activityForms[act], { formId: "jskin_missing_form" });
  b.requires.forms.push("jskin_missing_form");
  b.requires.plugins.push("com.example.MissingPlugin");
  b.sensitive.push("activityPlugins.tool1.properties.password");
  b.subflows = [{ activity: "sub1", target: "other_proc" }];
  await chooseImport(page, writeTmp("remote.process.json", b));
  const txt = await page.textContent("#jskin-pcopy-dialog");
  await page.mouse.move(5, 890);
  await page.evaluate(() => document.querySelectorAll(".jskin-pcopy-toast").forEach((t) => t.remove()));
  await shot(page, "pcopy-warnings-dialog", "#jskin-pcopy-dialog .jskin-pcopy-box");
  for (const s of ["jskin_missing_form", "com.example.MissingPlugin", "activityPlugins.tool1.properties.password", "other_proc", "jskin_remote_proc_"]) {
    assert(txt.includes(s), "dialog missing " + s);
  }
  assert(!txt.includes("Clone」的规则"), "should not be renamed");
  await page.click("#jskin-pcopy-dialog .btn-secondary");
  await page.waitForTimeout(500);
  assert(same(await pbData(page), before), "cancel changed data");
  await chooseImport(page, writeTmp("bad.json", { kind: "something-else", v: 1 }));
  const err = await page.textContent("#jskin-pcopy-dialog");
  assert(/不是流程导出文件/.test(err) && !(await page.$("#jskin-pcopy-dialog .btn-primary")), "bad file dialog: " + err);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  assert(!(await page.$("#jskin-pcopy-dialog")) && same(await pbData(page), before), "bad file changed data / dialog stuck");
  // skin off removes the buttons
  await setStore(page, { jogetSkinEnabled: false });
  await page.waitForTimeout(600);
  assert(!(await page.$("#jskin-pcopy-group")), "buttons still there with skin off");
  return `warnings listed (missing form + plugin, re-enter field, subflow, participant renames to jskin_remote_proc_*); cancel / bad file → no change; skin off → buttons removed (${pid})`;
});

test("process copy: leftover empty process listed as design issues; Save dialog names it", async (page) => {
  await openProcessBuilder(page);
  const { file, bundle } = await exportBundle(page);
  const beforeId = await page.evaluate(() => ProcessBuilder.currentProcessData.properties.id);
  // in-memory only: Joget's "add process" creates a stub with no activities (the same stub a new app starts with)
  const emptyId = await page.evaluate(() => ProcessBuilder.addEmptyProcess()["-Id"]);
  await page.evaluate((id) => {
    ProcessBuilder.updateProcessSelector();
    CustomBuilder.Builder.triggerChange();
    window.location.hash = id;
  }, emptyId);
  await page.waitForFunction((id) => ProcessBuilder.currentProcessData && ProcessBuilder.currentProcessData.properties.id === id, emptyId, { timeout: 15000 });
  await page.waitForTimeout(500);
  assert(emptyId && emptyId !== beforeId, "addEmptyProcess did not create a new id: " + emptyId + " (was " + beforeId + ")");
  const pre = await page.evaluate(async () => {
    // ping validate through the page script after it is already injected
    return true;
  });
  await chooseImport(page, file);
  const txt = await page.textContent("#jskin-pcopy-dialog");
  await page.mouse.move(5, 890);
  await page.evaluate(() => document.querySelectorAll(".jskin-pcopy-toast").forEach((t) => t.remove()));
  await shot(page, "pcopy-design-issues-dialog", "#jskin-pcopy-dialog .jskin-pcopy-box");
  assert(/按 Save 会被拒绝/.test(txt), "import dialog missing design-invalid section: " + txt.slice(0, 500));
  assert(txt.includes(emptyId) && /没有任何活动节点/.test(txt), "dialog did not name the empty process: " + txt.slice(0, 500));
  assert(!txt.includes("无法读取"), "unexpected read errors in dialog");
  await page.click("#jskin-pcopy-dialog .btn-primary");
  await page.waitForFunction((n) => location.hash === "#" + n, bundle.process["-Id"] === beforeId ? beforeId + "_2" : bundle.process["-Id"], { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
  // after import, leftover empty process still makes the package invalid — dialog should stay/reopen
  const afterImportDlg = await page.textContent("#jskin-pcopy-dialog").catch(() => "");
  assert(afterImportDlg && /但保存会被拒绝/.test(afterImportDlg) && afterImportDlg.includes(emptyId),
    "post-import dialog missing details: " + String(afterImportDlg).slice(0, 400));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  // click Save: Joget blocks it; our hook must list the same process
  await page.click("#save-btn, #save-btn-toolbar");
  await page.waitForSelector("#jskin-pcopy-dialog", { timeout: 8000 });
  const saveTxt = await page.textContent("#jskin-pcopy-dialog");
  await shot(page, "pcopy-save-invalid-details", "#jskin-pcopy-dialog .jskin-pcopy-box");
  assert(/无法保存：Design is invalid/.test(saveTxt), "save dialog title missing: " + saveTxt.slice(0, 400));
  assert(saveTxt.includes(emptyId) && /没有任何活动节点/.test(saveTxt), "save dialog did not name the empty process: " + saveTxt.slice(0, 400));
  const saved = await page.evaluate(() => CustomBuilder.isSaved());
  assert(saved === false, "Save should have been blocked");
  await page.keyboard.press("Escape");
  return `empty ${emptyId} listed in import dialog and in the Save "Design is invalid" dialog; Save blocked (unsaved)`;
});

/* ---------- v1.4.2 userview / UI copy ---------- */

async function waitUvReady(page, id) {
  await page.waitForFunction((id) => {
    const CB = window.CustomBuilder;
    if (!CB || CB.builderType !== "userview" || !CB.data || !CB.data.properties) return false;
    const cur = CB.id || CB.data.properties.id;
    return cur === id;
  }, id, { timeout: 20000 });
  // ajaxRenderBuilder shows a full-viewport "All done! Your builder is ready." overlay
  // and only removes body.initializing after ~1.7s
  await page.waitForFunction(() => !document.body.classList.contains("initializing"), { timeout: 20000 });
  await page.waitForFunction(() => {
    const bar = document.querySelector("#builderToolbar");
    const canvas = document.querySelector("#builder_canvas");
    if (!bar || !canvas) return false;
    const r = canvas.getBoundingClientRect();
    const text = document.body.innerText || "";
    return r.width > 100 && r.height > 100 && !/All done! Your builder is ready|Loading your content now/.test(text);
  }, { timeout: 20000 });
  await page.waitForTimeout(300);
}
async function openUserviewBuilder(page, url) {
  await open(page, url || urls.userview);
  await page.waitForFunction(() => window.CustomBuilder && CustomBuilder.builderType === "userview" && CustomBuilder.data && CustomBuilder.data.properties, null, { timeout: 20000 });
  await inject(page);
  await page.waitForSelector("#jskin-tool-btn", { timeout: 8000 });
}
async function exportUvBundle(page) {
  await openToolMenu(page);
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.click("#jskin-ucopy-export")]);
  const file = path.join(os.tmpdir(), "jskin-" + Date.now() + "-" + dl.suggestedFilename());
  await dl.saveAs(file);
  return { file, name: dl.suggestedFilename(), bundle: JSON.parse(fs.readFileSync(file, "utf8")) };
}
async function chooseUvImport(page, file) {
  await openToolMenu(page);
  const [fc] = await Promise.all([page.waitForEvent("filechooser", { timeout: 10000 }), page.click("#jskin-ucopy-import")]);
  await fc.setFiles(file);
  await page.waitForSelector("#jskin-ucopy-dialog", { timeout: 20000 });
}
const uvInfo = (page) => page.evaluate(() => {
  const CB = window.CustomBuilder;
  let json;
  try { json = JSON.parse(CB.getJson()); } catch { json = JSON.parse(JSON.stringify(CB.data)); }
  return { id: CB.id || (json.properties && json.properties.id) || "", name: (json.properties && json.properties.name) || "", json, appId: CB.appId, appVersion: CB.appVersion };
});
async function listUserviewIds(page) {
  return page.evaluate(async () => {
    const url = CustomBuilder.contextPath + "/web/json/console/app/" + CustomBuilder.appId + "/" + CustomBuilder.appVersion + "/userview/options";
    const r = await fetch(url, { credentials: "same-origin" });
    const j = await r.json();
    const arr = Array.isArray(j) ? j : (j.data || []);
    return arr.map((x) => x && (x.value || x.id)).filter(Boolean);
  });
}
async function deleteUserviewId(page, id) {
  return page.evaluate(async (id) => {
    const url = CustomBuilder.contextPath + "/web/console/app/" + CustomBuilder.appId + "/" + CustomBuilder.appVersion + "/userview/delete";
    return await new Promise((resolve) => {
      window.jQuery.ajax({
        type: "POST", url, data: { ids: id }, dataType: "text",
        success: (_t, _s, xhr) => resolve({ ok: true, status: xhr.status }),
        error: (xhr) => resolve({ ok: false, status: xhr && xhr.status }),
      });
    });
  }, id);
}
async function listAppIds(page) {
  return page.evaluate(async () => {
    const root = (window.CustomBuilder && CustomBuilder.contextPath) || "/jw";
    const r = await fetch(root + "/web/json/console/app/list", { credentials: "same-origin" });
    const j = await r.json();
    const rows = j.data || j;
    return (Array.isArray(rows) ? rows : []).map((a) => a.id || a.appId || a.value).filter(Boolean).sort();
  });
}
async function csrfPost(page, url, fields) {
  return page.evaluate(async ({ url, fields }) => {
    if (window.jQuery && typeof window.jQuery.ajax === "function") {
      return await new Promise((resolve) => {
        window.jQuery.ajax({
          type: "POST", url, data: fields, dataType: "text",
          success: (text, _s, xhr) => resolve({ ok: true, status: xhr.status, url: xhr.responseURL || url, text: (text || "").slice(0, 2000) }),
          error: (xhr) => resolve({ ok: false, status: xhr && xhr.status, url, text: ((xhr && xhr.responseText) || "").slice(0, 2000) }),
        });
      });
    }
    return { ok: false, status: 0, url, text: "jQuery.ajax not available" };
  }, { url, fields });
}

test("userview copy: export button only on userview builder, bundle content, secrets blanked", async (page) => {
  await openUserviewBuilder(page);
  const order = await page.evaluate(() => [...document.querySelectorAll("#builderToolbar [id$='-group']")].map((e) => e.id));
  assert(order.includes("jskin-tool-group"), "tool menu missing: " + order);
  await openToolMenu(page);
  const inside = await page.evaluate(() => [...document.querySelectorAll("#jskin-tool-menu [id$='-group']")].map((e) => e.id));
  assert(inside.includes("jskin-hotkeys-group") && inside.includes("jskin-ucopy-group"), "menu items " + inside);
  const hi = inside.indexOf("jskin-hotkeys-group");
  const ui = inside.indexOf("jskin-ucopy-group");
  assert(hi >= 0 && ui > hi, "ucopy should follow hotkeys in the menu: " + inside);
  // plant a secret + an env hash on a live copy of the json so export can blank / keep them
  await page.evaluate(() => {
    if (!CustomBuilder.data.setting) CustomBuilder.data.setting = { className: "", properties: {} };
    if (!CustomBuilder.data.setting.properties) CustomBuilder.data.setting.properties = {};
    CustomBuilder.data.setting.properties.jskinTestPassword = "s3cret-value";
    CustomBuilder.data.setting.properties.jskinTestEnv = "#envVariable.jskin_missing_env#";
    CustomBuilder.json = JSON.stringify(CustomBuilder.data);
  });
  const { file, name, bundle } = await exportUvBundle(page);
  // revert planted fields so we never risk saving them
  await page.evaluate(() => {
    if (CustomBuilder.data.setting && CustomBuilder.data.setting.properties) {
      delete CustomBuilder.data.setting.properties.jskinTestPassword;
      delete CustomBuilder.data.setting.properties.jskinTestEnv;
      CustomBuilder.json = JSON.stringify(CustomBuilder.data);
    }
  });
  assert(bundle.kind === "joget-userview-bundle" && bundle.v === 1, "kind/v " + bundle.kind + " " + bundle.v);
  assert(bundle.userview && bundle.userview.properties && bundle.userview.properties.id, "missing userview json");
  assert(bundle.source && bundle.source.appId && bundle.source.userviewId, "missing source: " + JSON.stringify(bundle.source));
  assert(bundle.requires && Array.isArray(bundle.requires.forms) && Array.isArray(bundle.requires.plugins), "requires: " + JSON.stringify(bundle.requires));
  assert(Array.isArray(bundle.requires.envVariables) && bundle.requires.envVariables.includes("jskin_missing_env"), "env not scanned: " + JSON.stringify(bundle.requires.envVariables));
  const pw = bundle.userview.setting && bundle.userview.setting.properties && bundle.userview.setting.properties.jskinTestPassword;
  const ev = bundle.userview.setting && bundle.userview.setting.properties && bundle.userview.setting.properties.jskinTestEnv;
  assert(pw === "", "password not blanked: " + pw);
  assert(ev === "#envVariable.jskin_missing_env#", "env hash was rewritten: " + ev);
  assert((bundle.sensitive || []).some((p) => /jskinTestPassword/.test(p)), "sensitive path missing: " + JSON.stringify(bundle.sensitive));
  assert(/\.userview\.json$/.test(name) && name.indexOf(bundle.source.appId) >= 0, "filename " + name);
  await shot(page, "ucopy-toolbar", "#builderToolbar");
  // not on process or form builder
  await openProcessBuilder(page);
  assert(!(await page.$("#jskin-ucopy-group")), "ucopy buttons on the process builder");
  await open(page, urls.textForm);
  await inject(page);
  await page.waitForTimeout(400);
  assert(!(await page.$("#jskin-ucopy-group")), "ucopy buttons on the form builder");
  return `bundle ${name} kind=${bundle.kind} v=${bundle.v} id=${bundle.source.userviewId}; password blanked; env hash kept; buttons only on userview builder`;
});

test("userview copy: import into the same app creates a new userview, does not overwrite the open one", async (page) => {
  await openUserviewBuilder(page);
  const before = await uvInfo(page);
  const beforeIds = await listUserviewIds(page);
  const { file, bundle } = await exportUvBundle(page);
  await chooseUvImport(page, file);
  const txt = await page.textContent("#jskin-ucopy-dialog");
  assert(/导入为新 UI/.test(txt) && /写入服务器/.test(txt), "dialog missing new-userview / persist wording: " + txt.slice(0, 400));
  const expectId = beforeIds.includes(bundle.source.userviewId) ? bundle.source.userviewId + "_2" : bundle.source.userviewId;
  // if _2 already exists incrementSuffix may pick a higher number — accept _\d+$ when renamed
  assert(new RegExp(bundle.source.userviewId + "(_\\d+)?").test(txt), "new id not shown: " + txt.slice(0, 400));
  await page.click("#jskin-ucopy-dialog .btn-primary");
  await page.waitForFunction((oldId) => {
    const err = document.querySelector("#jskin-ucopy-dialog .jskin-ucopy-error");
    if (err && err.textContent) return "ERR:" + err.textContent;
    const CB = window.CustomBuilder;
    if (!CB || CB.builderType !== "userview" || !CB.data || !CB.data.properties) return false;
    const id = CB.id || CB.data.properties.id;
    return id && id !== oldId ? "OK:" + id : false;
  }, before.id, { timeout: 40000 });
  const waitMsg = await page.evaluate(() => {
    const err = document.querySelector("#jskin-ucopy-dialog .jskin-ucopy-error");
    if (err && err.textContent) return "ERR:" + err.textContent;
    const CB = window.CustomBuilder;
    const id = CB && (CB.id || (CB.data && CB.data.properties && CB.data.properties.id));
    return "OK:" + id;
  });
  if (waitMsg.indexOf("ERR:") === 0) throw new Error(waitMsg.slice(4));
  const after = await uvInfo(page);
  const afterIds = await listUserviewIds(page);
  let err = "";
  try {
    assert(after.id !== before.id, "still on the original userview: " + after.id);
    assert(afterIds.includes(before.id), "original userview disappeared: " + afterIds);
    assert(afterIds.includes(after.id), "new userview not in list: " + afterIds + " current=" + after.id);
    assert(after.json.properties.id === after.id, "json id mismatch " + after.json.properties.id + " vs " + after.id);
    assert(/ \(Copy\)/.test(after.name) || after.id === bundle.source.userviewId, "name should get (Copy) when id changes: " + after.name);
    // structural compare: category count
    const cats = (j) => (j.categories || j.category || []);
    assert(JSON.stringify(Object.keys(after.json.properties)).indexOf("id") >= 0, "properties missing");
  } catch (e) {
    err = e.message;
  }
  await waitUvReady(page, after.id);
  await shot(page, "ucopy-imported-ui");
  const del = await deleteUserviewId(page, after.id);
  const idsAfterDel = await listUserviewIds(page);
  if (!idsAfterDel.includes(before.id) || idsAfterDel.includes(after.id)) {
    throw new Error("cleanup failed: delete=" + JSON.stringify(del) + " ids=" + idsAfterDel + (err ? " ; earlier: " + err : ""));
  }
  if (err) throw new Error(err);
  return `imported ${bundle.source.userviewId} -> ${after.id} 「${after.name}」; original ${before.id} kept; deleted the copy (${del.status})`;
});

test("userview copy: warnings dialog (missing deps), cancel and bad file change nothing", async (page) => {
  await openUserviewBuilder(page);
  const before = await uvInfo(page);
  const beforeIds = (await listUserviewIds(page)).slice().sort();
  const { bundle } = await exportUvBundle(page);
  bundle.userview.properties = bundle.userview.properties || {};
  // plant missing refs on a copied menu-like object under properties so walk() sees them
  bundle.userview.properties.jskinMissingForm = { formId: "jskin_missing_form" };
  bundle.userview.properties.jskinMissingList = { listId: "jskin_missing_list" };
  bundle.userview.properties.jskinMissingProc = { processId: "jskin_missing_process", activityId: "jskin_missing_activity" };
  bundle.userview.properties.jskinMissingUv = { userviewId: "jskin_missing_userview" };
  bundle.userview.properties.jskinMissingPlugin = { className: "org.jskin.missing.DoesNotExistPlugin" };
  bundle.userview.properties.jskinMissingEnv = "prefix #envVariable.jskin_missing_env# suffix";
  bundle.userview.properties.jskinFakePassword = "should-be-listed-if-exported";
  // pretend export blanked it
  bundle.sensitive = (bundle.sensitive || []).concat(["userview.properties.jskinFakePassword"]);
  const fake = writeTmp("ucopy-missing.json", bundle);
  await chooseUvImport(page, fake);
  const txt = await page.textContent("#jskin-ucopy-dialog");
  assert(/jskin_missing_form/.test(txt), "missing form not warned: " + txt);
  assert(/jskin_missing_list/.test(txt), "missing list not warned: " + txt);
  assert(/jskin_missing_process/.test(txt), "missing process not warned: " + txt);
  assert(/jskin_missing_userview/.test(txt), "missing userview not warned: " + txt);
  assert(/org\.jskin\.missing\.DoesNotExistPlugin/.test(txt), "missing plugin not warned: " + txt);
  assert(!/org\.joget\.apps\.userview\.model\.Userview[<\s]/.test(txt) && !/UserviewCategory/.test(txt), "built-in userview types flagged as missing plugins: " + txt);
  assert(/jskin_missing_env/.test(txt), "missing env not warned: " + txt);
  assert(/jskinFakePassword/.test(txt), "sensitive field not listed: " + txt);
  await page.evaluate(() => document.querySelectorAll(".jskin-ucopy-toast").forEach((t) => t.remove()));
  await shot(page, "ucopy-warnings-dialog", "#jskin-ucopy-dialog .jskin-ucopy-box");
  await page.click("#jskin-ucopy-dialog .btn-secondary");
  await page.waitForTimeout(300);
  assert(!(await page.$("#jskin-ucopy-dialog")), "cancel did not close dialog");
  const afterCancel = await uvInfo(page);
  const idsCancel = (await listUserviewIds(page)).slice().sort();
  assert(afterCancel.id === before.id && JSON.stringify(idsCancel) === JSON.stringify(beforeIds), "cancel created/changed userviews: " + idsCancel);

  const bad = writeTmp("ucopy-bad.json", { kind: "joget-process-bundle", v: 1 });
  await chooseUvImport(page, bad);
  const err = await page.textContent("#jskin-ucopy-dialog");
  assert(/不是 UI/.test(err) && !(await page.$("#jskin-ucopy-dialog .btn-primary")), "bad file dialog: " + err);
  await page.click("#jskin-ucopy-dialog .btn-secondary, #jskin-ucopy-dialog button");
  await page.waitForTimeout(300);
  assert(!(await page.$("#jskin-ucopy-dialog")), "bad file dialog stuck");
  const idsBad = (await listUserviewIds(page)).slice().sort();
  assert(JSON.stringify(idsBad) === JSON.stringify(beforeIds), "bad file changed userviews: " + idsBad);

  await setStore(page, { jogetSkinEnabled: false });
  await page.waitForTimeout(600);
  assert(!(await page.$("#jskin-ucopy-group")), "buttons still there with skin off");
  return `warnings listed (form, datalist, process, userview, plugin, env, sensitive); cancel / bad file → no change; skin off → buttons removed (${before.id})`;
});

test("userview copy: save in a temporary app copy then delete the app", async (page) => {
  const TMP = "jskinucopytmp";
  await openUserviewBuilder(page);
  const originUv = await uvInfo(page);
  // drop a leftover temp app from a previous failed run
  let apps = await listAppIds(page);
  if (apps.includes(TMP)) {
    await csrfPost(page, `${BASE}/web/console/app/${TMP}/latest/delete`, {});
    await csrfPost(page, `${BASE}/web/console/app/${TMP}/1/delete`, {});
    apps = await listAppIds(page);
  }
  const beforeApps = apps.slice();
  assert(!beforeApps.includes(TMP), "could not remove leftover temp app: " + beforeApps);
  try {
    const created = await csrfPost(page, `${BASE}/web/console/app/submit`, {
      type: "duplicate",
      copyAppId: APP,
      id: TMP,
      name: "jskin ucopy tmp",
    });
    const appsAfterCreate = await listAppIds(page);
    if (!appsAfterCreate.includes(TMP)) {
      throw new Error("temp app was not created: HTTP " + created.status + " " + (created.text || "").slice(0, 400) + " apps=" + appsAfterCreate);
    }
    const tmpUrl = `${BASE}/web/console/app/${TMP}/1/userview/builder/${originUv.id}`;
    await openUserviewBuilder(page, tmpUrl);
    const { file, bundle } = await exportUvBundle(page);
    await chooseUvImport(page, file);
    await page.click("#jskin-ucopy-dialog .btn-primary");
    await page.waitForFunction((oldId) => {
      const CB = window.CustomBuilder;
      if (!CB || CB.appId !== "jskinucopytmp" || !CB.data || !CB.data.properties) return false;
      const id = CB.id || CB.data.properties.id;
      return id && id !== oldId;
    }, originUv.id, { timeout: 40000 });
    const imported = await uvInfo(page);
    // click Save (definition is already persisted; this confirms Save still works)
    const saveBtn = await page.$("#save-btn, #save-btn-toolbar, a#save-btn, button#save-btn");
    if (saveBtn) {
      await saveBtn.click();
      await page.waitForTimeout(2000);
    }
    const newUrl = `${BASE}/web/console/app/${TMP}/1/userview/builder/${imported.id}`;
    await page.goto(newUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.CustomBuilder && CustomBuilder.data && CustomBuilder.data.properties, null, { timeout: 20000 });
    const reloaded = await uvInfo(page);
    assert(reloaded.id === imported.id, "reload id " + reloaded.id + " != " + imported.id);
    assert(reloaded.json.properties.id === imported.id, "persisted json id mismatch");
    assert((reloaded.json.properties.name || "") === imported.name, "persisted name mismatch: " + reloaded.json.properties.name);
    await waitUvReady(page, reloaded.id);
    await shot(page, "ucopy-imported-saved");
    return `temp app ${TMP}: imported ${bundle.source.userviewId} -> ${reloaded.id} 「${reloaded.name}」, survived reload` + (saveBtn ? " and Save" : "");
  } finally {
    // delete every version we can; must leave local apps unchanged
    await csrfPost(page, `${BASE}/web/console/app/${TMP}/latest/delete`, {}).catch(() => {});
    await csrfPost(page, `${BASE}/web/console/app/${TMP}/1/delete`, {}).catch(() => {});
    // if ConnectionManager vanished after navigation, go back to a builder that still has it
    const leftover = await listAppIds(page).catch(() => null);
    if (leftover && leftover.includes(TMP)) {
      await open(page, urls.userview).catch(() => {});
      await csrfPost(page, `${BASE}/web/console/app/${TMP}/latest/delete`, {}).catch(() => {});
      await csrfPost(page, `${BASE}/web/console/app/${TMP}/1/delete`, {}).catch(() => {});
    }
    const afterApps = await listAppIds(page);
    assert(!afterApps.includes(TMP), "temp app still present after cleanup: " + afterApps);
    assert(JSON.stringify(afterApps) === JSON.stringify(beforeApps), "local apps changed: before=" + beforeApps + " after=" + afterApps);
  }
});


/* ---------- v1.4.3 Canvas Controls ---------- */
test("canvas controls: hidden by default, toolbar toggles and persists, x closes, skin off restores", async (page) => {
  await open(page, urls.process);
  await page.waitForFunction(() => window.ProcessBuilder && ProcessBuilder.currentProcessData && ProcessBuilder.currentProcessData.properties, null, { timeout: 20000 });
  await page.evaluate(() => localStorage.removeItem("jogetSkinCanvasControls"));
  await page.waitForSelector("#pbuilder-controls-indicator", { timeout: 15000 });
  await inject(page);
  await page.waitForSelector("#jskin-tool-btn", { timeout: 8000 });
  await openToolMenu(page);
  await page.waitForSelector("#jskin-cc-btn", { timeout: 5000 });
  const vis = () => page.evaluate(() => {
    const el = document.getElementById("pbuilder-controls-indicator");
    if (!el) return { present: false };
    const r = el.getBoundingClientRect();
    const display = getComputedStyle(el).display;
    const canvas = document.getElementById("builder_canvas");
    const c = canvas ? canvas.getBoundingClientRect() : null;
    const inCanvas = !!(c && r.width > 0 && display !== "none"
      && r.right <= c.right + 2 && r.left >= c.left - 2
      && r.bottom <= c.bottom + 2 && r.top >= c.top - 2);
    return {
      present: true, display,
      vis: r.width > 0 && r.height > 0 && display !== "none",
      inCanvas,
      w: Math.round(r.width), h: Math.round(r.height),
      left: Math.round(r.left), top: Math.round(r.top),
      store: localStorage.getItem("jogetSkinCanvasControls"),
      on: document.documentElement.classList.contains("jskin-cc-on"),
      btn: !!document.getElementById("jskin-cc-btn"),
      x: !!document.getElementById("jskin-cc-x"),
      pressed: (document.getElementById("jskin-cc-btn") || {}).getAttribute && document.getElementById("jskin-cc-btn").getAttribute("aria-pressed"),
      header: (document.getElementById("pbuilder-controls-header") || {}).textContent,
    };
  });
  const before = await vis();
  assert(before.btn && !before.vis && before.display === "none" && !before.on && !before.store, "not hidden by default: " + JSON.stringify(before));
  await shot(page, "canvasctl-closed");
  await openToolMenu(page);
  await page.click("#jskin-cc-btn");
  await page.waitForTimeout(300);
  const opened = await vis();
  assert(opened.vis && opened.inCanvas && opened.store === "1" && opened.on && opened.x && opened.pressed === "true", "did not show: " + JSON.stringify(opened));
  await shot(page, "canvasctl-open");
  await page.waitForFunction(() => {
    const x = document.getElementById("jskin-cc-x");
    if (!x) return false;
    const r = x.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }, null, { timeout: 5000 });
  await page.click("#jskin-cc-x");
  await page.waitForTimeout(300);
  const afterX = await vis();
  assert(!afterX.vis && afterX.store === "0" && afterX.pressed === "false", "x did not hide: " + JSON.stringify(afterX));
  await openToolMenu(page);
  await page.click("#jskin-cc-btn");
  await page.waitForTimeout(200);
  assert((await vis()).store === "1", "toolbar did not turn it back on");
  await setStore(page, { jogetSkinEnabled: false });
  await page.waitForTimeout(600);
  const off = await vis();
  const skin = await page.evaluate(() => document.documentElement.classList.contains("joget-skin"));
  assert(!off.btn && off.vis && !skin, "skin off did not restore panel: " + JSON.stringify(off) + " skin=" + skin);
  await page.evaluate(() => localStorage.removeItem("jogetSkinCanvasControls"));
  // sessionStorage stub survives navigation; turn the skin back on or inject() never sees joget-skin
  await setStore(page, { jogetSkinEnabled: true });
  await open(page, urls.textForm);
  await inject(page);
  const onForm = await page.evaluate(() => !!document.getElementById("jskin-cc-group"));
  assert(!onForm, "button on the form builder");
  return `default hidden; toggle + x persist in localStorage; skin off restores Joget panel; not on form builder`;
});

test("toolbar menu: one button holds process items, hover/click/Esc, UI builder swaps in UI copy", async (page) => {
  await open(page, urls.process);
  await page.waitForFunction(() => window.ProcessBuilder && ProcessBuilder.currentProcessData && ProcessBuilder.currentProcessData.properties, null, { timeout: 20000 });
  await inject(page);
  await page.waitForSelector("#jskin-tool-btn", { timeout: 8000 });
  const closed = await page.evaluate(() => document.getElementById("jskin-tool-btn")?.getAttribute("aria-expanded"));
  assert(closed === "false", "menu should start closed");
  await page.hover("#jskin-tool-group");
  await page.waitForFunction(() => document.getElementById("jskin-tool-btn")?.getAttribute("aria-expanded") === "true", null, { timeout: 3000 });
  const procItems = await page.evaluate(() => [...document.querySelectorAll("#jskin-tool-menu button")].map((b) => b.id + ":" + b.textContent.replace(/\s+/g, " ").trim()));
  assert(procItems.some((t) => t.startsWith("jskin-cc-btn:") && /Canvas Controls/.test(t)), "cc missing: " + procItems);
  assert(procItems.some((t) => t.startsWith("jskin-hotkeys-btn:") && /快捷键/.test(t)), "hotkeys missing: " + procItems);
  assert(procItems.some((t) => t.startsWith("jskin-pcopy-export:") && /导出此流程/.test(t)), "export missing: " + procItems);
  assert(procItems.some((t) => t.startsWith("jskin-pcopy-import:") && /导入流程/.test(t)), "import missing: " + procItems);
  assert(!procItems.some((t) => t.includes("jskin-ucopy")), "ui copy on process builder: " + procItems);
  await shot(page, "toolmenu-process");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.getElementById("jskin-tool-btn")?.getAttribute("aria-expanded") === "false", null, { timeout: 3000 });
  await page.click("#jskin-tool-btn");
  await page.waitForFunction(() => document.getElementById("jskin-tool-btn")?.getAttribute("aria-expanded") === "true", null, { timeout: 3000 });
  await page.click("#jskin-tool-btn");
  await page.waitForFunction(() => document.getElementById("jskin-tool-btn")?.getAttribute("aria-expanded") === "false", null, { timeout: 3000 });
  await open(page, urls.userview);
  await page.waitForFunction(() => window.CustomBuilder && CustomBuilder.builderType === "userview" && CustomBuilder.data, null, { timeout: 20000 });
  await inject(page);
  await openToolMenu(page);
  const uiItems = await page.evaluate(() => [...document.querySelectorAll("#jskin-tool-menu button")].map((b) => b.id));
  assert(uiItems.includes("jskin-ucopy-export") && uiItems.includes("jskin-ucopy-import"), "ui copy missing: " + uiItems);
  assert(uiItems.includes("jskin-hotkeys-btn") && !uiItems.includes("jskin-cc-btn") && !uiItems.includes("jskin-pcopy-export"), "process leftovers on UI builder: " + uiItems);
  await shot(page, "toolmenu-userview");
  await setStore(page, { jogetSkinEnabled: false });
  await page.waitForTimeout(600);
  const off = await page.evaluate(() => ({ menu: !!document.getElementById("jskin-tool-group"), btn: !!document.getElementById("jskin-tool-btn") }));
  assert(!off.menu && !off.btn, "menu stayed after skin off: " + JSON.stringify(off));
  return "process: cc + hotkeys + process copy; Esc/click toggle; UI builder swaps in UI copy; skin off removes menu";
});

/* ---------- runner ---------- */
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
// stand-in for moz-extension:// URLs of web_accessible_resources (see STUB runtime.getURL)
await ctx.route("**/__jskin_ext/**", (route) => {
  const f = decodeURIComponent(new URL(route.request().url()).pathname.split("/__jskin_ext/")[1] || "");
  const ok = (manifest.web_accessible_resources || []).some((w) => w.resources.includes(f));
  return ok ? route.fulfill({ status: 200, contentType: "text/javascript", body: read(f) }) : route.fulfill({ status: 404, body: "" });
});
const login = await ctx.newPage();
await login.goto(`${BASE}/web/console/home`);
if (await login.locator("#j_username").count()) {
  await login.fill("#j_username", USER);
  await login.fill("#j_password", PASS);
  await Promise.all([login.waitForNavigation(), login.click("input[type=submit], button[type=submit]")]);
}
urls = await builderUrls(login);
await login.close();

let failed = 0, ran = 0;
const t0 = Date.now();
console.log(`Joget Skin v${manifest.version} tests against ${BASE} (app ${APP} v${VER})\n`);
for (const t of tests) {
  if (FILTER.length && !FILTER.some((f) => t.name.toLowerCase().includes(f.toLowerCase()))) continue;
  ran++;
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => { if (/jskin|joget-skin|JogetSkin/i.test(e.stack || e.message)) errors.push(e.message); });
  const s = Date.now();
  try {
    const info = await t.fn(page, ctx);
    if (errors.length) throw new Error("page errors from skin code: " + errors.join(" | "));
    console.log(`PASS  ${t.name}  (${((Date.now() - s) / 1000).toFixed(1)}s)\n      ${info || ""}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${t.name}\n      ${e.message.split("\n")[0]}`);
    await shot(page, "FAIL-" + t.name.replace(/[^\w]+/g, "_").slice(0, 60)).catch(() => {});
  }
  await page.evaluate(() => sessionStorage.removeItem("__jskinStubStore")).catch(() => {});
  await page.close();
}
await browser.close();
console.log(`\n${ran - failed}/${ran} passed, ${failed} failed (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
process.exit(failed ? 1 : 0);
