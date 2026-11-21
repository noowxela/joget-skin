/**
 * Joget Skin — single-process copy (export / import), content-script side (v1.4.0).
 * Page: Process Builder /jw/web/console/app/{appId}/{ver}/process/builder (top frame only).
 * Loaded on every builder page (manifest "builder*") because Joget can switch builders
 * without a reload; the buttons exist only while the path is the process builder.
 *
 * - Toolbar group after the hotkeys button: "⬇ 导出此流程" and "⬆ 导入流程" (native Joget
 *   btn-group / btn btn-light markup, like composer.js / hotkeys.js).
 * - Joget objects are touched only by pcopy-page.js, injected once as <script src> (it is in
 *   web_accessible_resources). Talk: window.postMessage with JSON strings + fixed "source"
 *   marker, accepted only from this window and this origin.
 * - Export downloads <appId>_<ver>_<processId>.process.json.
 * - Import: pick a file -> page checks it (no writes) -> dialog lists the new id, renames, missing
 *   forms / plugins, fields to re-enter and warnings -> "导入" appends the process. Never saves.
 * - Active only while <html> has class "joget-skin".
 */
(function () {
  "use strict";

  if (window !== window.top || window.__jskinPcopyLoaded) {
    return;
  }
  window.__jskinPcopyLoaded = true;

  const ROOT = document.documentElement;
  const SKIN_CLASS = "joget-skin";
  const GROUP_ID = "jskin-pcopy-group";
  const EXPORT_ID = "jskin-pcopy-export";
  const IMPORT_ID = "jskin-pcopy-import";
  const DIALOG_ID = "jskin-pcopy-dialog";
  const HOTKEYS_GROUP_ID = "jskin-hotkeys-group"; // hotkeys.js
  const OTHERS_GROUP_ID = "jskin-others-group";   // composer.js
  const IN = "jskin-pcopy-content";
  const OUT = "jskin-pcopy-page";
  const PAGE_RE = /\/web\/console\/app\/[^/]+\/[^/]+\/process\/builder(?:\/|$)/;

  const skinOn = () => ROOT.classList.contains(SKIN_CLASS);
  const onPage = () => PAGE_RE.test(location.pathname);
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

  /* ---------- page script + message channel ---------- */
  let injected = false;
  let seq = 0;
  const pending = new Map();
  function injectPage() {
    if (injected) {
      return;
    }
    injected = true;
    const s = document.createElement("script");
    s.src = browser.runtime.getURL("pcopy-page.js");
    s.onload = () => s.remove();
    (document.head || ROOT).append(s);
  }
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.origin !== location.origin || typeof e.data !== "string") {
      return;
    }
    let m;
    try {
      m = JSON.parse(e.data);
    } catch (err) {
      return;
    }
    if (!m || m.source !== OUT || !pending.has(m.id)) {
      return;
    }
    const done = pending.get(m.id);
    pending.delete(m.id);
    done(m);
  });
  const post = (id, cmd, extra) => window.postMessage(JSON.stringify(Object.assign({ source: IN, id, cmd }, extra || {})), location.origin);
  function request(cmd, extra, timeout) {
    const id = "q" + ++seq + "-" + Date.now();
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, timeout: true, error: "页面脚本没有回应（pcopy-page.js 没加载？）" });
      }, timeout);
      pending.set(id, (m) => {
        clearTimeout(t);
        resolve(m);
      });
      post(id, cmd, extra);
    });
  }
  // wait until pcopy-page.js answers a ping (idempotent), so real commands are sent exactly once
  let ready = false;
  async function ensureReady() {
    injectPage();
    for (let i = 0; !ready && i < 25; i++) {
      const r = await request("ping", null, 400);
      ready = !!r.ok;
    }
    return ready;
  }
  async function ask(cmd, extra) {
    if (!(await ensureReady())) {
      return { ok: false, error: "页面脚本没有回应（pcopy-page.js 没加载？）" };
    }
    return request(cmd, extra, 30000);
  }

  /* ---------- dialog ---------- */
  function closeDialog() {
    const d = document.getElementById(DIALOG_ID);
    if (d) {
      d.remove();
    }
    document.removeEventListener("keydown", onKey, true);
  }
  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeDialog();
    }
  }
  function section(body, title, items, cls) {
    if (!items || !items.length) {
      return;
    }
    const s = el("div", "jskin-pcopy-section" + (cls ? " " + cls : ""));
    s.append(el("div", "jskin-pcopy-h", title + "（" + items.length + "）"));
    const ul = el("ul");
    items.forEach((t) => ul.append(el("li", "", t)));
    s.append(ul);
    body.append(s);
  }
  function openDialog(title, fill, buttons) {
    closeDialog();
    const wrap = el("div");
    wrap.id = DIALOG_ID;
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    const box = el("div", "jskin-pcopy-box");
    const head = el("div", "jskin-pcopy-title", title);
    const body = el("div", "jskin-pcopy-body");
    fill(body);
    const foot = el("div", "jskin-pcopy-foot");
    buttons.forEach(([label, cls, fn]) => {
      const b = el("button", "btn " + cls, label);
      b.type = "button";
      b.addEventListener("click", (e) => {
        e.preventDefault();
        fn(b);
      });
      foot.append(b);
    });
    box.append(head, body, foot);
    wrap.append(box);
    wrap.addEventListener("mousedown", (e) => {
      if (e.target === wrap) {
        closeDialog();
      }
    });
    document.body.append(wrap);
    document.addEventListener("keydown", onKey, true);
    const last = foot.lastElementChild;
    if (last) {
      last.focus();
    }
    return wrap;
  }
  function showError(title, msg) {
    openDialog(title, (body) => body.append(el("p", "jskin-pcopy-error", msg)), [["关闭", "btn-secondary", closeDialog]]);
  }

  function fillPlan(body, p) {
    const src = p.source || {};
    const info = el("dl", "jskin-pcopy-info");
    const row = (k, v) => {
      info.append(el("dt", "", k), el("dd", "", v));
    };
    row("来源", [src.origin, src.appId && src.appId + " v" + src.appVersion, src.processId].filter(Boolean).join(" · ") || "（未知）");
    if (src.exportedAt) {
      row("导出时间", new Date(src.exportedAt).toLocaleString());
    }
    row("导入为", p.newId + "  「" + p.newName + "」" + (p.renamed ? "（id 已存在，按 Joget「Clone」的规则加了后缀）" : ""));
    const c = p.counts || {};
    row("内容", c.activities + " 个节点 · " + c.participants + " 个参与者 · 绑定：参与者 " + c.participantMap + " / 表单 " + c.activityForms + " / 插件 " + c.activityPlugins);
    body.append(info);
    section(body, "参与者改名（本地已有同名 id）", (p.renames || []).map((r) => r.from + " → " + r.to));
    if (p.missingForms === null) {
      section(body, "表单", ["无法读取本地表单列表，没检查。"], "warn");
    } else {
      section(body, "本地缺少的表单，请先用表单 JSON 复制过来", p.missingForms, "warn");
    }
    if (p.missingPlugins === null) {
      section(body, "插件", ["无法读取本地插件列表，没检查。"], "warn");
    } else {
      section(body, "本地没装的插件", p.missingPlugins, "warn");
    }
    section(body, "导出时清空的敏感字段，导入后请重新填写", p.sensitive, "warn");
    section(body, "提醒", p.warnings, "warn");
    section(body, "会加到本地的 Application", (p.addApps || []).map((a) => a["-Id"]));
    body.append(el("p", "jskin-pcopy-note", "导入只改设计器里的数据，不会自动保存。检查无误后请自己按 Save；不想要就刷新页面放弃。"));
  }

  /* ---------- actions ---------- */
  async function doExport(btn) {
    btn.disabled = true;
    try {
      const r = await ask("export");
      if (!r.ok) {
        showError("导出此流程", r.error);
        return;
      }
      const blob = new Blob([JSON.stringify(r.bundle, null, 2) + "\n"], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = el("a");
      a.href = url;
      a.download = r.fileName;
      a.style.display = "none";
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      const n = (r.bundle.sensitive || []).length;
      toast("已导出 " + r.fileName + (n ? "（" + n + " 个敏感字段已清空）" : ""));
    } finally {
      btn.disabled = false;
    }
  }
  function toast(msg) {
    document.querySelectorAll(".jskin-pcopy-toast").forEach((x) => x.remove());
    const t = el("div", "jskin-pcopy-toast", msg);
    document.body.append(t);
    setTimeout(() => t.remove(), 4000);
  }
  function pickFile() {
    return new Promise((resolve) => {
      const input = el("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.id = "jskin-pcopy-file";
      input.style.display = "none";
      input.addEventListener("change", () => {
        const f = input.files && input.files[0];
        input.remove();
        resolve(f || null);
      });
      document.body.append(input);
      input.click();
    });
  }
  async function doImport(btn) {
    const file = await pickFile();
    if (!file) {
      return;
    }
    btn.disabled = true;
    let text;
    try {
      text = await file.text();
      const r = await ask("check", { text });
      if (!r.ok) {
        showError("导入流程", r.error);
        return;
      }
      openDialog("导入流程：" + file.name, (body) => fillPlan(body, r.plan), [
        ["取消", "btn-secondary", closeDialog],
        ["导入", "btn-primary", async (b) => {
          b.disabled = true;
          const a = await ask("apply", { text });
          closeDialog();
          if (!a.ok) {
            showError("导入流程", a.error);
            return;
          }
          toast("已导入为 " + a.plan.newId + "，检查后请按 Save 保存");
        }],
      ]);
    } catch (e) {
      showError("导入流程", "读取文件失败：" + e.message);
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- toolbar button ---------- */
  function ensureButton() {
    const existing = document.getElementById(GROUP_ID);
    if (!skinOn() || !onPage()) {
      if (existing) {
        existing.remove();
      }
      closeDialog();
      return;
    }
    const anchor = document.querySelector("#builderToolbar .advanced-tools-toogle");
    if (!anchor) {
      return;
    }
    injectPage();
    // after the hotkeys button (which itself follows Advanced Tools / the show-others button)
    const after = document.getElementById(HOTKEYS_GROUP_ID) || document.getElementById(OTHERS_GROUP_ID) || anchor;
    if (existing) {
      if (existing.previousElementSibling !== after) {
        after.after(existing);
      }
      return;
    }
    const group = el("div", "btn-group toolbar-group me-3");
    group.id = GROUP_ID;
    group.setAttribute("role", "group");
    const mk = (id, text, title, fn) => {
      const b = el("button", "btn btn-light", text);
      b.id = id;
      b.type = "button";
      b.title = title;
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        fn(b);
      });
      return b;
    };
    group.append(
      mk(EXPORT_ID, "⬇ 导出此流程", "把当前打开的流程（含参与者 / 表单 / 插件绑定）下载成 JSON", doExport),
      mk(IMPORT_ID, "⬆ 导入流程", "从 JSON 文件导入一个流程到这个 app（不会自动保存）", doImport),
    );
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
