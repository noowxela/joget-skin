/**
 * Joget Skin — hide / show Process Builder's "Canvas Controls" panel (v1.4.3).
 * Page: Process Builder /jw/web/console/app/{appId}/{ver}/process/builder (top frame only).
 * Loaded on every builder page (manifest "builder*") because Joget can switch builders
 * without a reload; the toolbar button exists only while the path is the process builder.
 *
 * Joget itself appends #pbuilder-controls-indicator to document.body (pbuilder.js,
 * around the "Simple controls indicator" IIFE) and only collapses it with class "hidden",
 * which still leaves a chip in the lower-right corner. Under html.joget-skin the panel
 * is fully hidden unless the user turns it on. State is localStorage.jogetSkinCanvasControls
 * ("1" / "0"; missing means hidden). A small × on the panel hides it the same way.
 * Active only while <html> has class "joget-skin".
 */
(function () {
  "use strict";

  if (window !== window.top || window.__jskinCanvasCtlLoaded) {
    return;
  }
  window.__jskinCanvasCtlLoaded = true;

  const ROOT = document.documentElement;
  const SKIN_CLASS = "joget-skin";
  const ON_CLASS = "jskin-cc-on";
  const GROUP_ID = "jskin-cc-group";
  const BTN_ID = "jskin-cc-btn";
  const X_ID = "jskin-cc-x";
  const PANEL_ID = "pbuilder-controls-indicator";
  const KEY = "jogetSkinCanvasControls";
  const PAGE_RE = /\/web\/console\/app\/[^/]+\/[^/]+\/process\/builder(?:\/|$)/;
  const PCOPY_GROUP_ID = "jskin-pcopy-group";
  const HOTKEYS_GROUP_ID = "jskin-hotkeys-group";
  const OTHERS_GROUP_ID = "jskin-others-group";

  const skinOn = () => ROOT.classList.contains(SKIN_CLASS);
  const onPage = () => PAGE_RE.test(location.pathname);
  const isOn = () => localStorage.getItem(KEY) === "1";
  const setOn = (v) => localStorage.setItem(KEY, v ? "1" : "0");

  let busy = false;
  let scheduled = false;

  // Joget pins the panel at right:50px / z-index:9, which sits under the
  // property pane. Move it into the canvas once per show; leave it alone
  // after the user drags it, and clear the inline position when hiding so
  // a skin-off restore goes back to Joget's default.
  function resetPlace(panel) {
    if (!panel) {
      return;
    }
    delete panel.dataset.jskinPlaced;
    panel.style.right = "";
    panel.style.bottom = "";
    panel.style.left = "";
    panel.style.top = "";
    panel.style.zIndex = "";
  }

  function placePanel(panel) {
    if (!panel || panel.dataset.jskinPlaced === "1") {
      return;
    }
    const canvas = document.getElementById("builder_canvas");
    if (!canvas) {
      return;
    }
    const r = canvas.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) {
      return;
    }
    const pr = panel.getBoundingClientRect();
    const alreadyInCanvas =
      pr.width > 0 &&
      pr.right <= r.right - 4 &&
      pr.left >= r.left + 4 &&
      pr.bottom <= r.bottom - 4 &&
      pr.top >= r.top + 4;
    if (!alreadyInCanvas) {
      panel.style.right = Math.round(Math.max(8, window.innerWidth - r.right + 16)) + "px";
      panel.style.bottom = Math.round(Math.max(8, window.innerHeight - r.bottom + 16)) + "px";
      panel.style.left = "auto";
      panel.style.top = "auto";
    }
    panel.dataset.jskinPlaced = "1";
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) {
      e.className = cls;
    }
    if (text !== undefined) {
      e.textContent = text;
    }
    return e;
  }

  function apply() {
    const show = skinOn() && onPage() && isOn();
    ROOT.classList.toggle(ON_CLASS, show);
    const btn = document.getElementById(BTN_ID);
    if (btn) {
      btn.classList.toggle("active", show);
      btn.setAttribute("aria-pressed", show ? "true" : "false");
      btn.title = show ? "隐藏 Canvas Controls" : "显示 Canvas Controls";
    }
    const panel = document.getElementById(PANEL_ID);
    if (panel && show) {
      panel.classList.remove("hidden");
      ensureCloseX(panel);
      placePanel(panel);
    } else if (panel) {
      resetPlace(panel);
    }
  }

  function ensureCloseX(panel) {
    if (document.getElementById(X_ID)) {
      return;
    }
    const x = el("button", "jskin-cc-x");
    x.id = X_ID;
    x.type = "button";
    x.title = "隐藏 Canvas Controls";
    x.setAttribute("aria-label", "隐藏 Canvas Controls");
    x.textContent = "×";
    x.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setOn(false);
      apply();
    });
    panel.append(x);
  }

  function toggle() {
    setOn(!isOn());
    apply();
  }

  function ensureButton() {
    const existing = document.getElementById(GROUP_ID);
    if (!skinOn() || !onPage()) {
      if (existing) {
        existing.remove();
      }
      ROOT.classList.remove(ON_CLASS);
      const x = document.getElementById(X_ID);
      if (x) {
        x.remove();
      }
      resetPlace(document.getElementById(PANEL_ID));
      return;
    }
    const anchor = document.querySelector("#builderToolbar .advanced-tools-toogle");
    if (!anchor) {
      return;
    }
    const after = document.getElementById(PCOPY_GROUP_ID)
      || document.getElementById(HOTKEYS_GROUP_ID)
      || document.getElementById(OTHERS_GROUP_ID)
      || anchor;
    if (existing) {
      if (existing.previousElementSibling !== after) {
        after.after(existing);
      }
      apply();
      return;
    }
    const group = el("div", "btn-group toolbar-group me-3");
    group.id = GROUP_ID;
    group.setAttribute("role", "group");
    const btn = el("button", "btn btn-light");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.title = "显示 / 隐藏 Canvas Controls";
    btn.setAttribute("aria-label", "显示 / 隐藏 Canvas Controls");
    btn.setAttribute("aria-pressed", "false");
    const icon = document.createElement("i");
    icon.className = "las la-info-circle";
    btn.append(icon);
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    });
    group.append(btn);
    after.after(group);
    apply();
  }

  function run() {
    scheduled = false;
    busy = true;
    try {
      ensureButton();
    } finally {
      busy = false;
    }
  }
  function schedule() {
    if (scheduled) {
      return;
    }
    scheduled = true;
    requestAnimationFrame(run);
  }

  new MutationObserver(() => {
    if (!busy) {
      schedule();
    }
  }).observe(document.body || ROOT, { childList: true, subtree: true });
  new MutationObserver(schedule).observe(ROOT, { attributes: true, attributeFilter: ["class"] });
  window.addEventListener("popstate", schedule);
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      schedule();
    }
  }, 500);
  schedule();
})();
