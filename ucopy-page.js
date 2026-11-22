/**
 * Joget Skin — userview / UI copy, page-script side (v1.4.4).
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
  const I18N_RE = /#i18n\.([^#]+)#/g;
  const RESOURCE_RE = /#appResource\.([^#]+)#/g;
  // DashboardMenu.userviewId is a plugin setting (e.g. "dashboard"), not a link to another UI.
  const IGNORE_USERVIEW_ID_CLASSES = {
    "org.joget.plugin.enterprise.DashboardMenu": true
  };
  const PERMISSION_ID_KEYS = {
    groupId: "groups",
    orgId: "orgs",
    organizationId: "orgs",
    departmentId: "departments",
    deptId: "departments",
    roleId: "roles",
    role: "roles"
  };
  const THEME_CLASS_PREFIX = "org.joget.plugin.enterprise.BuilderTheme.";

  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const clone = (v) => JSON.parse(JSON.stringify(v));

  function shapeError() {
    const CB = window.CustomBuilder;
    if (!CB || CB.builderType !== "userview" || !isObj(CB.data) || !isObj(CB.data.properties)) {
      return "当前页不是 UI（Userview）Builder，或还没加载完。请打开一个 UI 后再试。";
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

  function themeIdFromClass(className) {
    const s = String(className || "");
    if (s.indexOf(THEME_CLASS_PREFIX) === 0) {
      const id = s.slice(THEME_CLASS_PREFIX.length);
      if (id && id !== "BuilderTheme") {
        return id;
      }
    }
    return "";
  }

  function collectRequires(uv) {
    const forms = new Set();
    const datalists = new Set();
    const processes = new Set();
    const userviews = new Set();
    const userviewRefs = [];
    const plugins = new Set();
    const envVariables = new Set();
    const i18nKeys = new Set();
    const appResources = new Set();
    const themes = new Set();
    const permissionPlugins = new Set();
    const serverBound = { groups: new Set(), orgs: new Set(), departments: new Set(), roles: new Set() };
    const activities = [];
    const selfId = (uv && uv.properties && uv.properties.id) || "";

    function scanString(val, key, path, ownerClass) {
      if (key === "formDefId" || key === "formId") {
        forms.add(val);
      } else if (key === "listId" || key === "datalistId" || key === "datalistDefId") {
        datalists.add(val);
      } else if (key === "processId" || key === "processDefId") {
        processes.add(stripProcessVersion(val));
      } else if (key === "userviewId" || key === "userviewDefId") {
        const isSelfSetting = path === "userview.setting.properties.userviewId";
        const ignoredClass = !!(ownerClass && IGNORE_USERVIEW_ID_CLASSES[ownerClass]);
        if (!isSelfSetting && !ignoredClass && val !== selfId) {
          userviews.add(val);
          userviewRefs.push({ id: val, path: path, className: ownerClass || "" });
        }
      }
      if (ownerClass && /[Pp]ermission/.test(ownerClass) && PERMISSION_ID_KEYS[key]) {
        serverBound[PERMISSION_ID_KEYS[key]].add(val);
      }
      let m;
      const envRe = /#envVariable\.([^#]+)#/g;
      while ((m = envRe.exec(val))) {
        envVariables.add(m[1]);
      }
      const i18nRe = /#i18n\.([^#]+)#/g;
      while ((m = i18nRe.exec(val))) {
        i18nKeys.add(m[1]);
      }
      const resRe = /#appResource\.([^#]+)#/g;
      while ((m = resRe.exec(val))) {
        appResources.add(m[1]);
      }
    }

    function walkReq(node, path, ownerClass) {
      if (Array.isArray(node)) {
        node.forEach((v, i) => walkReq(v, path + "[" + i + "]", ownerClass));
        return;
      }
      if (!isObj(node)) {
        return;
      }
      const cls = typeof node.className === "string" && node.className ? node.className : ownerClass;
      if (cls) {
        plugins.add(cls);
        const tid = themeIdFromClass(cls);
        if (tid) {
          themes.add(tid);
        }
        if (/[Pp]ermission/.test(cls) && !isBuiltInClass(cls)) {
          permissionPlugins.add(cls);
        }
      }
      Object.keys(node).forEach((k) => {
        const val = node[k];
        const p = path + "." + k;
        if (typeof val === "string" && val) {
          scanString(val, k, p, cls);
        } else if (val && typeof val === "object") {
          walkReq(val, p, cls);
        }
      });
    }
    walkReq(uv, "userview", "");

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

    const uniqRefs = [];
    const seenRef = new Set();
    userviewRefs.forEach((r) => {
      const k = r.id + "\t" + r.path;
      if (!seenRef.has(k)) {
        seenRef.add(k);
        uniqRefs.push(r);
      }
    });

    return {
      forms: [...forms].sort(),
      datalists: [...datalists].sort(),
      processes: [...processes].sort(),
      activities: uniqAct,
      userviews: [...userviews].sort(),
      userviewRefs: uniqRefs,
      plugins: [...plugins].sort(),
      envVariables: [...envVariables].sort(),
      i18nKeys: [...i18nKeys].sort(),
      appResources: [...appResources].sort(),
      themes: [...themes].sort(),
      permissionPlugins: [...permissionPlugins].sort(),
      serverBound: {
        groups: [...serverBound.groups].sort(),
        orgs: [...serverBound.orgs].sort(),
        departments: [...serverBound.departments].sort(),
        roles: [...serverBound.roles].sort(),
      },
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
      notes.push("无法读取本机 UI（Userview）列表。");
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


  function listSensitivePaths(obj) {
    const paths = [];
    walk(obj, "userview", (o, key, p) => {
      const val = o[key];
      if (typeof val === "string" && val !== "" && !HASH_ONLY.test(val) && SENSITIVE.some((re) => re.test(key))) {
        paths.push(p);
      }
    });
    return paths;
  }

  function blankObjectSensitive(obj, prefix) {
    const paths = [];
    walk(obj, prefix || "item", (o, key, p) => {
      const val = o[key];
      if (typeof val === "string" && val !== "" && !HASH_ONLY.test(val) && SENSITIVE.some((re) => re.test(key))) {
        o[key] = "";
        paths.push(p);
      }
    });
    return paths;
  }

  function bytesToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let s = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(s);
  }

  function base64ToBlob(b64, type) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return new Blob([bytes], { type: type || "application/octet-stream" });
  }

  function unwrapDef(data) {
    if (!data) {
      return null;
    }
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch (e) {
        return null;
      }
    }
    if (isObj(data) && isObj(data.data) && (data.data.properties || data.data.className || data.data.elements)) {
      return data.data;
    }
    if (isObj(data) && (data.properties || data.className || data.elements || data.columns)) {
      return data;
    }
    return isObj(data) ? data : null;
  }

  async function firstOkJson(urls) {
    const errors = [];
    for (const url of urls) {
      const r = await tryFetch(url);
      if (r.ok) {
        const def = unwrapDef(r.data);
        if (def) {
          return { ok: true, data: def, raw: r.data };
        }
        return { ok: true, data: r.data, raw: r.data };
      }
      errors.push(r.error || url);
    }
    return { ok: false, error: errors[0] || "not found" };
  }

  function optionIds(data) {
    return optionIdsAndNames(data).ids;
  }

  async function fetchSourceUserviewIds() {
    const r = await tryFetch(jsonBase() + "/userview/options");
    if (!r.ok) {
      return { ok: false, ids: new Set() };
    }
    return { ok: true, ids: optionIds(r.data) };
  }

  function classifyUserviewRefs(requires, sourceUvIds) {
    const selfId = (requires && requires.selfId) || "";
    const dangling = [];
    const copyable = [];
    const seenD = new Set();
    const seenC = new Set();
    (requires.userviewRefs || []).forEach((r) => {
      if (!r || !r.id || r.id === selfId) {
        return;
      }
      if (sourceUvIds && sourceUvIds.has(r.id)) {
        if (!seenC.has(r.id)) {
          seenC.add(r.id);
          copyable.push(r);
        }
      } else {
        const k = r.id + "\t" + (r.path || "");
        if (!seenD.has(k)) {
          seenD.add(k);
          dangling.push(r);
        }
      }
    });
    return { dangling, copyable };
  }

  async function fetchFormJson(id) {
    const base = jsonBase();
    return firstOkJson([
      base + "/form/" + encodeURIComponent(id) + "/json",
      base + "/form/builder/json/" + encodeURIComponent(id),
    ]);
  }

  async function fetchDatalistJson(id) {
    const base = jsonBase();
    return firstOkJson([
      base + "/datalist/" + encodeURIComponent(id) + "/json",
      base + "/datalist/builder/json/" + encodeURIComponent(id),
    ]);
  }

  async function fetchUserviewJson(id) {
    const base = jsonBase();
    return firstOkJson([
      base + "/userview/" + encodeURIComponent(id) + "/json",
    ]);
  }

  async function fetchThemeJson(id) {
    const base = jsonBase();
    const CB = window.CustomBuilder;
    return firstOkJson([
      base + "/cbuilder/theme/" + encodeURIComponent(id) + "/json",
      CB.contextPath + "/web/json/app/" + encodeURIComponent(CB.appId) + "/" + encodeURIComponent(CB.appVersion)
        + "/plugin/org.joget.plugin.enterprise.ThemeBuilder/service?_action=loadThemeProperties&_id=" + encodeURIComponent(id),
    ]);
  }

  async function fetchEnvVars(ids, includeSensitive) {
    const base = jsonBase();
    let list = await tryFetch(base + "/envVariable/list?rows=10000");
    if (!list.ok) {
      list = await tryFetch(base + "/envVariable/options");
    }
    const rows = list.ok ? ((list.data && (list.data.data || list.data.options || list.data.list)) || (Array.isArray(list.data) ? list.data : [])) : [];
    const byId = {};
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      if (!row) {
        return;
      }
      const id = typeof row === "string" ? row : (row.id || row.value);
      if (id) {
        byId[String(id)] = isObj(row) ? row : { id: String(id) };
      }
    });
    const failed = [];
    const out = [];
    (ids || []).forEach((id) => {
      const row = byId[id];
      if (!row) {
        failed.push({ id, error: "来源应用里找不到这个环境变量" });
        return;
      }
      const value = row.value == null ? "" : String(row.value);
      out.push({
        id,
        remarks: row.remarks || row.label || "",
        value: includeSensitive ? value : "",
        blanked: !includeSensitive && !!value,
      });
    });
    return { items: out, failed };
  }

  function messageRow(row) {
    if (!row) {
      return null;
    }
    const key = row.messageKey || row.key || row.id;
    if (!key) {
      return null;
    }
    return {
      id: row.id || "",
      key: String(key),
      value: row.message != null ? String(row.message) : (row.value != null ? String(row.value) : ""),
      locale: row.locale || "",
    };
  }

  async function fetchMessages(keys) {
    const want = new Set(keys || []);
    if (!want.size) {
      return { items: [], locales: [], failed: [] };
    }
    const base = jsonBase();
    const localesTry = ["en_US", "zh_CN", "zh_TW", "en", "zh", "ja", "ja_JP"];
    const byLocale = {};
    async function pull(locale) {
      const qs = "rows=10000" + (locale ? "&locale=" + encodeURIComponent(locale) : "");
      const r = await tryFetch(base + "/message/list?" + qs);
      if (!r.ok) {
        return;
      }
      const rows = (r.data && (r.data.data || r.data.list)) || (Array.isArray(r.data) ? r.data : []);
      (Array.isArray(rows) ? rows : []).forEach((row) => {
        const m = messageRow(row);
        if (!m || !want.has(m.key)) {
          return;
        }
        const loc = m.locale || locale || "";
        if (!loc) {
          return;
        }
        m.locale = loc;
        if (!byLocale[loc]) {
          byLocale[loc] = [];
        }
        if (!byLocale[loc].some((x) => x.key === m.key)) {
          byLocale[loc].push(m);
        }
      });
    }
    await pull("");
    for (const loc of localesTry) {
      if (!byLocale[loc]) {
        await pull(loc);
      }
    }
    const items = [];
    Object.keys(byLocale).sort().forEach((loc) => {
      byLocale[loc].sort((a, b) => a.key.localeCompare(b.key)).forEach((m) => items.push(m));
    });
    return { items, locales: Object.keys(byLocale).sort(), failed: [] };
  }

  async function fetchResourceFile(id) {
    const CB = window.CustomBuilder;
    const ctx = CB.contextPath;
    const app = encodeURIComponent(CB.appId);
    const ver = encodeURIComponent(CB.appVersion);
    const enc = encodeURIComponent(id);
    const urls = [
      ctx + "/web/app/" + app + "/resources/" + enc,
      ctx + "/web/app/" + app + "/" + ver + "/resources/" + enc,
      ctx + "/web/console/app/" + app + "/" + ver + "/resource/" + enc,
    ];
    for (const url of urls) {
      try {
        const r = await fetch(url, { credentials: "same-origin", headers: csrfHeaders() });
        if (!r.ok) {
          continue;
        }
        const buf = await r.arrayBuffer();
        if (!buf || !buf.byteLength) {
          continue;
        }
        const type = r.headers.get("content-type") || "application/octet-stream";
        return { ok: true, item: { id, fileName: id, contentType: type, base64: bytesToBase64(buf) } };
      } catch (e) {
        // try next
      }
    }
    return { ok: false, error: "无法下载 app resource：" + id };
  }

  function scanExtraRefs(obj, requires) {
    if (!obj) {
      return;
    }
    const walkObj = (node) => {
      if (Array.isArray(node)) {
        node.forEach(walkObj);
        return;
      }
      if (!isObj(node)) {
        if (typeof node === "string") {
          let m;
          const r1 = /#appResource\.([^#]+)#/g;
          while ((m = r1.exec(node))) {
            requires.appResources = requires.appResources || [];
            if (requires.appResources.indexOf(m[1]) < 0) {
              requires.appResources.push(m[1]);
            }
          }
        }
        return;
      }
      Object.keys(node).forEach((k) => walkObj(node[k]));
    };
    walkObj(obj);
    if (requires.appResources) {
      requires.appResources.sort();
    }
  }

  async function bundleDependencies(requires, includeSensitive) {
    const failed = { forms: [], datalists: [], userviews: [], themes: [], envVariables: [], appResources: [], messages: [] };
    const forms = [];
    for (const id of requires.forms || []) {
      const r = await fetchFormJson(id);
      if (r.ok && r.data) {
        const json = clone(r.data);
        if (!includeSensitive) {
          blankObjectSensitive(json, "form." + id);
        }
        forms.push({ id, json });
        scanExtraRefs(json, requires);
      } else {
        failed.forms.push({ id, error: r.error || "无法读取表单 JSON" });
      }
    }
    const datalists = [];
    for (const id of requires.datalists || []) {
      const r = await fetchDatalistJson(id);
      if (r.ok && r.data) {
        const json = clone(r.data);
        if (!includeSensitive) {
          blankObjectSensitive(json, "datalist." + id);
        }
        datalists.push({ id, json });
        scanExtraRefs(json, requires);
      } else {
        failed.datalists.push({ id, error: r.error || "无法读取列表 JSON" });
      }
    }
    const userviews = [];
    for (const id of requires.userviews || []) {
      const r = await fetchUserviewJson(id);
      if (r.ok && r.data) {
        const json = clone(r.data);
        if (!includeSensitive) {
          blankObjectSensitive(json, "userview." + id);
        }
        userviews.push({ id, json, name: (json.properties && json.properties.name) || id });
      } else {
        failed.userviews.push({ id, error: r.error || "无法读取 UI JSON" });
      }
    }
    const themes = [];
    for (const id of requires.themes || []) {
      const r = await fetchThemeJson(id);
      if (r.ok && r.data) {
        const json = clone(r.data);
        if (!includeSensitive) {
          blankObjectSensitive(json, "theme." + id);
        }
        const name = (json.properties && (json.properties.name || json.properties.themeName)) || id;
        themes.push({ id, name, json });
        scanExtraRefs(json, requires);
      } else {
        failed.themes.push({ id, error: r.error || "无法读取 Theme Builder JSON" });
      }
    }
    const env = await fetchEnvVars(requires.envVariables || [], includeSensitive);
    failed.envVariables = env.failed;
    const messages = await fetchMessages(requires.i18nKeys || []);
    failed.messages = messages.failed;
    const appResources = [];
    for (const id of requires.appResources || []) {
      const r = await fetchResourceFile(id);
      if (r.ok) {
        appResources.push(r.item);
      } else {
        failed.appResources.push({ id, error: r.error });
      }
    }
    return {
      forms,
      datalists,
      userviews,
      themes,
      envVariables: env.items,
      messages: messages.items,
      messageLocales: messages.locales,
      appResources,
      failed,
    };
  }

  async function catalogThemes() {
    const r = await tryFetch(jsonBase() + "/cbuilder/theme/options");
    return r.ok ? optionIds(r.data) : null;
  }

  async function catalogResources() {
    let r = await tryFetch(jsonBase() + "/resource/list?rows=10000");
    if (!r.ok) {
      r = await tryFetch(jsonBase() + "/resource/options");
    }
    return r.ok ? optionIds(r.data) : null;
  }

  async function catalogMessageKeys() {
    const base = jsonBase();
    const map = {};
    async function pull(locale) {
      const qs = "rows=10000" + (locale ? "&locale=" + encodeURIComponent(locale) : "");
      const r = await tryFetch(base + "/message/list?" + qs);
      if (!r.ok) {
        return;
      }
      const rows = (r.data && (r.data.data || r.data.list)) || (Array.isArray(r.data) ? r.data : []);
      (Array.isArray(rows) ? rows : []).forEach((row) => {
        const m = messageRow(row);
        if (!m) {
          return;
        }
        const loc = m.locale || locale || "";
        if (!loc) {
          return;
        }
        if (!map[loc]) {
          map[loc] = new Set();
        }
        map[loc].add(m.key);
      });
    }
    await pull("");
    for (const loc of ["en_US", "zh_CN", "zh_TW", "en", "zh"]) {
      if (!map[loc]) {
        await pull(loc);
      }
    }
    return map;
  }

  function bundledIds(arr) {
    return new Set((arr || []).map((x) => (typeof x === "string" ? x : x.id)).filter(Boolean));
  }

  function markedItems(ids, bundled, failedList) {
    const failed = {};
    (failedList || []).forEach((f) => {
      if (f && f.id) {
        failed[f.id] = f.error || "未能打包";
      }
    });
    return (ids || []).map((id) => ({
      id,
      canCreate: bundled.has(id),
      note: bundled.has(id) ? "" : (failed[id] || "导出时未能打包，无法自动创建"),
    }));
  }

  async function doExport(opts) {
    const err = shapeError();
    if (err) {
      return { ok: false, error: err };
    }
    const includeSensitive = !!(opts && opts.includeSensitive);
    const CB = window.CustomBuilder;
    const uv = currentJson();
    const sensitive = includeSensitive ? listSensitivePaths(uv) : blankSensitive(uv);
    const requires = collectRequires(uv);
    const sourceUv = await fetchSourceUserviewIds();
    if (sourceUv.ok) {
      const classified = classifyUserviewRefs(requires, sourceUv.ids);
      requires.userviews = classified.copyable.map((r) => r.id);
      requires.danglingUserviews = classified.dangling;
      requires.sourceUserviewIds = [...sourceUv.ids].sort();
    } else {
      // Could not read the source UI list: keep scanned refs, do not mark them dangling.
      requires.danglingUserviews = [];
      requires.sourceUserviewIds = [];
    }
    const dependencies = await bundleDependencies(requires, includeSensitive);
    const bundle = {
      kind: KIND,
      v: VERSION,
      includeSensitive,
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
      dependencies,
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
      return { error: "不是 UI（Userview）导出文件（需要 kind: joget-userview-bundle）。" };
    }
    if (b.v !== 1) {
      return { error: "不支持的导出文件版本（v=" + b.v + "）。" };
    }
    if (!isObj(b.userview) || !isObj(b.userview.properties)) {
      return { error: "导出文件里没有可用的 UI（Userview）JSON。" };
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
      return { ok: false, error: "UI（Userview）id 不合法（只允许字母、数字、下划线）。" };
    }
    const newId = incrementId(sourceId, catalog.userviews);
    const sourceName = (uv.properties && uv.properties.name) || sourceId;
    const newName = newId === sourceId ? sourceName : uniqueCopyName(sourceName, catalog.userviewNames);
    const scanned = collectRequires(uv);
    const req = b.requires || scanned;
    const deps = b.dependencies || {};
    const sourceUvIds = new Set(req.sourceUserviewIds || []);
    const classified = classifyUserviewRefs(scanned, sourceUvIds.size ? sourceUvIds : null);
    // If the bundle recorded the source UI list, refs absent there are dangling (do not treat as missing-in-target).
    // If the bundle is older and has no source list, fall back to "missing in target" for unknown ids.
    let danglingUserviews = Array.isArray(req.danglingUserviews) && req.danglingUserviews.length
      ? req.danglingUserviews
      : (sourceUvIds.size ? classified.dangling : []);
    if (sourceUvIds.size) {
      danglingUserviews = classified.dangling;
    }
    const copyableUvIds = sourceUvIds.size
      ? classified.copyable.map((r) => r.id)
      : (req.userviews || scanned.userviews || []);
    const missingForms = missingFrom(scanned.forms, catalog.forms);
    const existingForms = (scanned.forms || []).filter((id) => catalog.forms && catalog.forms.has(id));
    const missingDatalists = missingFrom(scanned.datalists, catalog.datalists);
    const existingDatalists = (scanned.datalists || []).filter((id) => catalog.datalists && catalog.datalists.has(id));
    const missingProcesses = missingFrom(scanned.processes, catalog.processes && catalog.processes.size ? new Set([...catalog.processes, ...catalog.processNames]) : catalog.processes);
    const missingActivities = (scanned.activities || []).filter((a) => activityMissing(a, catalog));
    const missingUserviews = missingFrom(copyableUvIds, catalog.userviews);
    const existingUserviews = copyableUvIds.filter((id) => catalog.userviews && catalog.userviews.has(id));
    const missingPlugins = catalog.plugins ? (scanned.plugins || []).filter((c) => pluginMissing(c, catalog.plugins)) : [];
    const missingEnv = missingFrom(scanned.envVariables, catalog.envVariables);
    const existingEnv = (scanned.envVariables || []).filter((id) => catalog.envVariables && catalog.envVariables.has(id));
    const themeIds = await catalogThemes();
    const missingThemes = missingFrom(scanned.themes, themeIds);
    const existingThemes = (scanned.themes || []).filter((id) => themeIds && themeIds.has(id));
    const resourceIds = await catalogResources();
    const missingResources = missingFrom(scanned.appResources, resourceIds);
    const existingResources = (scanned.appResources || []).filter((id) => resourceIds && resourceIds.has(id));
    const msgKeys = await catalogMessageKeys();
    const bundledMsgs = deps.messages || [];
    const missingMessages = [];
    const existingMessages = [];
    const locales = [...new Set(bundledMsgs.map((m) => m.locale).filter(Boolean))].sort();
    locales.forEach((loc) => {
      const have = msgKeys[loc] || new Set();
      const keys = bundledMsgs.filter((m) => m.locale === loc).map((m) => m.key);
      const miss = keys.filter((k) => !have.has(k));
      const exist = keys.filter((k) => have.has(k));
      if (miss.length) {
        missingMessages.push({ id: loc, locale: loc, keys: miss, canCreate: true, note: miss.length + " 条" });
      }
      if (exist.length) {
        existingMessages.push({ id: loc, locale: loc, keys: exist, note: exist.length + " 条已存在，将跳过" });
      }
    });
    const failed = deps.failed || {};
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
        includeSensitive: !!b.includeSensitive,
        missingForms: markedItems(missingForms, bundledIds(deps.forms), failed.forms),
        existingForms,
        missingDatalists: markedItems(missingDatalists, bundledIds(deps.datalists), failed.datalists),
        existingDatalists,
        missingProcesses,
        missingActivities,
        missingUserviews: markedItems(missingUserviews, bundledIds(deps.userviews), failed.userviews),
        existingUserviews,
        danglingUserviews,
        missingPlugins,
        missingEnv: markedItems(missingEnv, bundledIds(deps.envVariables), failed.envVariables),
        existingEnv,
        missingThemes: markedItems(missingThemes, bundledIds(deps.themes), failed.themes),
        existingThemes,
        missingResources: markedItems(missingResources, bundledIds(deps.appResources), failed.appResources),
        existingResources,
        missingMessages,
        existingMessages,
        serverBound: scanned.serverBound || req.serverBound || {},
        permissionPlugins: scanned.permissionPlugins || req.permissionPlugins || [],
        processesDeferred: true,
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
      return { ok: false, error: "创建 UI（Userview）被拒绝（403，可能是 CSRF 或权限）。" };
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
      return { ok: false, error: "UI（Userview）id 已存在：" + id };
    }
    if (/form-errors/.test(r.text) && /userview\/create|userviewCreate/.test(r.url || "")) {
      return { ok: false, error: "创建 UI（Userview）被拒绝（id 可能不合法或校验失败）。" };
    }
    if (!r.ok && r.status !== 302) {
      return { ok: false, error: "创建 UI（Userview）失败（HTTP " + r.status + "）。" };
    }
    return { ok: false, error: "创建 UI（Userview）后列表里找不到 " + id + "（HTTP " + r.status + "）。" };
  }

  async function saveUserview(id, jsonObj) {
    const url = consoleUrl("/userview/builderSave/" + encodeURIComponent(id));
    const json = JSON.stringify(jsonObj).replace(/\//g, "\\/");
    const fd = new FormData();
    fd.append("jsonFile", new Blob([json], { type: "text/plain" }), "jsonFile");
    const r = await postMultipart(url, fd);
    if (r.status === 404) {
      return { ok: false, error: "builderSave 返回 404：新 UI（Userview）可能还没创建成功。" };
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
        return { ok: false, error: "保存 UI（Userview）定义失败（HTTP " + r.status + "）。" };
      }
    }
    if (!r.ok) {
      return { ok: false, error: "保存 UI（Userview）定义失败（HTTP " + r.status + "）。" };
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


  async function idsNow(kind) {
    const base = jsonBase();
    const urls = {
      form: base + "/forms/options",
      datalist: base + "/datalist/options",
      userview: base + "/userview/options",
      env: [base + "/envVariable/options", base + "/envVariable/list?rows=10000"],
      theme: base + "/cbuilder/theme/options",
      resource: [base + "/resource/list?rows=10000", base + "/resource/options"],
    };
    const u = urls[kind];
    const list = Array.isArray(u) ? u : [u];
    for (const url of list) {
      const r = await tryFetch(url);
      if (r.ok) {
        return optionIds(r.data);
      }
    }
    return new Set();
  }

  function saveJsonFile(jsonObj) {
    const json = JSON.stringify(jsonObj).replace(/\//g, "\\/");
    const fd = new FormData();
    fd.append("jsonFile", new Blob([json], { type: "text/plain" }), "jsonFile");
    return fd;
  }

  async function createForm(id, def) {
    const json = def.json || def;
    const props = (json && json.properties) || {};
    const name = props.name || id;
    const tableName = props.tableName || props.table || id;
    const description = props.description || "";
    if (!/^[0-9a-zA-Z_]+$/.test(String(tableName)) || String(tableName).length > 20) {
      return { ok: false, error: "表单 " + id + " 的 tableName 不合法，无法创建。" };
    }
    const url = consoleUrl("/form/submit?builderMode=true");
    const r = await postForm(url, { id, name, tableName, description, builderMode: "true" });
    if (r.status === 403) {
      return { ok: false, error: "创建表单被拒绝（403）。" };
    }
    const ids = await idsNow("form");
    if (!ids.has(id)) {
      return { ok: false, error: "创建表单后列表里找不到 " + id + "（HTTP " + r.status + "）。" };
    }
    const saved = await postMultipart(consoleUrl("/form/builderSave/" + encodeURIComponent(id)), saveJsonFile(json));
    if (!saved.ok && saved.status !== 200) {
      return { ok: false, error: "保存表单 " + id + " 失败（HTTP " + saved.status + "）。" };
    }
    return { ok: true };
  }

  async function createDatalist(id, def) {
    const json = def.json || def;
    const props = (json && json.properties) || {};
    const name = props.name || id;
    const description = props.description || "";
    const url = consoleUrl("/datalist/submit/create?builderMode=true");
    const r = await postForm(url, { id, name, description, builderMode: "true" });
    const ids = await idsNow("datalist");
    if (!ids.has(id)) {
      return { ok: false, error: "创建列表后找不到 " + id + "（HTTP " + r.status + "）。" };
    }
    const saved = await postMultipart(consoleUrl("/datalist/builderSave/" + encodeURIComponent(id)), saveJsonFile(json));
    if (!saved.ok && saved.status !== 200) {
      return { ok: false, error: "保存列表 " + id + " 失败（HTTP " + saved.status + "）。" };
    }
    return { ok: true };
  }

  async function createEnv(item) {
    const r = await postForm(consoleUrl("/envVariable/submit/create"), {
      id: item.id,
      remarks: item.remarks || "",
      value: item.value == null ? "" : String(item.value),
    });
    const ids = await idsNow("env");
    if (!ids.has(item.id)) {
      return { ok: false, error: "创建环境变量后找不到 " + item.id + "（HTTP " + r.status + "）。" };
    }
    return { ok: true };
  }

  async function createMessagesForLocale(locale, rows) {
    if (!rows || !rows.length) {
      return { ok: true };
    }
    const data = JSON.stringify(rows.map((m) => ({ id: m.id || "", key: m.key, value: m.value })));
    const r = await postForm(consoleUrl("/message/submit"), { locale, data });
    if (!r.ok && r.status !== 302 && r.status !== 200) {
      return { ok: false, error: "写入 i18n（" + locale + "）失败（HTTP " + r.status + "）。" };
    }
    return { ok: true };
  }

  async function createResource(item) {
    if (!item || !item.base64) {
      return { ok: false, error: "缺少文件内容：" + (item && item.id) };
    }
    const blob = base64ToBlob(item.base64, item.contentType);
    const fileName = item.fileName || item.id;
    const fd = new FormData();
    fd.append("file", blob, fileName);
    const r = await postMultipart(consoleUrl("/resource/submit"), fd);
    const ids = await idsNow("resource");
    if (!ids.has(item.id) && !ids.has(fileName)) {
      if (!r.ok && r.status !== 302) {
        return { ok: false, error: "上传资源 " + item.id + " 失败（HTTP " + r.status + "）。" };
      }
    }
    return { ok: true };
  }

  async function deleteTheme(id) {
    try {
      await postForm(consoleUrl("/cbuilder/theme/delete"), { ids: id });
    } catch (e) { /* best-effort */ }
  }

  async function createTheme(id, def) {
    const json = def.json || def;
    const name = def.name || (json.properties && (json.properties.name || json.properties.themeName)) || id;
    const description = (json.properties && json.properties.description) || "";
    const prefix = "theme_";
    const shortId = id.indexOf(prefix) === 0 ? id.slice(prefix.length) : id;
    async function submit(createId) {
      return postForm(consoleUrl("/cbuilder/theme/submit?builderMode=true"), {
        id: createId,
        name,
        description,
        builderMode: "true",
      });
    }
    let r = await submit(shortId);
    let ids = await idsNow("theme");
    if (ids.has(prefix + id) && !ids.has(id)) {
      // posted full id while the server also prepended theme_
      await deleteTheme(prefix + id);
      r = await submit(shortId);
      ids = await idsNow("theme");
    }
    if (!ids.has(id) && ids.has(shortId) && shortId !== id) {
      // prefix was visual only; we created the short id by mistake
      await deleteTheme(shortId);
      r = await submit(id);
      ids = await idsNow("theme");
    }
    if (!ids.has(id)) {
      if (!ids.has(id) && shortId !== id) {
        r = await submit(id);
        ids = await idsNow("theme");
      }
    }
    if (!ids.has(id)) {
      return { ok: false, error: "创建 Theme Builder 后找不到 " + id + "（HTTP " + r.status + "）。" };
    }
    const saved = await postMultipart(consoleUrl("/cbuilder/theme/save/" + encodeURIComponent(id)), saveJsonFile(json));
    if (!saved.ok && saved.status !== 200 && saved.status !== 302) {
      return { ok: false, error: "保存 Theme Builder " + id + " 失败（HTTP " + saved.status + "）。" };
    }
    return { ok: true };
  }

  async function createDepUserview(id, def) {
    const json = def.json || def;
    const name = def.name || (json.properties && json.properties.name) || id;
    const description = (json.properties && json.properties.description) || "";
    const created = await createUserview(id, name, description);
    if (!created.ok) {
      return created;
    }
    const saved = await saveUserview(id, json);
    if (!saved.ok) {
      await deleteUserview(id);
      return { ok: false, error: saved.error };
    }
    return { ok: true };
  }

  function defaultSelected(plan) {
    function ids(list) {
      return (list || []).filter((x) => (typeof x === "string") || x.canCreate !== false).map((x) => (typeof x === "string" ? x : x.id));
    }
    return {
      forms: ids(plan.missingForms),
      datalists: ids(plan.missingDatalists),
      envVariables: ids(plan.missingEnv),
      themes: ids(plan.missingThemes),
      appResources: ids(plan.missingResources),
      userviews: ids(plan.missingUserviews),
      messages: ids(plan.missingMessages),
    };
  }

  async function createSelectedDeps(bundle, selected, plan) {
    const notes = [];
    const deps = bundle.dependencies || {};
    const pick = (arr, ids) => {
      const want = new Set(ids || []);
      return (arr || []).filter((x) => want.has(x.id));
    };
    // resources first so theme / userview refs resolve
    for (const item of pick(deps.appResources, selected.appResources)) {
      const r = await createResource(item);
      notes.push(r.ok ? "已上传资源 " + item.id : "资源 " + item.id + "：" + r.error);
    }
    for (const item of pick(deps.themes, selected.themes)) {
      const r = await createTheme(item.id, item);
      notes.push(r.ok ? "已创建 Theme Builder " + item.id : "Theme " + item.id + "：" + r.error);
    }
    for (const item of pick(deps.envVariables, selected.envVariables)) {
      const r = await createEnv(item);
      notes.push(r.ok ? "已创建环境变量 " + item.id : "环境变量 " + item.id + "：" + r.error);
    }
    const wantLocales = new Set(selected.messages || []);
    if (wantLocales.size && deps.messages && deps.messages.length) {
      const existing = await catalogMessageKeys();
      const byLoc = {};
      deps.messages.forEach((m) => {
        if (!wantLocales.has(m.locale)) {
          return;
        }
        const have = existing[m.locale] || new Set();
        if (have.has(m.key)) {
          return;
        }
        if (!byLoc[m.locale]) {
          byLoc[m.locale] = [];
        }
        byLoc[m.locale].push(m);
      });
      for (const loc of Object.keys(byLoc)) {
        const r = await createMessagesForLocale(loc, byLoc[loc]);
        notes.push(r.ok ? "已写入 i18n " + loc + "（" + byLoc[loc].length + " 条）" : "i18n " + loc + "：" + r.error);
      }
    }
    for (const item of pick(deps.forms, selected.forms)) {
      const r = await createForm(item.id, item);
      notes.push(r.ok ? "已创建表单 " + item.id : "表单 " + item.id + "：" + r.error);
    }
    for (const item of pick(deps.datalists, selected.datalists)) {
      const r = await createDatalist(item.id, item);
      notes.push(r.ok ? "已创建列表 " + item.id : "列表 " + item.id + "：" + r.error);
    }
    for (const item of pick(deps.userviews, selected.userviews)) {
      const r = await createDepUserview(item.id, item);
      notes.push(r.ok ? "已创建 UI " + item.id : "UI " + item.id + "：" + r.error);
    }
    plan.createdNotes = notes;
    return notes;
  }

  async function apply(text, selected) {
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
    if (!parsed.bundle.includeSensitive) {
      blankSensitive(newJson);
    }
    const sel = selected && typeof selected === "object" ? selected : defaultSelected(checked.plan);
    await createSelectedDeps(parsed.bundle, sel, checked.plan);
    const created = await createUserview(checked.plan.newId, checked.plan.newName, (newJson.properties && newJson.properties.description) || "");
    if (!created.ok) {
      return { ok: false, error: created.error, plan: checked.plan };
    }
    const saved = await saveUserview(checked.plan.newId, newJson);
    if (!saved.ok) {
      await deleteUserview(checked.plan.newId);
      return { ok: false, error: saved.error + "（已尝试删除刚创建的 UI（Userview））", plan: checked.plan };
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
        reply(m.id, await doExport(m));
        return;
      }
      if (m.cmd === "check") {
        reply(m.id, await plan(m.text));
        return;
      }
      if (m.cmd === "apply") {
        const r = await apply(m.text, m.selected);
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
