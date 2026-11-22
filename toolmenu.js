/**
 * Joget Skin — single toolbar menu that gathers process / UI copy, Canvas
 * Controls, and hotkeys (v1.4.3). Loaded on builder* (including /builders).
 * The dropdown is portaled to document.body so #top-panel { overflow: hidden }
 * cannot clip it. Existing button ids stay the same; this file only hosts them.
 */
(function () {
  "use strict";

  if (window !== window.top || window.__jskinToolMenuLoaded) {
    return;
  }
  window.__jskinToolMenuLoaded = true;

  const ROOT = document.documentElement;
  const SKIN_CLASS = "joget-skin";
  const GROUP_ID = "jskin-tool-group";
  const BTN_ID = "jskin-tool-btn";
  const MENU_ID = "jskin-tool-menu";
  const OTHERS_GROUP_ID = "jskin-others-group";
  const MENU_ORDER = ["jskin-cc-group", "jskin-hotkeys-group", "jskin-pcopy-group", "jskin-ucopy-group"];
  const CLOSE_MS = 200;

  let closeTimer = null;
  let busy = false;
  let scheduled = false;

  const skinOn = () => ROOT.classList.contains(SKIN_CLASS);

  function onBuilderPage() {
    return !!document.querySelector("#builderToolbar .advanced-tools-toogle");
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

  function isOpen() {
    const btn = document.getElementById(BTN_ID);
    return !!(btn && btn.getAttribute("aria-expanded") === "true");
  }

  function cancelClose() {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  }

  function scheduleClose() {
    cancelClose();
    closeTimer = setTimeout(closeMenu, CLOSE_MS);
  }

  function decorateItems() {
    const cc = document.getElementById("jskin-cc-btn");
    if (cc) {
      let lab = cc.querySelector(".jskin-tool-label");
      if (!lab) {
        lab = el("span", "jskin-tool-label");
        cc.append(lab);
      }
      const on = cc.getAttribute("aria-pressed") === "true" || ROOT.classList.contains("jskin-cc-on");
      lab.textContent = on ? "Canvas Controls  ✓ 已显示" : "Canvas Controls（已隐藏）";
    }
    const hk = document.getElementById("jskin-hotkeys-btn");
    if (hk && !hk.querySelector(".jskin-tool-label")) {
      hk.append(el("span", "jskin-tool-label", "快捷键"));
    }
  }

  function positionMenu() {
    const btn = document.getElementById(BTN_ID);
    const menu = document.getElementById(MENU_ID);
    if (!btn || !menu) {
      return;
    }
    const r = btn.getBoundingClientRect();
    menu.style.top = Math.round(r.bottom + 2) + "px";
    let left = r.left;
    const width = menu.offsetWidth || 240;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, r.right - width);
    }
    menu.style.left = Math.round(left) + "px";
  }

  function openMenu() {
    const btn = document.getElementById(BTN_ID);
    const menu = document.getElementById(MENU_ID);
    if (!btn || !menu) {
      return;
    }
    adopt();
    decorateItems();
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    if (menu.parentElement !== document.body) {
      document.body.append(menu);
    }
    positionMenu();
  }

  function closeMenu() {
    cancelClose();
    const btn = document.getElementById(BTN_ID);
    const menu = document.getElementById(MENU_ID);
    if (btn) {
      btn.setAttribute("aria-expanded", "false");
    }
    if (menu) {
      menu.hidden = true;
    }
  }

  function adopt() {
    const menu = document.getElementById(MENU_ID);
    if (!menu) {
      return;
    }
    for (const id of MENU_ORDER) {
      const g = document.getElementById(id);
      if (g && g.parentElement !== menu) {
        menu.append(g);
      }
    }
    // keep declared order even if a later group was appended first
    MENU_ORDER.forEach((id) => {
      const g = document.getElementById(id);
      if (g && g.parentElement === menu) {
        menu.append(g);
      }
    });
    decorateItems();
  }
  window.__jskinToolMenuAdopt = adopt;

  function bindMenu(menu) {
    if (menu.dataset.jskinBound) {
      return;
    }
    menu.dataset.jskinBound = "1";
    menu.addEventListener("mouseenter", cancelClose);
    menu.addEventListener("mouseleave", scheduleClose);
    menu.addEventListener("click", (e) => {
      if (e.target.closest("button")) {
        setTimeout(closeMenu, 0);
      }
    });
  }

  function ensure() {
    if (!skinOn() || !onBuilderPage()) {
      const group = document.getElementById(GROUP_ID);
      const menu = document.getElementById(MENU_ID);
      if (group) {
        group.remove();
      }
      if (menu) {
        menu.remove();
      }
      return;
    }
    const anchor = document.querySelector("#builderToolbar .advanced-tools-toogle");
    if (!anchor) {
      return;
    }
    const others = document.getElementById(OTHERS_GROUP_ID);
    const after = others || anchor;
    let group = document.getElementById(GROUP_ID);
    let menu = document.getElementById(MENU_ID);
    if (!group) {
      group = el("div", "btn-group toolbar-group me-3");
      group.id = GROUP_ID;
      group.setAttribute("role", "group");
      const btn = el("button", "btn btn-light");
      btn.id = BTN_ID;
      btn.type = "button";
      btn.title = "Joget Skin";
      btn.setAttribute("aria-label", "Joget Skin");
      btn.setAttribute("aria-haspopup", "menu");
      btn.setAttribute("aria-expanded", "false");
      const icon = document.createElement("i");
      icon.className = "las la-wrench";
      btn.append(icon, el("span", "jskin-tool-btn-text", "Joget Skin"), el("span", "jskin-tool-caret", "▾"));
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        cancelClose();
        if (isOpen()) {
          closeMenu();
        } else {
          openMenu();
        }
      });
      btn.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          closeMenu();
          btn.focus();
        }
      });
      group.addEventListener("mouseenter", () => {
        cancelClose();
        openMenu();
      });
      group.addEventListener("mouseleave", scheduleClose);
      group.append(btn);
      after.after(group);
      menu = el("div", "jskin-tool-menu");
      menu.id = MENU_ID;
      menu.setAttribute("role", "menu");
      menu.hidden = true;
      document.body.append(menu);
      bindMenu(menu);
    } else if (group.previousElementSibling !== after) {
      after.after(group);
    }
    if (menu) {
      bindMenu(menu);
    }
    adopt();
  }

  function run() {
    scheduled = false;
    busy = true;
    try {
      ensure();
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

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) {
      closeMenu();
    }
  });
  document.addEventListener("click", (e) => {
    const group = document.getElementById(GROUP_ID);
    const menu = document.getElementById(MENU_ID);
    if (!isOpen()) {
      return;
    }
    if (group && group.contains(e.target)) {
      return;
    }
    if (menu && menu.contains(e.target)) {
      return;
    }
    closeMenu();
  });
  window.addEventListener("resize", () => {
    if (isOpen()) {
      positionMenu();
    }
  });

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
      closeMenu();
      schedule();
    }
  }, 500);
  schedule();
})();
