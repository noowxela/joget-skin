/**
 * Joget Skin — edge handles (content script, top frame only).  v1.3.10
 * Pages: every builder (/jw/web/console/app/{appId}/{ver}/{type}/builder/...).
 *
 * 1. Left panel: Joget's #left-panel-toogle lives inside #left-panel, which is
 *    overflow:hidden, so it cannot be moved outside with CSS. We add our own button
 *    (#jskin-left-handle) fixed just OUTSIDE the panel's right edge; clicking it clicks
 *    Joget's button, so Joget's own toogleLeftPanel() (builder/builder.js:2576) still
 *    flips body.left-panel-closed and the arrow icon. Joget's button is made transparent
 *    (not display:none: Joget ignores clicks on a button jQuery sees as hidden) while ours
 *    exists (html.jskin-edge-handles).
 * 2. Quick nav (right side): #quick-nav-bar is fully hidden; a 20 x 64 toggle button
 *    (#jskin-qn-handle, same look as the left one) on the right edge opens / closes it
 *    (html.jskin-qn-pinned, remembered in localStorage). No hover reveal.
 *
 * 3. A hotkey (default Ctrl+[) toggles the left panel AND the quick nav together (v1.3.10):
 *    if either is open both close, otherwise both open, so they never end up out of step.
 *    Also caught inside the builder canvas iframe. Skipped inside CodeMirror (Ctrl+[ is
 *    "indent less" there) and while hotkeys.js is recording a new combo.
 *    The combo is user-editable in the hotkeys panel; stored in browser.storage.local
 *    under "jogetSkinHotkeyLeftPanel" as { ctrl, meta, alt, shift, code, key }.
 *
 * - Active only while <html> has class "joget-skin"; CSS hides both handles otherwise.
 * - Joget re-renders on SPA navigation; a MutationObserver puts the handles back.
 */
