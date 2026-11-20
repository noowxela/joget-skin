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
 * Read-only against Joget: it only opens pages, clicks elements to select them, opens/closes
 * panels and injects the extension's CSS/JS (like the content scripts would, with a stubbed
 * browser.storage). It never clicks Save and never submits anything.
 */
import fs from "fs";
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
    runtime: { getManifest: () => (${JSON.stringify({ version: manifest.version })}) } };
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
  assert(after === "jskin-hotkeys-group", "button position: " + after);
  const propsOpen = () => page.evaluate(() => !document.body.classList.contains("no-right-panel"));
  const wasOpen = await propsOpen();
  await page.click("#jskin-hotkeys-btn");
  await page.waitForTimeout(300);
  const rows = await page.locator("#jskin-hotkeys-panel tr").count();
  assert(rows >= 15, "rows " + rows);
  await shot(page, "hotkeys-open");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  assert((await page.locator("#jskin-hotkeys-panel").count()) === 0, "Esc did not close");
  assert((await propsOpen()) === wasOpen, "Esc also changed Joget's property panel");
  await page.click("#jskin-hotkeys-btn");
  await page.mouse.click(30, 450); // left palette area
  await page.waitForTimeout(300);
  assert((await page.locator("#jskin-hotkeys-panel").count()) === 0, "outside click did not close");
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
  assert(ids[0] === "jskin-others-group" && ids[1] === "jskin-hotkeys-group", "order " + ids);
  return "Advanced Tools → 显示其他 Builder → 快捷键";
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

/* ---------- runner ---------- */
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
