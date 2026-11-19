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
 * 3. Group headers are clickable (chevron) to collapse/expand one group; two buttons
 *    next to Form Builder's "+" collapse / expand all groups. The collapsed tables live in
 *    an in-memory Set (the single source of truth for this tab) and are saved per app in
 *    browser.storage.local "jogetSkinComposerCollapsed:<appId>" = { tables, tab, seq }.
 *    Our own storage echoes are ignored (they could arrive late and roll the Set back);
 *    only changes written by another tab are applied. Every pass re-derives the DOM from
 *    the Set, so Joget re-renders (renderBuilders, search, publish, undo) can't reopen groups.
 *    While Joget's search (or a tag filter / usages view) is active, nothing is collapsed,
 *    so every group with matches is visible; the saved state is left untouched.
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
  const LEGACY_COLLAPSE_KEY = "jogetSkinComposerCollapsed"; // v1.3.3: { appId: [table] }
  const COLLAPSED_ITEM = "jskin-collapsed-item";
  const TITLE_BTNS_CLASS = "jskin-title-btns";
  const APP_ID = (location.pathname.match(/\/console\/app\/([^/]+)\//) || [])[1] || "";

  const COLLAPSE_KEY = LEGACY_COLLAPSE_KEY + ":" + APP_ID;
  const TAB_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);

  let collapsed = new Set(); // tables collapsed in this app (source of truth)
  let collapseTouched = false; // user changed it before the initial storage read finished
  let writeSeq = 0;

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
    h.setAttribute("role", "button");
    h.setAttribute("tabindex", "0");
    const chevron = document.createElement("i");
    chevron.className = "las la-angle-down jskin-chevron";
    const icon = document.createElement("i");
    icon.className = "las la-table";
    const name = document.createElement("span");
    name.className = "jskin-group-name";
    name.textContent = table || EMPTY_LABEL;
    const cnt = document.createElement("span");
    cnt.className = "jskin-group-count";
    cnt.textContent = String(count);
    h.append(chevron, icon, name, cnt);
    const toggle = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const set = collapsedSet();
      if (set.has(table)) {
        set.delete(table);
      } else {
        set.add(table);
      }
      saveCollapsed(set);
    };
    h.addEventListener("click", toggle);
    h.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        toggle(e);
      }
    });
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
    items.forEach((li) => li.classList.remove(COLLAPSED_ITEM));
    ul.removeAttribute("data-jskin-grouped");
    ul.classList.remove("jskin-grouped");
  }

  /* ---------- 3. collapse / expand ---------- */
  function collapsedSet() {
    return new Set(collapsed);
  }

  function saveCollapsed(set) {
    collapsed = new Set(set);
    collapseTouched = true;
    const rec = { tables: Array.from(collapsed), tab: TAB_ID, seq: ++writeSeq };
    browser.storage.local.set({ [COLLAPSE_KEY]: rec }).catch(() => {});
    schedule();
  }

  // Joget search text, a tag filter or the usages view => show all groups (don't collapse)
  function filtering() {
    const input = document.querySelector("#builder_canvas .search-container > input");
    return (
      (input && input.value.trim() !== "") ||
      !!document.querySelector("#builder_canvas .sub-search") ||
      document.body.classList.contains("show-usages-mode")
    );
  }

  function applyCollapse(ul) {
    const set = collapsedSet();
    const off = filtering();
    let changed = false;
    let isCollapsed = false;
    for (const el of ul.children) {
      if (el.classList.contains(HEADER_CLASS)) {
        isCollapsed = !off && set.has(el.getAttribute("data-jskin-table"));
        if (el.classList.contains("jskin-collapsed") !== isCollapsed) {
          el.classList.toggle("jskin-collapsed", isCollapsed);
          changed = true;
        }
        const aria = isCollapsed ? "false" : "true";
        if (el.getAttribute("aria-expanded") !== aria) {
          el.setAttribute("aria-expanded", aria);
        }
      } else if (el.classList.contains("item")) {
        if (el.classList.contains(COLLAPSED_ITEM) !== isCollapsed) {
          el.classList.toggle(COLLAPSED_ITEM, isCollapsed);
          changed = true;
        }
      }
    }
    return changed;
  }

  function makeTitleBtn(cls, icon, label, onClick) {
    const a = document.createElement("a");
    a.className = "jskin-title-btn " + cls;
    a.setAttribute("role", "button");
    a.setAttribute("aria-label", label);
    a.title = label; // static label, so no stale-tooltip problem
    const i = document.createElement("i");
    i.className = icon;
    a.append(i);
    a.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return a;
  }

  function ensureTitleButtons() {
    const title = document.querySelector("#builders > .builder-type.builder-form > .builder-title");
    const existing = document.querySelector("." + TITLE_BTNS_CLASS);
    if (!skinOn() || !title) {
      if (existing) {
        existing.remove();
      }
      return;
    }
    if (existing && existing.parentElement === title) {
      return;
    }
    if (existing) {
      existing.remove();
    }
    const wrap = document.createElement("span");
    wrap.className = TITLE_BTNS_CLASS;
    wrap.append(
      makeTitleBtn("jskin-collapse-all", "las la-angle-double-up", "全部收起", () => {
        const ul = formList();
        const tables = ul
          ? Array.from(ul.querySelectorAll(":scope > ." + HEADER_CLASS)).map((h) => h.getAttribute("data-jskin-table"))
          : [];
        saveCollapsed(new Set(tables));
      }),
      makeTitleBtn("jskin-expand-all", "las la-angle-double-down", "全部展开", () => saveCollapsed(new Set()))
    );
    title.append(wrap);
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
      } else if (
        el.classList.contains("item") &&
        (el.classList.contains(COLLAPSED_ITEM) || getComputedStyle(el).display !== "none")
      ) {
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
      ensureTitleButtons();
      const ul = formList();
      if (ul) {
        const before = ul.getAttribute("data-jskin-grouped");
        let changed = false;
        if (skinOn()) {
          group(ul);
          changed = applyCollapse(ul);
          updateHeaderVisibility(ul);
        } else if (ul.classList.contains("jskin-grouped")) {
          ungroup(ul);
        }
        if (changed || before !== ul.getAttribute("data-jskin-grouped")) {
          relayout();
        }
      }
    } finally {
      // Drop the records of our own mutations synchronously. (The old setTimeout(0)
      // window also swallowed Joget mutations that landed in it, e.g. a re-render.)
      observer.takeRecords();
      busy = false;
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
  const observer = new MutationObserver(() => {
    if (!busy) {
      schedule();
    }
  });
  observer.observe(document.body || ROOT, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "class"],
  });

  // Skin on/off switch (content.js toggles the class on <html>).
  new MutationObserver(schedule).observe(ROOT, { attributes: true, attributeFilter: ["class"] });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") {
      return;
    }
    if (changes[SHOW_KEY]) {
      showOthers = changes[SHOW_KEY].newValue === true;
    }
    let collapseChanged = false;
    if (changes[COLLAPSE_KEY]) {
      const rec = changes[COLLAPSE_KEY].newValue;
      // Ignore echoes of our own writes: they can arrive after a newer local change
      // and would roll the Set back (= groups "re-open by themselves").
      if (!rec || rec.tab !== TAB_ID) {
        collapsed = new Set((rec && rec.tables) || []);
        collapseChanged = true;
      }
    }
    if (changes[SHOW_KEY] || collapseChanged) {
      schedule();
    }
  });

  // search box typing (Joget filters on keyup); re-evaluate collapse
  document.addEventListener("input", (e) => {
    if (e.target && e.target.closest && e.target.closest("#builder_canvas .canvas-header")) {
      schedule();
    }
  }, true);

  browser.storage.local.get([SHOW_KEY, COLLAPSE_KEY, LEGACY_COLLAPSE_KEY]).then((r) => {
    showOthers = r[SHOW_KEY] === true;
    if (!collapseTouched) {
      // the user may already have clicked before this read finished; never overwrite that
      const rec = r[COLLAPSE_KEY];
      const legacy = r[LEGACY_COLLAPSE_KEY] && r[LEGACY_COLLAPSE_KEY][APP_ID];
      if (rec && Array.isArray(rec.tables)) {
        collapsed = new Set(rec.tables);
      } else if (Array.isArray(legacy)) {
        collapsed = new Set(legacy); // migrate v1.3.3 shared map
        saveCollapsed(collapsed);
      }
    }
    schedule();
  });
})();
