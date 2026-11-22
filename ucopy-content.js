/**
 * Joget Skin — userview / UI copy (export / import), content-script side (v1.4.4).
 * Page: Userview Builder /jw/web/console/app/{appId}/{ver}/userview/builder/{id} (top frame only).
 * Loaded on every builder page (manifest "builder*") because Joget can switch builders
 * without a reload; the buttons exist only while the path is the userview builder.
 *
 * - Toolbar group after the hotkeys button: "⬇ 导出此 UI" and "⬆ 导入 UI" (native Joget
 *   btn-group / btn btn-light markup, like pcopy / hotkeys.js).
 * - Joget objects are touched only by ucopy-page.js, injected once as <script src> (it is in
 *   web_accessible_resources). Talk: window.postMessage with JSON strings + fixed "source"
 *   marker, accepted only from this window and this origin.
 * - Export downloads <appId>_<ver>_<userviewId>.userview.json.
 * - Import: pick a file -> page checks it (no writes) -> dialog lists the new id, missing
 *   missing deps as a checklist, dangling UI refs, and fields to re-enter
 *   -> "导入" creates a NEW userview in the current app and writes its definition.
 *   The open userview is never overwritten. The new UI is persisted immediately (Joget's
 *   userview Save cannot create a new id); discard it in App Composer if you do not want it.
 * - Active only while <html> has class "joget-skin".
 */
