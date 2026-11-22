/**
 * Joget Skin — userview / UI copy, page-script side (v1.4.2).
 * Injected once as <script src> into the Userview Builder page (web_accessible_resources).
 * Talks only to ucopy-content.js via window.postMessage (JSON strings, same window + origin).
 *
 * Import semantics: create a NEW userview in the current app (official create + builderSave),
 * then open it with CustomBuilder.ajaxRenderBuilder. Never mutates the open userview.
 * If builderSave fails after create, the new userview is deleted.
 *
 * Sensitive-property regex and HASH_ONLY rule are the same as pcopy-page.js.
 */
(function () {
  "use strict";
  if (window.__jskinUcopyPage) {
    return;
  }
  window.__jskinUcopyPage = true;

  const IN = "jskin-ucopy-content";
  const OUT = "jskin-ucopy-page";
  const KIND = "joget-userview-bundle";
  const VERSION = 1;
  const ID_RE = /^[a-zA-Z0-9_]+$/;
  // same patterns as pcopy-page.js — keep in sync
  const SENSITIVE = [/[Pp]ass(word|wd|phrase)?(?![a-z])/, /[Ss]ecret/, /[Tt]oken(?![a-z])/, /[Aa]pi_?[Kk]ey/,
    /[Pp]rivate_?[Kk]ey/, /[Cc]redential/, /[Aa]uthorization/, /[Uu]sername/, /[Ss]mtpUser/];
  const HASH_ONLY = /^#[^#\s]+#$/; // "#envVariable.x#" is a reference, not a secret: kept
  const ENV_RE = /#envVariable\.([^#]+)#/g;

  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const clone = (v) => JSON.parse(JSON.stringify(v));

  function shapeError() {
    const CB = window.CustomBuilder;
    if (!CB || CB.builderType !== "userview" || !isObj(CB.data) || !isObj(CB.data.properties)) {
      return "当前页不是 Userview Builder，或还没加载完。请打开一个 UI 后再试。";
    }
    if (typeof CB.getJson !== "function") {
      return "找不到 CustomBuilder.getJson，无法读取当前 UI。";
    }
    if (!CB.appId || !CB.appVersion) {
      return "找不到当前 app id / 版本。";
    }
    if (CB.config && CB.config.advanced && CB.config.advanced === false && CB.config.readonly) {
      return "当前 Builder 是只读的，不能导入。";
    }
    return "";
  }

  function currentJson() {
    const CB = window.CustomBuilder;
    try {
      return JSON.parse(CB.getJson());
    } catch (e) {
      return clone(CB.data);
    }
  }

  function walk(o, path, fn) {
    if (Array.isArray(o)) {
      o.forEach((v, i) => walk(v, path + "[" + i + "]", fn));
    } else if (isObj(o)) {
      for (const k of Object.keys(o)) {
        fn(o, k, path + "." + k);
        walk(o[k], path + "." + k, fn);
      }
    }
  }

  function blankSensitive(obj) {
    const paths = [];
    walk(obj, "userview", (o, key, p) => {
      const val = o[key];
      if (typeof val === "string" && val !== "" && !HASH_ONLY.test(val) && SENSITIVE.some((re) => re.test(key))) {
        o[key] = "";
        paths.push(p);
      }
    });
    return paths;
  }

  function stripProcessVersion(id) {
    const s = String(id || "");
    if (s.indexOf("#") >= 0) {
      const parts = s.split("#");
      return parts[parts.length - 1] || s;
    }
    return s;
  }

  function isBuiltInClass(name) {
    if (!name) {
      return true;
    }
    if (name === "menu-component") {
      return true;
    }
    // stock userview themes shipped with Joget (not always listed by getElements?classname=Plugin)
    if (/^org\.joget\.apps\.userview\.lib\.(Default|AjaxUniversal|Universal)?Theme$/.test(name)) {
      return true;
    }
    // structural userview JSON types, not installable plugins
    return /^org\.joget\.apps\.userview\.model\.(Userview|UserviewCategory|UserviewPage|UserviewLayout|UserviewSetting|UserviewPermission)$/.test(name);
  }

  function collectRequires(uv) {

    const forms = new Set();
    const datalists = new Set();
    const processes = new Set();
    const userviews = new Set();
    const plugins = new Set();
    const envVariables = new Set();
    const activities = [];
    const selfId = (uv && uv.properties && uv.properties.id) || "";

    walk(uv, "userview", (o, key) => {
      const val = o[key];
      if (typeof val !== "string" || !val) {
        return;
      }
      if (key === "className") {
        plugins.add(val);
      } else if (key === "formDefId" || key === "formId") {
        forms.add(val);
      } else if (key === "listId" || key === "datalistId" || key === "datalistDefId") {
        datalists.add(val);
      } else if (key === "processId" || key === "processDefId") {
        processes.add(stripProcessVersion(val));
      } else if ((key === "userviewId" || key === "userviewDefId") && val !== selfId) {
        userviews.add(val);
      }
      ENV_RE.lastIndex = 0;
      let m;
      const re = /#envVariable\.([^#]+)#/g;
      while ((m = re.exec(val))) {
        envVariables.add(m[1]);
      }
    });

    function walkPair(o) {
      if (Array.isArray(o)) {
        o.forEach(walkPair);
      } else if (isObj(o)) {
        const pid = o.processId || o.processDefId;
        const aid = o.activityId || o.activityDefId;
        if (pid && aid) {
          activities.push({ processId: stripProcessVersion(String(pid)), activityId: String(aid) });
        }
        Object.keys(o).forEach((k) => walkPair(o[k]));
      }
    }
    walkPair(uv);

    const uniqAct = [];
    const seen = new Set();
    activities.forEach((a) => {
      const k = a.processId + "::" + a.activityId;
      if (!seen.has(k)) {
        seen.add(k);
        uniqAct.push(a);
      }
    });

    return {
      forms: [...forms].sort(),
      datalists: [...datalists].sort(),
      processes: [...processes].sort(),
      activities: uniqAct,
      userviews: [...userviews].sort(),
      plugins: [...plugins].sort(),
      envVariables: [...envVariables].sort(),
    };
  }

  function incrementId(sourceId, existing) {
    const set = existing instanceof Set ? existing : new Set(existing);
    if (!set.has(sourceId)) {
      return sourceId;
    }
    const prefix = sourceId + "_";
    let max = 1;
    for (const id of set) {
      if (id !== sourceId && id.indexOf(prefix) === 0) {
        const rest = id.slice(prefix.length);
        if (/^\d+$/.test(rest)) {
          max = Math.max(max, Number(rest));
        }
      }
    }
    let next = max + 1;
    let candidate = sourceId + "_" + next;
    while (set.has(candidate)) {
      next += 1;
      candidate = sourceId + "_" + next;
    }
    return candidate;
  }

  function uniqueCopyName(base, existing) {
    const names = existing instanceof Set ? existing : new Set(existing);
    let name = base + " (Copy)";
    if (!names.has(name)) {
      return name;
    }
    let n = 2;
    while (names.has(base + " (Copy " + n + ")")) {
      n += 1;
    }
    return base + " (Copy " + n + ")";
  }

  function sanitizeId(id) {
    const s = String(id || "").replace(/[^a-zA-Z0-9_]/g, "_");
    return s || "userview";
  }

  function retarget(uv, newId, newName) {
    const out = clone(uv);
    const oldId = (out.properties && out.properties.id) || "";
    if (!out.properties) {
      out.properties = {};
    }
    out.properties.id = newId;
    out.properties.name = newName;
    if (!out.setting) {
      out.setting = {};
    }
    if (!out.setting.properties) {
      out.setting.properties = {};
    }
    if (!out.setting.properties.userviewId || out.setting.properties.userviewId === oldId) {
      out.setting.properties.userviewId = newId;
    }
    out.setting.properties.userviewName = newName;
    walk(out, "userview", (o, key) => {
      if ((key === "userviewId" || key === "userviewDefId") && o[key] === oldId) {
        o[key] = newId;
      }
    });
    return out;
  }

  function csrfPair() {
    const sources = [];
    if (window.ConnectionManager) {
      sources.push(window.ConnectionManager);
    }
    if (window.JPopup) {
      sources.push(window.JPopup);
    }
    try {
      document.querySelectorAll("iframe").forEach((f) => {
        try {
          if (f.contentWindow && f.contentWindow.ConnectionManager) {
            sources.push(f.contentWindow.ConnectionManager);
          }
          if (f.contentWindow && f.contentWindow.JPopup) {
            sources.push(f.contentWindow.JPopup);
          }
        } catch (e) { /* cross-origin */ }
      });
    } catch (e) { /* ignore */ }
    for (const s of sources) {
      if (s && s.tokenName && s.tokenValue) {
        return { name: s.tokenName, value: s.tokenValue };
      }
    }
    const inp = document.querySelector("input[name='OWASP-CSRFTOKEN'], input[name='OWASP_CSRFTOKEN'], input[name='_csrf']");
    if (inp && inp.value) {
      return { name: inp.name, value: inp.value };
    }
    return null;
  }
  async function ensureCsrf() {
    let p = csrfPair();
    if (p) {
      return p;
    }
    const base = (window.UI && UI.base) || (window.CustomBuilder && CustomBuilder.contextPath) || "";
    try {
      const r = await fetch(base + "/csrf", {
        method: "POST",
        credentials: "same-origin",
        headers: { "FETCH-CSRF-TOKEN-PARAM": "true", "FETCH-CSRF-TOKEN": "true" },
      });
      const text = await r.text();
      const i = text.indexOf(":");
      if (i > 0) {
        return { name: text.slice(0, i).trim(), value: text.slice(i + 1).trim() };
      }
    } catch (e) { /* ignore */ }
    return null;
  }
  function csrfHeaders(pair) {
    const h = {};
    const p = pair || csrfPair();
    if (p && p.name && p.value) {
      h[p.name] = p.value;
    }
    return h;
  }

  async function fetchJson(url) {
    const r = await fetch(url, { credentials: "same-origin", headers: csrfHeaders() });
    if (!r.ok) {
      throw new Error(url + " HTTP " + r.status);
    }
    const t = await r.text();
    try {
      return JSON.parse(t);
    } catch (e) {
      throw new Error(url + " 不是 JSON");
    }
  }

  function optionIdsAndNames(data) {
    const ids = new Set();
    const names = new Set();
    const arr = Array.isArray(data) ? data : (data && (data.data || data.options || data.list)) || [];
    for (const x of arr) {
      if (x == null) {
        continue;
      }
      if (typeof x === "string") {
        if (x) {
          ids.add(x);
        }
        continue;
      }
      const id = x.value || x.id || x.formId || x.listId || x.userviewId;
      if (id) {
        ids.add(String(id));
      }
      const name = x.label || x.name;
      if (name) {
        names.add(String(name));
      }
    }
    return { ids, names };
  }

  function jsonBase() {
    const CB = window.CustomBuilder;
    return CB.contextPath + "/web/json/console/app/" + encodeURIComponent(CB.appId) + "/" + encodeURIComponent(CB.appVersion);
  }

  async function tryFetch(url) {
    try {
      return { ok: true, data: await fetchJson(url) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async function localCatalog() {
    const CB = window.CustomBuilder;
    const base = jsonBase();
    const notes = [];
    const forms = await tryFetch(base + "/forms/options");
    const datalists = await tryFetch(base + "/datalist/options");
    const userviews = await tryFetch(base + "/userview/options");
    let env = await tryFetch(base + "/envVariable/options");
    if (!env.ok) {
      env = await tryFetch(base + "/envVariable/list?rows=1000");
    }
    const plugins = new Set();
    let pluginsOk = false;
    function addPluginValues(arr) {
      const list = Array.isArray(arr) ? arr : (arr && (arr.data || arr.elements || arr.options)) || [];
      list.forEach((p) => {
        const v = typeof p === "string" ? p : (p && (p.value || p.className || p.id));
        if (v) {
          plugins.add(String(v));
        }
      });
    }
    const elementBases = [
      "org.joget.plugin.base.Plugin",
      "org.joget.apps.userview.model.UserviewTheme",
      "org.joget.apps.userview.model.UserviewMenu",
      "org.joget.apps.userview.model.UserviewPermission",
      "org.joget.apps.userview.model.SupportBuilderColorConfig",
    ];
    for (const base of elementBases) {
      try {
        addPluginValues(await fetchJson(CB.contextPath + "/web/property/json/getElements?classname=" + encodeURIComponent(base)));
        pluginsOk = plugins.size > 0;
      } catch (e) {
        if (base === "org.joget.plugin.base.Plugin") {
          notes.push("无法读取本机插件列表，跳过插件检查。");
        }
      }
    }
    if (CB.paletteElements && typeof CB.paletteElements === "object") {
      Object.keys(CB.paletteElements).forEach((cls) => {
        const meta = CB.paletteElements[cls];
        if (cls && !(meta && meta.isMissing)) {
          plugins.add(cls);
          pluginsOk = true;
        }
      });
    }

    const processes = new Set();
    const processActivities = {};
    let processesOk = false;
    const wflist = await tryFetch(CB.contextPath + "/web/json/workflow/process/list?all=true");
    if (wflist.ok) {
      const rows = wflist.data && (wflist.data.data || wflist.data);
      (Array.isArray(rows) ? rows : []).forEach((p) => {
        const appOk = !p.appId || p.appId === CB.appId;
        const id = p.idWithoutVersion || p.processDefId || (p.id && String(p.id).split("#").pop());
        if (appOk && id) {
          processes.add(String(id));
          processesOk = true;
        }
      });
    }
    const act = await tryFetch(base + "/processActivity/options");
    if (act.ok && isObj(act.data)) {
      Object.keys(act.data).forEach((name) => {
        const arr = act.data[name];
        const ids = new Set();
        (Array.isArray(arr) ? arr : []).forEach((x) => {
          if (x && x.value) {
            ids.add(String(x.value));
          }
        });
        processActivities[name] = ids;
        // processActivity options are keyed by process name, not id
      });
    }
    if (!processesOk && !Object.keys(processActivities).length && (wflist.error || act.error)) {
      notes.push("无法读取本机流程列表，跳过流程检查。");
    } else if (processesOk || Object.keys(processActivities).length) {
      processesOk = true;
    }

    if (!forms.ok) {
      notes.push("无法读取本机表单列表，跳过表单检查。");
    }
    if (!datalists.ok) {
      notes.push("无法读取本机列表，跳过 Datalist 检查。");
    }
    if (!userviews.ok) {
      notes.push("无法读取本机 Userview 列表。");
    }
    if (!env.ok) {
      notes.push("无法读取本机环境变量列表，跳过环境变量检查。");
    }

    const uv = userviews.ok ? optionIdsAndNames(userviews.data) : { ids: new Set(), names: new Set() };
    return {
      forms: forms.ok ? optionIdsAndNames(forms.data).ids : null,
      datalists: datalists.ok ? optionIdsAndNames(datalists.data).ids : null,
      userviews: uv.ids,
      userviewNames: uv.names,
      envVariables: env.ok ? optionIdsAndNames(env.data).ids : null,
      plugins: pluginsOk ? plugins : null,
      processes: processesOk ? processes : null,
      processActivities,
      processNames: new Set(Object.keys(processActivities)),
      notes,
    };
  }

  function missingFrom(required, local) {
    if (!local) {
      return [];
    }
    return (required || []).filter((x) => x && !local.has(x));
  }
  function pluginMissing(className, local) {
    if (!local || !className || isBuiltInClass(className)) {
      return false;
    }
    if (local.has(className)) {
      return false;
    }
    for (const p of local) {
      if (p && className.indexOf(p + ".") === 0) {
        return false; // e.g. org.joget.plugin.enterprise.BuilderTheme.theme_crm
      }
    }
    return true;
  }

  function doExport() {
    const err = shapeError();
    if (err) {
      return { ok: false, error: err };
    }
    const CB = window.CustomBuilder;
    const uv = currentJson();
    const sensitive = blankSensitive(uv);
    const requires = collectRequires(uv);
    const bundle = {
      kind: KIND,
      v: VERSION,
      source: {
        origin: location.origin,
        appId: CB.appId || "",
        appVersion: CB.appVersion || "",
        userviewId: (uv.properties && uv.properties.id) || CB.id || "",
        userviewName: (uv.properties && uv.properties.name) || "",
        exportedAt: new Date().toISOString(),
        unsavedChanges: typeof CB.isSaved === "function" ? !CB.isSaved() : false,
      },
      userview: uv,
      requires,
      sensitive,
    };
    const fileName = [CB.appId || "app", CB.appVersion || "", bundle.source.userviewId || "userview"].filter(Boolean).join("_") + ".userview.json";
    return { ok: true, bundle, fileName };
  }

  function parseBundle(text) {
    let b;
    try {
      b = JSON.parse(text);
    } catch (e) {
      return { error: "不是有效的 JSON 文件。" };
    }
    if (!b || b.kind !== KIND) {
      return { error: "不是 UI / Userview 导出文件（需要 kind: joget-userview-bundle）。" };
    }
    if (b.v !== 1) {
      return { error: "不支持的导出文件版本（v=" + b.v + "）。" };
    }
    if (!isObj(b.userview) || !isObj(b.userview.properties)) {
      return { error: "导出文件里没有可用的 userview JSON。" };
    }
    return { bundle: b };
  }

  function activityMissing(act, catalog) {
    if (!catalog.processes && !catalog.processNames.size) {
      return false;
    }
    const pid = act.processId;
    const aid = act.activityId;
    if (catalog.processes && catalog.processes.size && !catalog.processes.has(pid) && !catalog.processNames.has(pid)) {
      return true; // process itself is missing; also listed under missingProcesses
    }
    const byId = catalog.processActivities[pid];
    if (byId && !byId.has(aid)) {
      return true;
    }
    // options are keyed by process name: if any listed process has this activity, accept
    if (!byId) {
      const all = Object.keys(catalog.processActivities);
      if (!all.length) {
        return false;
      }
      const found = all.some((name) => catalog.processActivities[name].has(aid));
      // only flag if we can positively say the activity is absent from every list
      // when the process id is known in processes but we don't have its activity map, skip
      if (catalog.processes && catalog.processes.has(pid) && !found) {
        return false;
      }
    }
    return false;
  }

  async function plan(text) {
    const err = shapeError();
    if (err) {
      return { ok: false, error: err };
    }
    const parsed = parseBundle(text);
    if (parsed.error) {
      return { ok: false, error: parsed.error };
    }
    const b = parsed.bundle;
    const CB = window.CustomBuilder;
    const catalog = await localCatalog();
    const uv = clone(b.userview);
    const sourceId = sanitizeId((uv.properties && uv.properties.id) || (b.source && b.source.userviewId) || "userview");
    if (!ID_RE.test(sourceId)) {
      return { ok: false, error: "Userview id 不合法（只允许字母、数字、下划线）。" };
    }
    const newId = incrementId(sourceId, catalog.userviews);
    const sourceName = (uv.properties && uv.properties.name) || sourceId;
    const newName = newId === sourceId ? sourceName : uniqueCopyName(sourceName, catalog.userviewNames);
    const scanned = collectRequires(uv);
    const missingForms = missingFrom(scanned.forms, catalog.forms);
    const missingDatalists = missingFrom(scanned.datalists, catalog.datalists);
    const missingProcesses = missingFrom(scanned.processes, catalog.processes && catalog.processes.size ? new Set([...catalog.processes, ...catalog.processNames]) : catalog.processes);
    const missingActivities = (scanned.activities || []).filter((a) => activityMissing(a, catalog));
    const missingUserviews = missingFrom(scanned.userviews, catalog.userviews);
    const missingPlugins = catalog.plugins ? (scanned.plugins || []).filter((c) => pluginMissing(c, catalog.plugins)) : [];
    const missingEnv = missingFrom(scanned.envVariables, catalog.envVariables);
    return {
      ok: true,
      plan: {
        source: b.source || {},
        sourceId,
        newId,
        newName,
        renamed: newId !== sourceId,
        currentId: CB.id || (CB.data.properties && CB.data.properties.id) || "",
        currentName: (CB.data.properties && CB.data.properties.name) || "",
        missingForms,
        missingDatalists,
        missingProcesses,
        missingActivities,
        missingUserviews,
        missingPlugins,
        missingEnv,
        sensitive: Array.isArray(b.sensitive) ? b.sensitive : [],
        catalogNotes: catalog.notes,
        persists: true,
      },
    };
  }

  async function postAjax(url, data, isFormData) {
    const pair = await ensureCsrf();
    if (isFormData && pair && !data.has(pair.name)) {
      data.append(pair.name, pair.value);
    }
    if (!isFormData && pair && data && data[pair.name] == null) {
      data[pair.name] = pair.value;
    }
    // Prefer jQuery.ajax: Joget's CSRFGuard script hooks XMLHttpRequest, not window.fetch.
    // ConnectionManager.token* is often only set in the canvas iframe (blank.jsp), not the top window.
    if (window.jQuery && typeof window.jQuery.ajax === "function") {
      return await new Promise((resolve) => {
        const opts = {
          type: "POST",
          url: url,
          data: data,
          dataType: "text",
          traditional: true,
          beforeSend: function (request) {
            if (pair && pair.name) {
              request.setRequestHeader(pair.name, pair.value);
            }
          },
          success: function (text, _s, xhr) {
            resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, url: xhr.responseURL || url, text: text || "" });
          },
          error: function (xhr) {
            resolve({ ok: false, status: xhr && xhr.status, url: url, text: (xhr && xhr.responseText) || "" });
          },
        };
        if (isFormData) {
          opts.processData = false;
          opts.contentType = false;
        }
        window.jQuery.ajax(opts);
      });
    }
    const body = isFormData ? data : new URLSearchParams(data);
    const r = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: isFormData ? csrfHeaders(pair) : Object.assign({ "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }, csrfHeaders(pair)),
      body: body,
      redirect: "follow",
    });
    const text = await r.text();
    return { status: r.status, url: r.url, text, ok: r.ok };
  }

  async function postForm(url, fields) {
    return postAjax(url, fields, false);
  }

  async function postMultipart(url, formData) {
    return postAjax(url, formData, true);
  }

  async function userviewIds() {
    const data = await fetchJson(jsonBase() + "/userview/options");
    return optionIdsAndNames(data).ids;
  }

  function consoleUrl(suffix) {
    const CB = window.CustomBuilder;
    return CB.contextPath + "/web/console/app/" + encodeURIComponent(CB.appId) + "/" + encodeURIComponent(CB.appVersion) + suffix;
  }

  async function createUserview(id, name, description) {
    const url = consoleUrl("/userview/submit/create");
    const r = await postForm(url, { id, name, description: description || "", builderMode: "true" });
    if (r.status === 403) {
      return { ok: false, error: "创建 Userview 被拒绝（403，可能是 CSRF 或权限）。" };
    }
    try {
      const ids = await userviewIds();
      if (ids.has(id)) {
        return { ok: true };
      }
    } catch (e) {
      // fall through to HTTP / body checks
    }
    if (/console\.userview\.error\.label\.exists/.test(r.text)) {
      return { ok: false, error: "Userview id 已存在：" + id };
    }
    if (/form-errors/.test(r.text) && /userview\/create|userviewCreate/.test(r.url || "")) {
      return { ok: false, error: "创建 Userview 被拒绝（id 可能不合法或校验失败）。" };
    }
    if (!r.ok && r.status !== 302) {
      return { ok: false, error: "创建 Userview 失败（HTTP " + r.status + "）。" };
    }
    return { ok: false, error: "创建 Userview 后列表里找不到 " + id + "（HTTP " + r.status + "）。" };
  }

  async function saveUserview(id, jsonObj) {
    const url = consoleUrl("/userview/builderSave/" + encodeURIComponent(id));
    const json = JSON.stringify(jsonObj).replace(/\//g, "\\/");
    const fd = new FormData();
    fd.append("jsonFile", new Blob([json], { type: "text/plain" }), "jsonFile");
    const r = await postMultipart(url, fd);
    if (r.status === 404) {
      return { ok: false, error: "builderSave 返回 404：新 Userview 可能还没创建成功。" };
    }
    try {
      const j = JSON.parse(r.text);
      if (j.success === false) {
        return { ok: false, error: j.error || j.message || "builderSave 失败。" };
      }
      if (j.success === true || j.data) {
        return { ok: true };
      }
    } catch (e) {
      if (!r.ok) {
        return { ok: false, error: "保存 Userview 定义失败（HTTP " + r.status + "）。" };
      }
    }
    if (!r.ok) {
      return { ok: false, error: "保存 Userview 定义失败（HTTP " + r.status + "）。" };
    }
    return { ok: true };
  }

  async function deleteUserview(id) {
    try {
      await postForm(consoleUrl("/userview/delete"), { ids: id });
    } catch (e) {
      // best-effort rollback
    }
  }

  async function apply(text) {
    const checked = await plan(text);
    if (!checked.ok) {
      return checked;
    }
    const parsed = parseBundle(text);
    if (parsed.error) {
      return { ok: false, error: parsed.error, plan: checked.plan };
    }
    const CB = window.CustomBuilder;
    const newJson = retarget(parsed.bundle.userview, checked.plan.newId, checked.plan.newName);
    blankSensitive(newJson);
    const created = await createUserview(checked.plan.newId, checked.plan.newName, (newJson.properties && newJson.properties.description) || "");
    if (!created.ok) {
      return { ok: false, error: created.error, plan: checked.plan };
    }
    const saved = await saveUserview(checked.plan.newId, newJson);
    if (!saved.ok) {
      await deleteUserview(checked.plan.newId);
      return { ok: false, error: saved.error + "（已尝试删除刚创建的 Userview）", plan: checked.plan };
    }
    const navigate = CB.contextPath + "/web/console/app" + CB.appPath + "/userview/builder/" + checked.plan.newId;
    return { ok: true, plan: checked.plan, navigate };
  }

  const reply = (id, obj) => window.postMessage(JSON.stringify(Object.assign({ source: OUT, id }, obj)), location.origin);

  window.addEventListener("message", async (e) => {
    if (e.source !== window || e.origin !== location.origin || typeof e.data !== "string") {
      return;
    }
    let m;
    try {
      m = JSON.parse(e.data);
    } catch (err) {
      return;
    }
    if (!m || m.source !== IN || !m.id) {
      return;
    }
    try {
      if (m.cmd === "ping") {
        reply(m.id, { ok: true });
        return;
      }
      if (m.cmd === "export") {
        reply(m.id, doExport());
        return;
      }
      if (m.cmd === "check") {
        reply(m.id, await plan(m.text));
        return;
      }
      if (m.cmd === "apply") {
        const r = await apply(m.text);
        reply(m.id, r);
        if (r.ok && r.navigate && window.CustomBuilder && typeof CustomBuilder.ajaxRenderBuilder === "function") {
          try {
            CustomBuilder.ajaxRenderBuilder(r.navigate);
          } catch (err) {
            location.href = r.navigate;
          }
        } else if (r.ok && r.navigate) {
          location.href = r.navigate;
        }
        return;
      }
      reply(m.id, { ok: false, error: "未知命令：" + m.cmd });
    } catch (err) {
      reply(m.id, { ok: false, error: String(err && err.message ? err.message : err) });
    }
  });
})();