(function () {
  "use strict";

  if (window !== window.top || window.__jskinEdgeLoaded) {
    return;
  }
  window.__jskinEdgeLoaded = true;

  const ROOT = document.documentElement;
  const ROOT_CLASS = "jskin-edge-handles";
  const PIN_CLASS = "jskin-qn-pinned";
  const PIN_KEY = "jogetSkinQuickNavPinned";
  const LEFT_ID = "jskin-left-handle";
  const QN_ID = "jskin-qn-handle";
  const PAGE_RE = /\/web\/console\/app\/[^/]+\/[^/]+\/[^/]+\/builder(?:\/|$)/;

  let pinned = false;
  try {
    pinned = localStorage.getItem(PIN_KEY) === "1";
  } catch (e) { /* storage blocked */ }

  function setClass(c, on) {
    if (ROOT.classList.contains(c) !== on) {
      ROOT.classList.toggle(c, on); // only when it changes: a no-op still fires observers
    }
  }

  function leftIcon() {
    return document.body.classList.contains("left-panel-closed") ? "la-angle-right" : "la-angle-left";
  }

  function toggleLeft() {
    const j = document.getElementById("left-panel-toogle");
    if (j) j.click();
    requestAnimationFrame(sync);
  }

  function setPinned(v) {
    pinned = v;
    try {
      localStorage.setItem(PIN_KEY, pinned ? "1" : "0");
    } catch (err) { /* ignore */ }
    sync();
  }

  // hotkey: one combo for both edges; any open -> close both, else open both
  function toggleBoth() {
    const leftOpen = !document.body.classList.contains("left-panel-closed");
    const hasQn = !!document.getElementById(QN_ID);
    const open = !(leftOpen || (hasQn && pinned));
    if (leftOpen !== open && document.getElementById("left-panel-toogle")) toggleLeft();
    if (hasQn && pinned !== open) setPinned(open);
  }

  const HK_KEY = "jogetSkinHotkeyLeftPanel";
  const HK_DEFAULT = { ctrl: true, meta: false, alt: false, shift: false, code: "BracketLeft", key: "[" };
  let combo = HK_DEFAULT;
  const store = (typeof browser !== "undefined" && browser.storage && browser.storage.local) || null;
  if (store) {
    store.get(HK_KEY).then((r) => {
      if (r && r[HK_KEY] && r[HK_KEY].code) combo = r[HK_KEY];
    }).catch(() => {});
    browser.storage.onChanged.addListener((ch, area) => {
      if (area === "local" && ch[HK_KEY]) combo = (ch[HK_KEY].newValue && ch[HK_KEY].newValue.code) ? ch[HK_KEY].newValue : HK_DEFAULT;
    });
  }

  // physical key (e.code), so it works on any keyboard layout / IME
  function onKey(e) {
    const c = combo;
    if (e.code !== c.code || e.ctrlKey !== !!c.ctrl || e.metaKey !== !!c.meta || e.altKey !== !!c.alt || e.shiftKey !== !!c.shift) return;
    if (ROOT.hasAttribute("data-jskin-hk-recording")) return;
    if (!ROOT.classList.contains("joget-skin") || !ROOT.classList.contains(ROOT_CLASS)) return;
    const t = e.target;
    if (t && t.closest && t.closest(".CodeMirror, .cm-editor")) return;
    e.preventDefault();
    e.stopPropagation();
    toggleBoth();
  }
  window.addEventListener("keydown", onKey, true);
  const hooked = new WeakSet();
  function hookFrames() {
    document.querySelectorAll("iframe").forEach((f) => {
      try {
        const w = f.contentWindow;
        if (w && !hooked.has(w) && w.document) {
          hooked.add(w);
          w.addEventListener("keydown", onKey, true);
        }
      } catch (err) { /* cross-origin frame */ }
    });
  }

  function ensureLeft() {
    const joget = document.getElementById("left-panel-toogle");
    let btn = document.getElementById(LEFT_ID);
    if (!joget) {
      if (btn) btn.remove();
      return false;
    }
    if (!btn) {
      btn = document.createElement("button");
      btn.id = LEFT_ID;
      btn.type = "button";
      btn.innerHTML = '<i class="las"></i>';
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        toggleLeft();
      });
      document.body.append(btn);
    }
    const closed = document.body.classList.contains("left-panel-closed");
    btn.title = closed ? "展开左侧面板" : "收起左侧面板";
    const i = btn.firstElementChild;
    const want = "las " + leftIcon();
    if (i.className !== want) i.className = want;
    return true;
  }

  function ensureQuickNav() {
    const nav = document.getElementById("quick-nav-bar");
    let h = document.getElementById(QN_ID);
    if (!nav) {
      if (h) h.remove();
      return;
    }
    if (!h) {
      h = document.createElement("button");
      h.id = QN_ID;
      h.type = "button";
      h.innerHTML = '<i class="las la-angle-left"></i>';
      h.addEventListener("click", (e) => {
        e.preventDefault();
        setPinned(!pinned);
      });
      document.body.append(h);
    }
    h.title = pinned ? "收起 Quick Nav" : "展开 Quick Nav";
    const i = h.firstElementChild;
    const want = "las " + (pinned ? "la-angle-right" : "la-angle-left"); // arrow points where it will go
    if (i.className !== want) i.className = want;
  }

  function sync() {
    if (!document.body || !PAGE_RE.test(location.pathname)) {
      [LEFT_ID, QN_ID].forEach((id) => document.getElementById(id)?.remove());
      setClass(ROOT_CLASS, false);
      return;
    }
    setClass(ROOT_CLASS, ensureLeft());
    hookFrames();
    ensureQuickNav();
    setClass(PIN_CLASS, pinned);
  }

  let scheduled = false;
  function schedule() {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        sync();
      });
    }
  }

  sync();
  // body class flips (left-panel-closed, quick-nav-shown) + Joget re-renders
  new MutationObserver(schedule).observe(document.body, {
    attributes: true,
    attributeFilter: ["class"],
    childList: true,
  });
  window.addEventListener("popstate", schedule);
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      schedule();
    }
  }, 500);
})();