(function () {
  "use strict";

  if (window !== window.top || window.__jskinUcopyLoaded) {
    return;
  }
  window.__jskinUcopyLoaded = true;

  const ROOT = document.documentElement;
  const SKIN_CLASS = "joget-skin";
  const GROUP_ID = "jskin-ucopy-group";
  const EXPORT_ID = "jskin-ucopy-export";
  const IMPORT_ID = "jskin-ucopy-import";
  const DIALOG_ID = "jskin-ucopy-dialog";
  const HOTKEYS_GROUP_ID = "jskin-hotkeys-group";
  const OTHERS_GROUP_ID = "jskin-others-group";
  const IN = "jskin-ucopy-content";
  const OUT = "jskin-ucopy-page";
  const PAGE_RE = /\/web\/console\/app\/[^/]+\/[^/]+\/userview\/builder(?:\/|$)/;

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
    s.src = browser.runtime.getURL("ucopy-page.js");
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
        resolve({ ok: false, timeout: true, error: "页面脚本没有回应（ucopy-page.js 没加载？）" });
      }, timeout);
      pending.set(id, (m) => {
        clearTimeout(t);
        resolve(m);
      });
      post(id, cmd, extra);
    });
  }
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
      return { ok: false, error: "页面脚本没有回应（ucopy-page.js 没加载？）" };
    }
    const timeout = cmd === "apply" ? 180000 : cmd === "export" ? 90000 : 45000;
    return request(cmd, extra, timeout);
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
    const s = el("div", "jskin-ucopy-section" + (cls ? " " + cls : ""));
    s.append(el("div", "jskin-ucopy-h", title + "（" + items.length + "）"));
    const ul = el("ul");
    items.forEach((it) => ul.append(el("li", "", typeof it === "string" ? it : JSON.stringify(it))));
    s.append(ul);
    body.append(s);
  }
  function openDialog(title, fill, buttons) {
    closeDialog();
    const wrap = el("div");
    wrap.id = DIALOG_ID;
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    const box = el("div", "jskin-ucopy-box");
    const head = el("div", "jskin-ucopy-title", title);
    const body = el("div", "jskin-ucopy-body");
    fill(body);
    const foot = el("div", "jskin-ucopy-foot");
    (buttons || []).forEach(([label, cls, fn]) => {
      const b = el("button", "btn " + cls, label);
      b.type = "button";
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        fn(b);
      });
      foot.append(b);
    });
    box.append(head, body, foot);
    wrap.append(box);
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) {
        closeDialog();
      }
    });
    document.body.append(wrap);
    document.addEventListener("keydown", onKey, true);
  }
  function showError(title, msg) {
    openDialog(title, (body) => body.append(el("p", "jskin-ucopy-error", msg)), [["关闭", "btn-secondary", closeDialog]]);
  }
  function itemId(it) {
    return typeof it === "string" ? it : (it && (it.id || it.locale) || "");
  }
  function itemLabel(it) {
    if (typeof it === "string") {
      return it;
    }
    if (!it) {
      return "";
    }
    const id = it.id || it.locale || "";
    const note = it.note ? " — " + it.note : "";
    const path = it.path ? "  (" + it.path + ")" : "";
    return id + path + note;
  }
  function checkSection(body, title, items, depName) {
    if (!items || !items.length) {
      return;
    }
    const s = el("div", "jskin-ucopy-section warn");
    s.append(el("div", "jskin-ucopy-h", title + "（" + items.length + "）"));
    const ul = el("ul", "jskin-ucopy-checks");
    items.forEach((it) => {
      const id = itemId(it);
      const canCreate = typeof it === "object" ? it.canCreate !== false : true;
      const lab = el("label", "jskin-ucopy-check");
      const cb = el("input");
      cb.type = "checkbox";
      cb.dataset.dep = depName;
      cb.dataset.id = id;
      cb.checked = canCreate;
      cb.disabled = !canCreate;
      lab.append(cb, document.createTextNode(" " + itemLabel(it) + (canCreate ? "" : "（无法自动创建）")));
      const li = el("li");
      li.append(lab);
      ul.append(li);
    });
    s.append(ul);
    body.append(s);
  }
  function formatDangling(items) {
    return (items || []).map((it) => {
      if (typeof it === "string") {
        return it;
      }
      return (it.id || "") + (it.path ? "  ← " + it.path : "") + (it.className ? "  [" + it.className.split(".").pop() + "]" : "");
    });
  }
  function fillPlan(body, p) {
    const src = p.source || {};
    const info = el("dl", "jskin-ucopy-info");
    const row = (k, v) => {
      info.append(el("dt", "", k), el("dd", "", v));
    };
    if (src.appId) {
      row("来源 app", src.appId + (src.appVersion ? "  v" + src.appVersion : "") + (src.userviewId ? "  / " + src.userviewId : ""));
    }
    if (src.exportedAt) {
      row("导出时间", new Date(src.exportedAt).toLocaleString());
    }
    row("当前打开的 UI", (p.currentId || "") + (p.currentName ? "  「" + p.currentName + "」" : "") + "（不会改写）");
    row("导入为新 UI", p.newId + "  「" + p.newName + "」" + (p.renamed ? "（id 已存在，按 Joget 复制表单/列表的规则加了后缀）" : ""));
    body.append(info);
    checkSection(body, "本地缺少的表单", p.missingForms, "forms");
    checkSection(body, "本地缺少的列表（Datalist）", p.missingDatalists, "datalists");
    checkSection(body, "本地缺少的 Theme Builder", p.missingThemes, "themes");
    checkSection(body, "本地缺少的 App Resource", p.missingResources, "appResources");
    checkSection(body, "本地缺少的环境变量", p.missingEnv, "envVariables");
    checkSection(body, "本地缺少的 i18n 文案", (p.missingMessages || []).map((m) => ({
      id: m.locale || m.id,
      note: (m.keys && m.keys.length ? m.keys.length + " 条" : m.note) || "",
      canCreate: m.canCreate !== false,
    })), "messages");
    checkSection(body, "本地缺少的其他 UI（Userview）", p.missingUserviews, "userviews");
    section(body, "来源里也没有的 UI 引用（不会创建）", formatDangling(p.danglingUserviews), "warn");
    section(body, "本地缺少的流程（只报告，不自动复制；请用流程复制）", p.missingProcesses, "warn");
    section(body, "本地缺少的活动（Run Process 等）", (p.missingActivities || []).map((a) => (a.processId || "") + " / " + (a.activityId || "")), "warn");
    section(body, "本机没有的插件", p.missingPlugins, "warn");
    const sb = p.serverBound || {};
    const bound = [];
    (sb.groups || []).forEach((x) => bound.push("用户组 " + x));
    (sb.orgs || []).forEach((x) => bound.push("组织 " + x));
    (sb.departments || []).forEach((x) => bound.push("部门 " + x));
    (sb.roles || []).forEach((x) => bound.push("角色 " + x));
    (p.permissionPlugins || []).forEach((x) => bound.push("权限插件 " + x));
    section(body, "服务器侧权限对象（只报告，不会创建）", bound, "warn");
    section(body, "已存在、将跳过（不会覆盖）", [].concat(
      (p.existingForms || []).map((x) => "表单 " + x),
      (p.existingDatalists || []).map((x) => "列表 " + x),
      (p.existingThemes || []).map((x) => "Theme " + x),
      (p.existingResources || []).map((x) => "资源 " + x),
      (p.existingEnv || []).map((x) => "环境变量 " + x),
      (p.existingUserviews || []).map((x) => "UI " + x),
      (p.existingMessages || []).map((m) => "i18n " + itemLabel(m)),
    ));
    if (p.catalogNotes && p.catalogNotes.length) {
      section(body, "无法完成的检查", p.catalogNotes, "warn");
    }
    if (p.includeSensitive) {
      section(body, "此文件包含明文敏感字段，导入会写入这些值", p.sensitive, "warn");
    } else {
      section(body, "导出时清空的敏感字段，导入后请重新填写", p.sensitive, "warn");
    }
    if (src.unsavedChanges) {
      body.append(el("p", "jskin-ucopy-note", "导出时远端设计器可能有未保存的修改，包里是当时内存里的内容。"));
    }
    body.append(el("p", "jskin-ucopy-note",
      "勾选的缺失项会在当前应用中创建（已存在的不会覆盖）。导入还会创建一个新的 UI（Userview），并把定义写入服务器（不会改写当前打开的 UI）。Joget 的 UI 保存接口不能新建 id，所以这里无法做到「只改设计器、等你按 Save」。若不想保留，请到 App Composer 删除这个新 UI。"));
  }
  function collectSelected(root) {
    const selected = { forms: [], datalists: [], envVariables: [], themes: [], appResources: [], userviews: [], messages: [] };
    root.querySelectorAll("input[type='checkbox'][data-dep]").forEach((cb) => {
      if (!cb.checked || cb.disabled) {
        return;
      }
      const k = cb.dataset.dep;
      if (selected[k]) {
        selected[k].push(cb.dataset.id);
      }
    });
    return selected;
  }

  /* ---------- actions ---------- */
  async function doExport(btn) {
    if (busy) {
      return;
    }
    openDialog("导出此 UI", (body) => {
      const lab = el("label", "jskin-ucopy-check");
      const cb = el("input");
      cb.type = "checkbox";
      cb.id = "jskin-ucopy-include-sensitive";
      cb.checked = false;
      lab.append(cb, document.createTextNode(" 包含敏感字段"));
      body.append(lab);
      body.append(el("p", "jskin-ucopy-note warn", "勾选后，导出的 JSON 会包含密码、密钥等明文。请妥善保管这个文件，不要发给不可信的人。"));
    }, [
      ["取消", "btn-secondary", closeDialog],
      ["导出", "btn-primary", async (b) => {
        if (busy) {
          return;
        }
        busy = true;
        b.disabled = true;
        if (btn) {
          btn.disabled = true;
        }
        try {
          const cbInc = document.getElementById("jskin-ucopy-include-sensitive");
          const includeSensitive = !!(cbInc && cbInc.checked);
          const r = await ask("export", { includeSensitive });
          if (!r.ok) {
            showError("导出此 UI", r.error || "导出失败");
            return;
          }
          const blob = new Blob([JSON.stringify(r.bundle, null, 2)], { type: "application/json" });
          const a = el("a");
          a.href = URL.createObjectURL(blob);
          a.download = r.fileName;
          document.body.append(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 2000);
          closeDialog();
          const n = (r.bundle.sensitive || []).length;
          const kept = !!(r.bundle.includeSensitive);
          toast("已导出 " + r.fileName + (kept ? "（已包含敏感字段明文）" : (n ? "（" + n + " 个敏感字段已清空）" : "")));
        } finally {
          b.disabled = false;
          if (btn) {
            btn.disabled = false;
          }
          busy = false;
        }
      }],
    ]);
  }
  function toast(msg) {
    document.querySelectorAll(".jskin-ucopy-toast").forEach((x) => x.remove());
    const t = el("div", "jskin-ucopy-toast", msg);
    document.body.append(t);
    setTimeout(() => t.remove(), 4000);
  }
  function pickFile() {
    return new Promise((resolve) => {
      const input = el("input");
      input.type = "file";
      input.accept = "application/json,.json";
      input.id = "jskin-ucopy-file";
      input.addEventListener("change", () => {
        const f = input.files && input.files[0];
        input.remove();
        resolve(f || null);
      }, { once: true });
      input.addEventListener("cancel", () => {
        input.remove();
        resolve(null);
      }, { once: true });
      document.body.append(input);
      input.click();
    });
  }
  async function doImport(btn) {
    if (busy) {
      return;
    }
    const file = await pickFile();
    if (!file) {
      return;
    }
    let text;
    try {
      text = await file.text();
      const r = await ask("check", { text });
      if (!r.ok) {
        showError("导入 UI", r.error);
        return;
      }
      openDialog("导入 UI：" + file.name, (body) => fillPlan(body, r.plan), [
        ["取消", "btn-secondary", closeDialog],
        ["导入", "btn-primary", async (b) => {
          b.disabled = true;
          const selected = collectSelected(document.getElementById(DIALOG_ID) || document);
          const a = await ask("apply", { text, selected });
          if (!a.ok) {
            showError("导入 UI", a.error);
            return;
          }
          closeDialog();
          toast("已导入为 " + a.plan.newId + "，定义已写入服务器");
        }],
      ]);
    } catch (e) {
      showError("导入 UI", "读取文件失败：" + e.message);
    }
  }

  function placeGroup(group, after) {
    const menu = document.getElementById("jskin-tool-menu");
    if (menu) {
      if (group.parentElement !== menu) {
        menu.append(group);
      }
      if (typeof window.__jskinToolMenuAdopt === "function") {
        window.__jskinToolMenuAdopt();
      }
      return;
    }
    if (after && group.previousElementSibling !== after) {
      after.after(group);
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
    const after = document.getElementById(HOTKEYS_GROUP_ID) || document.getElementById(OTHERS_GROUP_ID) || anchor;
    if (existing) {
      placeGroup(existing, after);
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
      mk(EXPORT_ID, "⬇ 导出此 UI", "把当前打开的 UI（Userview）下载成 JSON（含依赖；默认清空敏感字段）", doExport),
      mk(IMPORT_ID, "⬆ 导入 UI", "从 JSON 文件导入为当前 app 里的一个新 UI（Userview）（会写入服务器，不改写当前打开的 UI）", doImport),
    );
    placeGroup(group, after);
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
