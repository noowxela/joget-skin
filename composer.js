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
 *    an in-memory Set: read from browser.storage.local "jogetSkinComposerCollapsed:<appId>"
 *    ONCE at start, written ONLY on those user clicks, never synced live (no onChanged).
 *    Every pass re-derives the classes from the Set and only touches a class when it differs,
 *    so Joget re-renders can't reopen groups and the observer never feeds itself.
 * 4. Single owner: only one copy may manage the page. If another Joget Skin copy is running
 *    (e.g. an older version installed under another add-on id), this copy stands down and
 *    shows a small notice instead of fighting over the classes (that fight = flapping).
 *    While Joget's search (or a tag filter / usages view) is active, nothing is collapsed,
 *    so every group with matches is visible; the saved state is left untouched.
 *
 * Everything is active only while <html> has class "joget-skin" (set by content.js
 * from the popup's on/off switch). When the skin is off, the button is removed,
 * the original item order is restored and all layout CSS stops matching.
 */
(function () {
  "use strict";

  // App Composer only. Joget can switch to a builder page without a full reload
  // (pushState), so run() re-checks this on every pass and cleans up when we leave.
  const COMPOSER_RE = /\/web\/console\/app\/[^/]+\/[^/]+\/builders\/?$/;
  const onComposer = () => COMPOSER_RE.test(location.pathname);
  // v1.3.9: also injected on builder pages (manifest "builder*"), because Joget can go
  // builder -> App Composer without a reload; then this copy adds the button on arrival.
  // On a builder page run() only calls leaveComposer(), so nothing shows there.
  if (window !== window.top || window.__jskinComposerLoaded) {
    return; // top frame, one instance per extension
  }
  window.__jskinComposerLoaded = true;

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
  const OWNER_ATTR = "data-jskin-composer-owner";   // on <html>: which copy manages the page
  const TOKEN = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const COLLAPSE_CLASSES = ["jskin-collapsed", COLLAPSED_ITEM];

  let collapsed = new Set(); // tables collapsed in this app (source of truth)
  let collapseTouched = false; // user clicked before the initial storage read finished
  const mine = new WeakSet(); // nodes this copy created
  let stoodDown = false;
  let churn = []; // timestamps of passes that changed collapse classes (loop breaker)

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
    const pressed = showOthers ? "true" : "false";
    if (btn.getAttribute("aria-label") !== label) {
      btn.setAttribute("aria-label", label);
    }
    if (btn.getAttribute("aria-pressed") !== pressed) {
      btn.setAttribute("aria-pressed", pressed);
    }
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
    mine.add(group);
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
      if (stoodDown) {
        return;
      }
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
    mine.add(h);
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
      if (stoodDown) {
        return;
      }
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
    // the only place collapse state is written; called from user clicks only
    browser.storage.local.set({ [COLLAPSE_KEY]: { tables: Array.from(collapsed) } }).catch(() => {});
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
      if (!stoodDown) {
        onClick();
      }
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
    mine.add(wrap);
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
  /* ---------- single owner / stand down ---------- */
  function otherCopyRunning() {
    const owner = ROOT.getAttribute(OWNER_ATTR);
    if (owner && owner !== TOKEN) {
      return true;
    }
    const g = document.getElementById(BTN_GROUP_ID);
    if (g && !mine.has(g)) {
      return true;
    }
    for (const el of document.querySelectorAll("." + HEADER_CLASS + ", ." + TITLE_BTNS_CLASS)) {
      if (!mine.has(el)) {
        return true;
      }
    }
    return false;
  }

  function standDown(reason) {
    if (stoodDown) {
      return;
    }
    stoodDown = true;
    observer.disconnect();
    rootObserver.disconnect();
    const owner = ROOT.getAttribute(OWNER_ATTR);
    if (owner && owner !== TOKEN) {
      // a newer copy owns the page: touch nothing, it manages the list
      console.warn("[Joget Skin] another copy of the extension owns App Composer; this copy stays idle:", reason);
      showConflictNotice();
      return;
    }
    // we were managing it and an older copy (no owner mark) is fighting us:
    // hand the list back in a neutral state (nothing hidden by us)
    document.querySelectorAll("." + COLLAPSE_CLASSES.join(", .")).forEach((el) => {
      el.classList.remove(...COLLAPSE_CLASSES);
    });
    // drop our own buttons so the other copy can (re)create working ones
    document.querySelectorAll("#" + BTN_GROUP_ID + ", ." + TITLE_BTNS_CLASS).forEach((el) => {
      if (mine.has(el)) {
        el.remove();
      }
    });
    if (ROOT.getAttribute(OWNER_ATTR) === TOKEN) {
      ROOT.removeAttribute(OWNER_ATTR);
    }
    console.warn("[Joget Skin] another copy of the extension is managing App Composer; this copy stands down:", reason);
    showConflictNotice();
  }

  function showConflictNotice() {
    if (!document.body || document.getElementById("jskin-conflict-notice")) {
      return;
    }
    const n = document.createElement("div");
    n.id = "jskin-conflict-notice";
    n.setAttribute("role", "status");
    n.textContent =
      "Joget Skin：检测到浏览器里同时装了两个 Joget Skin（可能有旧版本），为免互相打架已停用其中一个。" +
      "请到 about:addons 和 about:debugging 删掉旧的那个，然后刷新页面。";
    const x = document.createElement("button");
    x.type = "button";
    x.textContent = "×";
    x.setAttribute("aria-label", "关闭");
    x.addEventListener("click", () => n.remove());
    n.append(x);
    n.style.cssText =
      "position:fixed;left:12px;bottom:12px;z-index:100000;max-width:460px;padding:8px 32px 8px 12px;" +
      "background:#fff3cd;color:#664d03;border:1px solid #ffe69c;border-radius:4px;font-size:12px;line-height:1.5;" +
      "box-shadow:0 2px 8px rgba(0,0,0,.15)";
    x.style.cssText =
      "position:absolute;right:6px;top:4px;border:0;background:none;color:inherit;font-size:16px;cursor:pointer";
    document.body.append(n);
  }

  function run() {
    scheduled = false;
    if (stoodDown) {
      return;
    }
    if (otherCopyRunning()) {
      standDown("found nodes or owner mark from another copy");
      return;
    }
    busy = true;
    try {
      if (!onComposer()) {
        leaveComposer();
        return;
      }
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
        if (changed) {
          // loop breaker: collapse classes should change only after a click or a Joget re-render,
          // never continuously; if they keep changing, something else is fighting us
          const now = Date.now();
          churn = churn.filter((t) => now - t < 3000);
          churn.push(now);
          if (churn.length > 30) {
            standDown("collapse classes keep changing (loop)");
          }
        }
      }
    } finally {
      // Drop the records of our own mutations synchronously. (The old setTimeout(0)
      // window also swallowed Joget mutations that landed in it, e.g. a re-render.)
      observer.takeRecords();
      busy = false;
    }
  }

  // Left App Composer without a reload: drop our button, title buttons and <html> classes
  // so nothing of the composer layout shows on the builder page. (Called inside run()'s try.)
  function leaveComposer() {
    [ACTIVE_CLASS, HIDE_CLASS].forEach((c) => {
      if (ROOT.classList.contains(c)) {
        ROOT.classList.remove(c); // only when set: a no-op remove still fires rootObserver
      }
    });
    document.querySelectorAll("#" + BTN_GROUP_ID + ", ." + TITLE_BTNS_CLASS).forEach((el) => {
      if (mine.has(el)) {
        el.remove();
      }
    });
  }

  function schedule() {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(run);
    }
  }

  /* ---------- observers ---------- */
  // Joget re-renders #builders (switching views, search, add/delete items).
  // Our own mutations are dropped via takeRecords() at the end of run(), so any change to
  // one of our "jskin-*" classes (collapsed, collapsed-item, group-empty, ...) seen here was
  // made by someone else = another copy of this extension (any version). Joget's own classes
  // (search_hide, usage_hide, delete-highlight, ...) are not "jskin-*" and are ignored.
  function jskinTokens(str) {
    return (str || "")
      .split(/\s+/)
      .filter((c) => c.startsWith("jskin-"))
      .sort()
      .join(" ");
  }
  function foreignJskinChange(r) {
    if (r.type !== "attributes" || r.attributeName !== "class" || !r.target.classList) {
      return false;
    }
    if (r.target === ROOT) {
      return false; // <html> classes belong to content.js / the show-others button
    }
    return jskinTokens(r.oldValue) !== jskinTokens(r.target.getAttribute("class"));
  }

  const observer = new MutationObserver((records) => {
    if (busy || stoodDown) {
      return;
    }
    if (records.some(foreignJskinChange)) {
      standDown("another script toggled the collapse classes");
      return;
    }
    schedule();
  });
  observer.observe(document.body || ROOT, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ["style", "class"],
  });

  // Skin on/off switch (content.js toggles the class on <html>).
  const rootObserver = new MutationObserver(schedule);
  rootObserver.observe(ROOT, { attributes: true, attributeFilter: ["class"] });

  // claim the page (another copy that got here first => we stand down on the first pass)
  if (!ROOT.hasAttribute(OWNER_ATTR)) {
    ROOT.setAttribute(OWNER_ATTR, TOKEN);
  }

  // URL changes without a reload (Joget pushState / back-forward)
  window.addEventListener("popstate", schedule);
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      schedule();
    }
  }, 500);

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
        collapsed = new Set(legacy); // v1.3.3 shared map; saved under the new key on next click
      }
    }
    schedule();
  });
})();
