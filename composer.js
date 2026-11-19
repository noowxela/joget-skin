/**
 * Joget Skin — App Composer layout (content script, top frame only).
 * Page: /jw/web/console/app/{appId}/{version}/builders   (Joget DX 9)
 *
 * 1. Shows only Form / List / UI / Process Builder by default; a toolbar button
 *    (right of "Advanced Tools") shows/hides the other builder types.
 *    State: browser.storage.local "jogetSkinComposerShowOthers" (default false).
 * 2. Groups Form Builder items by their table name (.item-sublabel) under small
 *    headers. Existing <li> nodes are MOVED (never cloned), so Joget's delegated
 *    click / hover / actions handlers on #builder_canvas keep working.
 *
 * Everything is active only while <html> has class "joget-skin" (set by content.js
 * from the popup's on/off switch). When the skin is off, the button is removed,
 * the original item order is restored and all layout CSS stops matching.
 */
(function () {
  "use strict";

  if (!/\/web\/console\/app\/[^/]+\/[^/]+\/builders\/?$/.test(location.pathname)) {
    return;
  }

  const ROOT = document.documentElement;
  const SKIN_CLASS = "joget-skin";
  const HIDE_CLASS = "jskin-composer-hide-others";   // on <html>
  const ACTIVE_CLASS = "jskin-composer";              // on <html>: composer layout active
  const SHOW_KEY = "jogetSkinComposerShowOthers";
  const BTN_GROUP_ID = "jskin-others-group";
  const BTN_ID = "jskin-others-btn";
  const HEADER_CLASS = "jskin-group-header";
  const IDX_ATTR = "data-jskin-idx";
  const EMPTY_LABEL = "（无表名）";

  let showOthers = false;
  let busy = false;          // true while we mutate the DOM ourselves
  let scheduled = false;

  const skinOn = () => ROOT.classList.contains(SKIN_CLASS);

  /* ---------- re-layout: Joget recomputes grid-row spans on window resize ---------- */
  function relayout() {
    try {
      window.dispatchEvent(new Event("resize"));
    } catch (e) {
      /* ignore */
    }
  }

  /* ---------- 1. show / hide other builders ---------- */
  function applyHideClass() {
    ROOT.classList.toggle(ACTIVE_CLASS, skinOn());
    ROOT.classList.toggle(HIDE_CLASS, skinOn() && !showOthers);
  }

  function updateButtonLabel(btn) {
    const label = showOthers ? "隐藏其他 Builder" : "显示其他 Builder";
    // aria-label, not title: Joget turns toolbar titles into cached tooltips that would go stale
    btn.setAttribute("aria-label", label);
    btn.setAttribute("aria-pressed", showOthers ? "true" : "false");
    const icon = btn.querySelector("i");
    const span = btn.querySelector("span");
    const iconClass = showOthers ? "las la-eye-slash" : "las la-eye";
    if (icon && icon.className !== iconClass) {
      icon.className = iconClass;
    }
    if (span && span.textContent !== label) {
      span.textContent = label;
    }
  }

  function ensureButton() {
    const existing = document.getElementById(BTN_GROUP_ID);
    if (!skinOn()) {
      if (existing) {
        existing.remove();
      }
      return;
    }
    const anchor = document.querySelector("#builderToolbar .advanced-tools-toogle");
    if (!anchor) {
      return;
    }
    if (existing) {
      if (existing.previousElementSibling !== anchor) {
        anchor.after(existing);
      }
      updateButtonLabel(existing.querySelector("button"));
      return;
    }
    // Same markup/classes as Joget's own toolbar groups => native look.
    const group = document.createElement("div");
    group.id = BTN_GROUP_ID;
    group.className = "btn-group toolbar-group me-3";
    group.setAttribute("role", "group");
    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.className = "btn btn-light";
    const icon = document.createElement("i");
    const span = document.createElement("span");
    btn.append(icon, document.createTextNode(" "), span);
    group.append(btn);
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showOthers = !showOthers;
      browser.storage.local.set({ [SHOW_KEY]: showOthers });
      applyHideClass();
      updateButtonLabel(btn);
      relayout();
    });
    updateButtonLabel(btn);
    anchor.after(group);
  }

  /* ---------- 2. group Form Builder items by table ---------- */
  function formList() {
    return document.querySelector("#builders > .builder-type.builder-form .ul-wrapper > ul");
  }

  function sublabelOf(li) {
    const s = li.querySelector(":scope > a.item-link > .item-sublabel");
    return s ? s.textContent.trim() : "";
  }

  function makeHeader(table, count) {
    const h = document.createElement("li");
    h.className = HEADER_CLASS;
    h.setAttribute("data-jskin-table", table);
    h.setAttribute("aria-hidden", "true");
    const icon = document.createElement("i");
    icon.className = "las la-table";
    const name = document.createElement("span");
    name.className = "jskin-group-name";
    name.textContent = table || EMPTY_LABEL;
    const cnt = document.createElement("span");
    cnt.className = "jskin-group-count";
    cnt.textContent = String(count);
    h.append(icon, name, cnt);
    return h;
  }

  function desiredSignature(items) {
    return items.map((li) => sublabelOf(li) + "|" + li.getAttribute("data-id")).join(",");
  }

  function group(ul) {
    const items = Array.from(ul.querySelectorAll(":scope > li.item"));
    if (items.length === 0) {
      return;
    }
    // remember Joget's original order (only for items we have not seen yet)
    let next = items.reduce((m, li) => Math.max(m, Number(li.getAttribute(IDX_ATTR) ?? -1)), -1) + 1;
    items.forEach((li) => {
      if (!li.hasAttribute(IDX_ATTR)) {
        li.setAttribute(IDX_ATTR, String(next++));
      }
    });
    items.sort((a, b) => Number(a.getAttribute(IDX_ATTR)) - Number(b.getAttribute(IDX_ATTR)));

    // groups in order of first appearance; empty table name last
    const groups = new Map();
    items.forEach((li) => {
      const t = sublabelOf(li);
      if (!groups.has(t)) {
        groups.set(t, []);
      }
      groups.get(t).push(li);
    });
    if (groups.has("")) {
      const empty = groups.get("");
      groups.delete("");
      groups.set("", empty);
    }

    const sig = desiredSignature(items);
    if (ul.getAttribute("data-jskin-grouped") === sig && ul.querySelector(":scope > ." + HEADER_CLASS)) {
      updateHeaderVisibility(ul);
      return; // already grouped exactly like this (idempotent)
    }

    ul.querySelectorAll(":scope > ." + HEADER_CLASS).forEach((h) => h.remove());
    const others = Array.from(ul.children).filter((c) => !c.classList.contains("item")); // e.g. li.message
    for (const [table, lis] of groups) {
      ul.append(makeHeader(table, lis.length));
      lis.forEach((li) => ul.append(li)); // moves the node, keeps listeners/state
    }
    others.forEach((c) => ul.append(c));
    ul.setAttribute("data-jskin-grouped", sig);
    ul.classList.add("jskin-grouped");
    updateHeaderVisibility(ul);
  }

  function ungroup(ul) {
    ul.querySelectorAll(":scope > ." + HEADER_CLASS).forEach((h) => h.remove());
    const items = Array.from(ul.querySelectorAll(":scope > li.item[" + IDX_ATTR + "]"));
    items.sort((a, b) => Number(a.getAttribute(IDX_ATTR)) - Number(b.getAttribute(IDX_ATTR)));
    const others = Array.from(ul.children).filter((c) => !c.hasAttribute(IDX_ATTR));
    items.forEach((li) => ul.append(li));
    others.forEach((c) => ul.append(c));
    ul.removeAttribute("data-jskin-grouped");
    ul.classList.remove("jskin-grouped");
  }

  // Hide a header when Joget's search / usage filter hides every item in its group.
  function updateHeaderVisibility(ul) {
    let header = null;
    let visible = 0;
    const flush = () => {
      if (header) {
        const hide = visible === 0;
        if (header.classList.contains("jskin-group-empty") !== hide) {
          header.classList.toggle("jskin-group-empty", hide);
        }
      }
    };
    for (const el of ul.children) {
      if (el.classList.contains(HEADER_CLASS)) {
        flush();
        header = el;
        visible = 0;
      } else if (el.classList.contains("item") && getComputedStyle(el).display !== "none") {
        visible++;
      }
    }
    flush();
  }

  /* ---------- main pass ---------- */
  function run() {
    scheduled = false;
    busy = true;
    try {
      applyHideClass();
      ensureButton();
      const ul = formList();
      if (ul) {
        const before = ul.getAttribute("data-jskin-grouped");
        if (skinOn()) {
          group(ul);
        } else if (ul.classList.contains("jskin-grouped")) {
          ungroup(ul);
        }
        if (before !== ul.getAttribute("data-jskin-grouped")) {
          relayout();
        }
      }
    } finally {
      // let our own mutations flush before listening again
      setTimeout(() => {
        busy = false;
      }, 0);
    }
  }

  function schedule() {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(run);
    }
  }

  /* ---------- observers ---------- */
  // Joget re-renders #builders (switching views, search, add/delete items).
  new MutationObserver(() => {
    if (!busy) {
      schedule();
    }
  }).observe(document.body || ROOT, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "class"],
  });

  // Skin on/off switch (content.js toggles the class on <html>).
  new MutationObserver(schedule).observe(ROOT, { attributes: true, attributeFilter: ["class"] });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[SHOW_KEY]) {
      showOthers = changes[SHOW_KEY].newValue === true;
      schedule();
    }
  });

  browser.storage.local.get({ [SHOW_KEY]: false }).then((r) => {
    showOthers = r[SHOW_KEY] === true;
    schedule();
  });
})();
