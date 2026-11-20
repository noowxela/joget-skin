/**
 * Joget Skin — keyboard shortcut list (content script, top frame only).
 * Pages: every builder (/jw/web/console/app/{appId}/{ver}/{type}/builder/...) and the
 * App Composer (/builders). Adds a keyboard icon button right after "Advanced Tools"
 * (after the "显示其他 Builder" button on the composer) in #builderToolbar.
 * Clicking it opens a small panel listing Joget DX 9.1.2's own builder shortcuts.
 * The list comes from Joget's source (file:line noted next to each group below).
 *
 * - Active only while <html> has class "joget-skin" (popup on/off switch).
 * - Joget re-renders the toolbar on SPA navigation; a MutationObserver puts the button back.
 * - Never listens to keys while the panel is closed. While open, only Esc is handled
 *   (closes the panel and stops Joget from also closing the property editor).
 */
(function () {
  "use strict";

  if (window !== window.top || window.__jskinHotkeysLoaded) {
    return;
  }
  window.__jskinHotkeysLoaded = true;

  const ROOT = document.documentElement;
  const SKIN_CLASS = "joget-skin";
  const GROUP_ID = "jskin-hotkeys-group";
  const BTN_ID = "jskin-hotkeys-btn";
  const PANEL_ID = "jskin-hotkeys-panel";
  const OTHERS_GROUP_ID = "jskin-others-group"; // composer.js
  const PAGE_RE = /\/web\/console\/app\/[^/]+\/[^/]+\/(?:builders\/?$|[^/]+\/builder(?:\/|$))/;

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const MOD = isMac ? "⌘" : "Ctrl";

  // [keys, label, source]
  const GROUPS = [
    {
      title: "所有 Builder（工具栏按钮）",
      note: isMac
        ? "Joget 把 ⌘ 当成 Ctrl（builder/jquery.hotkeys.js:169-170），所以 ⌘ 和 Ctrl 都可以。焦点在画布或输入框里时也有效（builder/builder.js:986-987）。"
        : "焦点在画布或输入框里时也有效（builder/builder.js:986-987）。",
      items: [
        [[MOD, "S"], "保存", "WEB-INF/jsp/cbuilder/base.jsp:110"],
        [[MOD, "Z"], "撤销", "WEB-INF/jsp/cbuilder/base.jsp:175"],
        [isMac ? ["Ctrl", "Shift", "Z"] : ["Ctrl", "Shift", "Z"], isMac ? "重做（Mac 上要按 Control，⌘⇧Z 不会触发）" : "重做", "WEB-INF/jsp/cbuilder/base.jsp:179"],
        [[MOD, "C"], "复制选中的元素（有复制按钮的 Builder）", "WEB-INF/jsp/cbuilder/base.jsp:185"],
        [[MOD, "V"], "粘贴元素", "WEB-INF/jsp/cbuilder/base.jsp:189"],
        [["Esc"], "关闭快捷导航；没开时关闭属性面板", "builder/builder.js:4558-4565"],
      ],
    },
    {
      title: "Joget Skin 扩展加的（可修改）",
      custom: true,
      items: [],
    },
    {
      title: "Process Builder 画布",
      items: [
        [["Shift", "拖动"], "平移画布", "pbuilder/js/pbuilder.js:2066-2068"],
        [["Shift", "滚轮"], "横向滚动", "pbuilder/js/pbuilder.js:2116-2119"],
        [["Ctrl", "滚轮"], "放大 / 缩小", "WEB-INF/classes/pbuilder.properties:216"],
      ],
    },
    {
      title: "App Composer 搜索框",
      items: [
        [["↑", "↓"], "在搜索建议里上下选", "js/abuilder.core.js:222-229"],
        [["Enter"], "套用选中的建议", "js/abuilder.core.js:230-233"],
        [["Backspace"], "输入框为空时移除前一个标签筛选", "js/abuilder.core.js:447, 635"],
      ],
    },
    {
      title: "属性里的代码编辑器（CodeMirror）",
      items: [
        [[MOD, "F"], "查找 / 替换", "js/codemirror6/codemirror6.js:263"],
        [["F3"], "下一个（Shift+F3 上一个）", "js/codemirror6/codemirror6.js:265"],
        [["Esc"], "关闭查找栏", "js/codemirror6/codemirror6.js:264"],
        [["F1"], "帮助", "js/codemirror6/codemirror6.js:277-280"],
        [["F12"], "全屏", "js/codemirror6/codemirror6.js:281-283"],
        [[MOD, "+ / −"], "放大 / 缩小字号", "js/codemirror6/codemirror6.js:284-296"],
        [["Tab"], "缩进（Shift+Tab 取消缩进）", "js/codemirror6/codemirror6.js:261"],
      ],
    },
  ];

  const skinOn = () => ROOT.classList.contains(SKIN_CLASS);
  const onPage = () => PAGE_RE.test(location.pathname);

  let panel = null;

  /* ---------- editable extension hotkey (edgetoggles.js reads the same storage key) ---------- */
  const HK_KEY = "jogetSkinHotkeyLeftPanel";
  const HK_DEFAULT = { ctrl: true, meta: false, alt: false, shift: false, code: "BracketLeft", key: "[" };
  const REC_ATTR = "data-jskin-hk-recording";
  const store = (typeof browser !== "undefined" && browser.storage && browser.storage.local) || null;
  let combo = HK_DEFAULT;
  let recording = false;
  let customRow = null;
  if (store) {
    store.get(HK_KEY).then((r) => {
      if (r && r[HK_KEY] && r[HK_KEY].code) {
        combo = r[HK_KEY];
        renderCustom();
      }
    }).catch(() => {});
    browser.storage.onChanged.addListener((ch, area) => {
      if (area === "local" && ch[HK_KEY]) {
        combo = ch[HK_KEY].newValue && ch[HK_KEY].newValue.code ? ch[HK_KEY].newValue : HK_DEFAULT;
        renderCustom();
      }
    });
  }
  const comboKeys = (c) => [c.ctrl && "Ctrl", c.meta && "⌘", c.alt && (isMac ? "⌥" : "Alt"), c.shift && "Shift", c.key].filter(Boolean);
  const sameCombo = (a, b) => a.code === b.code && !!a.ctrl === !!b.ctrl && !!a.meta === !!b.meta && !!a.alt === !!b.alt && !!a.shift === !!b.shift;

  function keyLabel(e) {
    if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
    if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
    const names = { BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".",
      Slash: "/", Backquote: "`", Minus: "-", Equal: "=", Space: "Space", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };
    return names[e.code] || e.key || e.code;
  }

  function setRecording(on) {
    recording = on;
    if (on) ROOT.setAttribute(REC_ATTR, "1");
    else ROOT.removeAttribute(REC_ATTR);
    renderCustom();
  }

  // returns true if the key event was used for recording
  function recordKey(e) {
    if (!recording) return false;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (e.key === "Escape") {
      setRecording(false);
      return true;
    }
    if (["Control", "Meta", "Alt", "Shift", "CapsLock", "Fn"].includes(e.key)) return true; // wait for the real key
    const fkey = /^F\d{1,2}$/.test(e.code);
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !fkey) {
      renderCustom("要带 Ctrl / ⌘ / Alt（或用 F1-F12），不然打字时会误触。");
      return true;
    }
    const c = { ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, shift: e.shiftKey, code: e.code, key: keyLabel(e) };
    const clash = [[{ ctrl: true, code: "KeyS" }, "保存"], [{ ctrl: true, code: "KeyZ" }, "撤销"], [{ ctrl: true, shift: true, code: "KeyZ" }, "重做"],
      [{ ctrl: true, code: "KeyC" }, "复制"], [{ ctrl: true, code: "KeyV" }, "粘贴"], [{ meta: true, code: "KeyS" }, "保存"],
      [{ meta: true, code: "KeyZ" }, "撤销"], [{ meta: true, code: "KeyC" }, "复制"], [{ meta: true, code: "KeyV" }, "粘贴"]]
      .find(([x]) => sameCombo(x, c));
    if (clash) {
      renderCustom("和 Joget 的「" + clash[1] + "」冲突，换一个。");
      return true;
    }
    combo = c;
    if (store) store.set({ [HK_KEY]: c }).catch(() => {});
    setRecording(false);
    return true;
  }

  function renderCustom(msg) {
    if (!customRow) return;
    customRow.textContent = "";
    const tdk = el("td", "jskin-hk-keys");
    if (recording) {
      tdk.append(el("span", "jskin-hk-rec", "请按新组合键…"));
    } else {
      comboKeys(combo).forEach((k, i) => {
        if (i) tdk.append(document.createTextNode(" + "));
        tdk.append(el("kbd", "", k));
      });
    }
    const tdl = el("td", "jskin-hk-label");
    tdl.append(el("span", "", "收起 / 展开左侧面板和 Quick Nav"));
    const acts = el("span", "jskin-hk-acts");
    const edit = el("button", "jskin-hk-edit", recording ? "取消" : "修改");
    edit.type = "button";
    edit.id = "jskin-hk-edit-leftpanel";
    edit.addEventListener("click", (e) => {
      e.preventDefault();
      setRecording(!recording);
    });
    acts.append(edit);
    if (!recording && !sameCombo(combo, HK_DEFAULT)) {
      const reset = el("button", "jskin-hk-edit", "恢复默认");
      reset.type = "button";
      reset.addEventListener("click", (e) => {
        e.preventDefault();
        combo = HK_DEFAULT;
        if (store) store.set({ [HK_KEY]: HK_DEFAULT }).catch(() => {});
        renderCustom();
      });
      acts.append(reset);
    }
    tdl.append(acts);
    if (msg || recording) {
      tdl.append(el("div", "jskin-hk-note", msg || "按 Esc 取消。要带 Ctrl / ⌘ / Alt，或用 F1-F12。"));
    }
    customRow.append(tdk, tdl);
  }
  let busy = false;
  let scheduled = false;

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

  function buildPanel() {
    const p = el("div");
    p.id = PANEL_ID;
    p.setAttribute("role", "dialog");
    p.setAttribute("aria-label", "快捷键");
    const head = el("div", "jskin-hk-head");
    head.append(el("span", "jskin-hk-title", "快捷键"));
    const close = el("button", "jskin-hk-close", "×");
    close.type = "button";
    close.title = "关闭 (Esc)";
    close.addEventListener("click", closePanel);
    head.append(close);
    p.append(head);
    const body = el("div", "jskin-hk-body");
    for (const g of GROUPS) {
      const sec = el("div", "jskin-hk-group");
      sec.append(el("div", "jskin-hk-gtitle", g.title));
      if (g.note) {
        sec.append(el("div", "jskin-hk-note", g.note));
      }
      const table = el("table", "jskin-hk-table");
      if (g.custom) {
        customRow = el("tr", "jskin-hk-custom");
        table.append(customRow);
        renderCustom();
      }
      for (const [keys, label, src] of g.items) {
        const tr = el("tr");
        const tdk = el("td", "jskin-hk-keys");
        keys.forEach((k, i) => {
          if (i) {
            tdk.append(document.createTextNode(" + "));
          }
          tdk.append(el("kbd", "", k));
        });
        const tdl = el("td", "jskin-hk-label", label);
        tdl.title = "来源：" + src;
        tr.append(tdk, tdl);
        table.append(tr);
      }
      sec.append(table);
      body.append(sec);
    }
    body.append(el("div", "jskin-hk-foot", "来源：Joget DX 9.1.2 源码（鼠标停在说明上可看文件和行号）"));
    p.append(body);
    p.addEventListener("click", (e) => e.stopPropagation());
    return p;
  }

  function positionPanel(btn) {
    const r = btn.getBoundingClientRect();
    const w = panel.offsetWidth || 420;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    panel.style.left = left + "px";
    panel.style.top = r.bottom + 6 + "px";
  }

  function onKey(e) {
    if (recordKey(e)) {
      return;
    }
    if (e.key === "Escape" && panel && panel.isConnected) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      closePanel();
    }
  }
  function onDocClick(e) {
    const btn = document.getElementById(BTN_ID);
    if (panel && !panel.contains(e.target) && !(btn && btn.contains(e.target))) {
      closePanel();
    }
  }

  // clicks inside the canvas iframe (same origin /jw/builder/blank.jsp) never reach our document
  function frameDocs() {
    const out = [];
    for (const f of document.querySelectorAll("#builder_canvas iframe")) {
      try {
        if (f.contentDocument) {
          out.push(f.contentDocument);
        }
      } catch (e) {
        /* cross-origin: ignore */
      }
    }
    return out;
  }
  let frameListened = [];

  function openPanel(btn) {
    if (!panel) {
      panel = buildPanel();
    }
    document.body.append(panel);
    positionPanel(btn);
    btn.classList.add("active");
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDocClick, true);
    window.addEventListener("resize", closePanel);
    window.addEventListener("blur", closePanel); // focus moved into the canvas iframe
    frameListened = frameDocs();
    frameListened.forEach((d) => d.addEventListener("mousedown", closePanel, true));
  }

  function closePanel() {
    if (recording) {
      setRecording(false);
    }
    window.removeEventListener("keydown", onKey, true);
    document.removeEventListener("mousedown", onDocClick, true);
    window.removeEventListener("resize", closePanel);
    window.removeEventListener("blur", closePanel);
    frameListened.forEach((d) => d.removeEventListener("mousedown", closePanel, true));
    frameListened = [];
    if (panel) {
      panel.remove();
    }
    const btn = document.getElementById(BTN_ID);
    if (btn) {
      btn.classList.remove("active");
    }
  }

  function ensureButton() {
    const existing = document.getElementById(GROUP_ID);
    if (!skinOn() || !onPage()) {
      if (existing) {
        existing.remove();
      }
      closePanel();
      return;
    }
    const anchor = document.querySelector("#builderToolbar .advanced-tools-toogle");
    if (!anchor) {
      return;
    }
    // composer.js keeps its own button right after Advanced Tools; we go after it.
    const next = anchor.nextElementSibling;
    const after = next && next.id === OTHERS_GROUP_ID ? next : anchor;
    if (existing) {
      if (existing.previousElementSibling !== after) {
        after.after(existing);
      }
      return;
    }
    const group = el("div", "btn-group toolbar-group me-3");
    group.id = GROUP_ID;
    group.setAttribute("role", "group");
    const btn = el("button", "btn btn-light");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.title = "快捷键";
    btn.setAttribute("aria-label", "快捷键");
    btn.append(el("i", "las la-keyboard"));
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (panel && panel.isConnected) {
        closePanel();
      } else {
        openPanel(btn);
      }
    });
    group.append(btn);
    after.after(group);
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

  const observer = new MutationObserver(() => {
    if (!busy) {
      schedule();
    }
  });
  observer.observe(document.body || ROOT, { childList: true, subtree: true });
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
