/**
 * Joget Skin — process copy, PAGE side (v1.4.0).
 * Injected by pcopy-content.js as <script src="moz-extension://.../pcopy-page.js"> (declared in
 * web_accessible_resources), so it runs in the page and can call Joget's own ProcessBuilder /
 * CustomBuilder directly. No wrappedJSObject.
 *
 * Messages (window.postMessage, JSON strings, same window + same origin only):
 *   content -> page  { source: "jskin-pcopy-content", id, cmd: "export" | "check" | "apply", text? }
 *   page -> content  { source: "jskin-pcopy-page", id, ok, error?, ...result }
 *
 * Joget DX 9.1.2 sources this mirrors (pbuilder/js/pbuilder.js unless noted):
 *   cloneProcess 4469-4625 (id suffix "_2", participant re-id, mapping copy, refresh sequence)
 *   getArray 2801 / setArray 2817, updateProcessSelector 2697, getForms 7348 (availableForms)
 *   updateParticipantMapping 3848 (participants mapping shape, type "plugin" -> value = className)
 *   SubFlow implementation 3280; CustomBuilder.update builder/builder.js:1474,
 *   CustomBuilder.Builder.triggerChange builder/builder.js:8873.
 * Never calls updateJsonFromXpdl and never saves; the user reviews and presses Save.
 */
(function () {
  "use strict";
  if (window.__jskinPcopyPage) {
    return;
  }
  window.__jskinPcopyPage = true;

  const IN = "jskin-pcopy-content";
  const OUT = "jskin-pcopy-page";
  const KIND = "joget-process-bundle";
  const VERSION = 1;
  const WHITELIST = "processStartWhiteList";
  const MAPS = ["participantMap", "activityForms", "activityPlugins"];
  const DATA_KEY = { participantMap: "participants", activityForms: "activityForms", activityPlugins: "activityPlugins" };
  // property names whose values are blanked on export (smtp username/password, tokens, keys ...)
  const SENSITIVE = [/[Pp]ass(word|wd|phrase)?(?![a-z])/, /[Ss]ecret/, /[Tt]oken(?![a-z])/, /[Aa]pi_?[Kk]ey/,
    /[Pp]rivate_?[Kk]ey/, /[Cc]redential/, /[Aa]uthori[sz]ation/, /^(smtp_?)?[Uu]ser(name)?$/, /^smtp[A-Z_]?[Uu]ser/];
  const HASH_ONLY = /^#[^#\s]+#$/; // "#envVariable.x#" is a reference, not a secret: kept

  const clone = (o) => JSON.parse(JSON.stringify(o === undefined ? null : o));
  const isObj = (o) => o !== null && typeof o === "object" && !Array.isArray(o);

  /* ---------- shape check: stop instead of writing into an unknown structure ---------- */
  function shapeError() {
    const PB = window.ProcessBuilder, CB = window.CustomBuilder;
    if (!PB || !CB) {
      return "这里不是 Joget 的流程设计器（找不到 ProcessBuilder / CustomBuilder）。";
    }
    for (const f of ["getArray", "setArray", "updateProcessSelector"]) {
      if (typeof PB[f] !== "function") {
        return "ProcessBuilder." + f + " 不存在，Joget 版本可能变了（只在 DX 9.1.2 上测过）。";
      }
    }
    if (typeof CB.update !== "function" || !CB.Builder || typeof CB.Builder.triggerChange !== "function") {
      return "CustomBuilder.update / Builder.triggerChange 不存在，Joget 版本可能变了。";
    }
    const d = CB.data;
    if (!isObj(d) || !isObj(d.xpdl) || !isObj(d.xpdl.Package)) {
      return "CustomBuilder.data.xpdl.Package 不存在，数据结构对不上，已停止。";
    }
    for (const k of ["participants", "activityForms", "activityPlugins"]) {
      if (d[k] !== undefined && d[k] !== null && !isObj(d[k])) {
        return "CustomBuilder.data." + k + " 不是对象，数据结构对不上，已停止。";
      }
    }
    if (PB.readonly) {
      return "流程设计器是只读模式。";
    }
    const cur = PB.currentProcessData;
    if (!cur || !cur.properties || !cur.properties.id || !isObj(cur.xpdlObj)) {
      return "还没有打开任何流程（ProcessBuilder.currentProcessData 为空）。";
    }
    return "";
  }

  const arr = (o, k) => window.ProcessBuilder.getArray(o, k);
  const attrs = (o) => arr(o && o.ExtendedAttributes, "ExtendedAttribute");
  const activities = (proc) => arr(proc.Activities, "Activity");

  function participantOrder(proc) {
    const a = attrs(proc).find((x) => x["-Name"] === "JaWE_GRAPH_WORKFLOW_PARTICIPANT_ORDER");
    return a && a["-Value"] ? a["-Value"].split(";").filter(Boolean) : [];
  }
  function usedParticipantIds(proc) {
    const s = new Set(participantOrder(proc));
    activities(proc).forEach((a) => { if (typeof a.Performer === "string" && a.Performer) { s.add(a.Performer); } });
    return s;
  }
  function toolIds(proc) {
    const s = new Set();
    activities(proc).forEach((a) => {
      const t = a.Implementation && a.Implementation.Tool;
      (Array.isArray(t) ? t : t ? [t] : []).forEach((x) => { if (x && x["-Id"]) { s.add(x["-Id"]); } });
    });
    return s;
  }
  function subflows(proc) {
    return activities(proc).filter((a) => a.Implementation && a.Implementation.SubFlow)
      .map((a) => ({ activity: a["-Id"], target: a.Implementation.SubFlow["-Id"] || "" }));
  }

  /* ---------- walk mapping values ---------- */
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
  function collectRequires(maps) {
    const forms = new Set(), plugins = new Set();
    for (const m of MAPS) {
      for (const [k, v] of Object.entries(maps[m] || {})) {
        if (m === "participantMap" && v && v.type === "plugin" && v.value) {
          plugins.add(String(v.value));
        }
        if (m === "activityForms" && v && v.formId) {
          forms.add(String(v.formId));
        }
        walk(v, m + "." + k, (o, key) => {
          const val = o[key];
          if (typeof val !== "string" || !val) {
            return;
          }
          if (key === "className") {
            plugins.add(val);
          } else if (key === "formDefId" || key === "formId") {
            forms.add(val);
          }
        });
      }
    }
    return { forms: [...forms].sort(), plugins: [...plugins].sort() };
  }
  function blankSensitive(maps) {
    const paths = [];
    for (const m of MAPS) {
      for (const [k, v] of Object.entries(maps[m] || {})) {
        walk(v, m + "." + k, (o, key, p) => {
          const val = o[key];
          if (typeof val === "string" && val !== "" && !HASH_ONLY.test(val) && SENSITIVE.some((re) => re.test(key))) {
            o[key] = "";
            paths.push(p);
          }
        });
      }
    }
    return paths;
  }
  function listSensitivePaths(maps) {
    const paths = [];
    for (const m of MAPS) {
      for (const [k, v] of Object.entries(maps[m] || {})) {
        walk(v, m + "." + k, (o, key, p) => {
          const val = o[key];
          if (typeof val === "string" && val !== "" && !HASH_ONLY.test(val) && SENSITIVE.some((re) => re.test(key))) {
            paths.push(p);
          }
        });
      }
    }
    return paths;
  }

  /* ---------- export ---------- */
  function doExport(opts) {
    const err = shapeError();
    if (err) {
      return { ok: false, error: err };
    }
    const PB = window.ProcessBuilder, CB = window.CustomBuilder, D = CB.data;
    const pkg = D.xpdl.Package;
    const pid = PB.currentProcessData.properties.id;
    const proc = clone(PB.currentProcessData.xpdlObj);
    const used = usedParticipantIds(proc);
    const participants = arr(pkg.Participants, "Participant").filter((p) => used.has(p["-Id"])).map(clone);
    const tools = toolIds(proc);
    const applications = arr(pkg.Applications, "Application").filter((a) => tools.has(a["-Id"])).map(clone);
    const maps = {};
    for (const m of MAPS) {
      maps[m] = {};
      const src = D[DATA_KEY[m]] || {};
      for (const key of Object.keys(src)) {
        if (key.indexOf(pid + "::") === 0) {
          maps[m][key.substring(pid.length + 2)] = clone(src[key]);
        }
      }
    }
    const includeSensitive = !!(opts && opts.includeSensitive);
    const requires = collectRequires(maps);
    const sensitive = includeSensitive ? listSensitivePaths(maps) : blankSensitive(maps);
    const bundle = {
      kind: KIND,
      v: VERSION,
      includeSensitive,
      source: {
        origin: location.origin,
        appId: CB.appId || "",
        appVersion: CB.appVersion || "",
        packageVersion: (CB.config && CB.config.builder && CB.config.builder.properties && CB.config.builder.properties.packageVersion) || "",
        processId: pid,
        processName: proc["-Name"] || "",
        exportedAt: new Date().toISOString(),
        unsavedChanges: typeof CB.isSaved === "function" ? !CB.isSaved() : false,
      },
      process: proc,
      participants,
      applications,
      participantMap: maps.participantMap,
      activityForms: maps.activityForms,
      activityPlugins: maps.activityPlugins,
      requires,
      sensitive,
      subflows: subflows(proc),
    };
    const fileName = [CB.appId || "app", CB.appVersion || "", pid].filter(Boolean).join("_") + ".process.json";
    return { ok: true, bundle, fileName };
  }


  /* ---------- design validation (same rules as ProcessBuilder.validate, pbuilder.js:6462-6610) ---------- */
  function cmsg(k, fallback) {
    return (typeof window.get_cbuilder_msg === "function" && window.get_cbuilder_msg(k)) || fallback || k;
  }
  function connectingActivityId(val) {
    const s = String(val || "");
    const m = s.match(/CONNECTING_ACTIVITY_ID=([^,]*),/);
    return m ? m[1] : "";
  }
  function formatIssue(i) {
    const proc = "流程 " + i.processId + (i.processName ? "「" + i.processName + "」" : "");
    if (i.activityId) {
      return proc + " · 节点 " + i.activityId + (i.activityName ? "「" + i.activityName + "」" : "") + "：" + i.reason;
    }
    return proc + "：" + i.reason;
  }
  // pkg is Package; omit to read the live designer data. Never writes.
  function collectDesignIssues(pkg) {
    const PB = window.ProcessBuilder, CB = window.CustomBuilder;
    if (!PB || !CB || !CB.data || !CB.data.xpdl) {
      return [];
    }
    pkg = pkg || CB.data.xpdl.Package;
    const issues = [];
    const procs = arr(pkg.WorkflowProcesses, "WorkflowProcess");
    for (const proc of procs) {
      const pid = proc["-Id"];
      const pname = proc["-Name"] || pid;
      const acts = activities(proc);
      const trans = arr(proc.Transitions, "Transition");
      const pa = attrs(proc);
      const starts = [], ends = [];
      const startMeta = [];
      for (const a of pa) {
        if (a["-Name"] === "JaWE_GRAPH_END_OF_WORKFLOW" || a["-Name"] === "JaWE_GRAPH_START_OF_WORKFLOW") {
          // same extract as ProcessBuilder.validate (empty CONNECTING_ACTIVITY_ID leaves the whole string)
          const actId = String(a["-Value"] || "").replace(/.*,CONNECTING_ACTIVITY_ID=([^,]+),.*/g, "$1");
          const connected = connectingActivityId(a["-Value"]);
          if (a["-Name"] === "JaWE_GRAPH_START_OF_WORKFLOW") {
            starts.push(actId);
            startMeta.push({ actId, connected });
          } else {
            ends.push(actId);
          }
        }
      }
      const fromT = {}, toT = {};
      for (const t of trans) {
        (fromT[t["-From"]] ||= []).push(t);
        (toT[t["-To"]] ||= []).push(t);
      }
      const push = (activityId, activityName, reason, kind) => {
        issues.push({ processId: pid, processName: pname, activityId: activityId || "", activityName: activityName || "", reason, kind });
      };
      if (!acts.length) {
        push("", "", "没有任何活动节点（空流程）", "empty");
      }
      if (starts.length === 0) {
        push("", "", "没有开始节点（Start）", "noStart");
      }
      if (starts.length > 1) {
        push(starts.join(","), "", "有多个开始节点：" + starts.join("、"), "multiStart");
      }
      for (const s of startMeta) {
        if (!s.connected) {
          push("", "", "开始节点没有连接到活动", "emptyStart");
        }
      }
      for (const act of acts) {
        const aid = act["-Id"];
        const aname = act["-Name"] || "";
        const activityInvalid = (fromT[aid] === undefined && ends.indexOf(aid) === -1)
          || (toT[aid] === undefined && starts.indexOf(aid) === -1);
        const startInvalid = starts.indexOf(aid) !== -1 && toT[aid] && toT[aid].length > 0;
        let deadlineInvalid = false;
        const deadlines = arr(act.Deadline);
        if (deadlines.length) {
          if (fromT[aid] === undefined) {
            deadlineInvalid = true;
          } else {
            const exceptionNames = [];
            for (const t of fromT[aid]) {
              if (t.Condition && t.Condition["-Type"] === "EXCEPTION") {
                exceptionNames.push(t.Condition["#text"]);
              }
            }
            for (const d of deadlines) {
              if (exceptionNames.indexOf(d.ExceptionName) === -1) {
                deadlineInvalid = true;
                break;
              }
            }
          }
        }
        if (activityInvalid || deadlineInvalid || startInvalid) {
          const reasons = [];
          if (activityInvalid) {
            reasons.push(cmsg("pbuilder.label.missingTransition", "缺少连线或开始/结束节点"));
          }
          if (deadlineInvalid) {
            reasons.push(cmsg("pbuilder.label.unhandleDeadline", "有未处理的 Deadline"));
          }
          if (startInvalid) {
            reasons.push(cmsg("pbuilder.label.invalidStart", "开始节点后面的节点不能再有其他进入连线"));
          }
          push(aid, aname, reasons.join("；"), "node");
        }
      }
    }
    return issues;
  }
  function hookSaveValidation() {
    const PB = window.ProcessBuilder;
    if (!PB || typeof PB.beforeSaveValidation !== "function" || PB.__jskinValidateHook) {
      return !!(PB && typeof PB.beforeSaveValidation === "function");
    }
    PB.__jskinValidateHook = true;
    const orig = PB.beforeSaveValidation.bind(PB);
    PB.beforeSaveValidation = function () {
      const ok = orig();
      if (!ok) {
        const issues = collectDesignIssues();
        if (issues.length) {
          window.postMessage(JSON.stringify({
            source: OUT, id: "design-invalid", cmd: "design-invalid", ok: false,
            issues, lines: issues.map(formatIssue),
          }), location.origin);
        }
      }
      return ok;
    };
    return true;
  }
  (function waitHook(n) {
    if (!hookSaveValidation() && n < 80) {
      setTimeout(() => waitHook(n + 1), 250);
    }
  })(0);

  /* ---------- import: check + plan (no writes) ---------- */
  let pluginCache = null;
  async function localPlugins() {
    if (pluginCache) {
      return pluginCache;
    }
    const CB = window.CustomBuilder;
    try {
      const r = await fetch(CB.contextPath + "/web/property/json/getElements?classname=org.joget.plugin.base.Plugin", { credentials: "same-origin" });
      const list = await r.json();
      pluginCache = new Set(list.map((x) => x && x.value).filter(Boolean));
    } catch (e) {
      pluginCache = null;
    }
    return pluginCache;
  }

  function bundleError(b) {
    if (!isObj(b) || b.kind !== KIND) {
      return "这不是流程导出文件（kind 不是 " + KIND + "）。";
    }
    if (b.v !== VERSION) {
      return "文件版本 v" + b.v + " 不支持（这个扩展只认 v" + VERSION + "）。";
    }
    if (!isObj(b.process) || typeof b.process["-Id"] !== "string" || !b.process["-Id"]) {
      return "文件里没有流程定义（process['-Id']）。";
    }
    if (!Array.isArray(b.participants) || MAPS.some((m) => b[m] !== undefined && !isObj(b[m]))) {
      return "文件结构不对（participants 必须是数组，三张绑定表必须是对象）。";
    }
    return "";
  }

  async function plan(text) {
    const err = shapeError();
    if (err) {
      return { ok: false, error: err };
    }
    let b;
    try {
      b = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: "读不懂这个文件（不是 JSON）：" + e.message };
    }
    const berr = bundleError(b);
    if (berr) {
      return { ok: false, error: berr };
    }
    const PB = window.ProcessBuilder, CB = window.CustomBuilder;
    const pkg = CB.data.xpdl.Package;
    const srcId = b.process["-Id"];
    const ids = arr(pkg.WorkflowProcesses, "WorkflowProcess").map((p) => p["-Id"]);

    // process id: same rule as cloneProcess (pbuilder.js:4477-4486) — only when it clashes
    let newId = srcId, newName = b.process["-Name"] || srcId, renamed = false;
    if (ids.indexOf(srcId) !== -1) {
      let count = 1;
      do {
        newId = srcId + "_" + ++count;
      } while (ids.indexOf(newId) !== -1);
      renamed = true;
      const copy = typeof window.get_cbuilder_msg === "function" ? window.get_cbuilder_msg("pbuilder.label.copy") : "(Copy)";
      newName = newName + " " + copy;
    }

    // participants: cloneProcess naming (pbuilder.js:4528-4532) for the ones that clash locally
    const taken = new Set(arr(pkg.Participants, "Participant").map((p) => p["-Id"]));
    const pmap = {}, renames = [];
    for (const p of b.participants) {
      const old = p && p["-Id"];
      if (!old) {
        continue;
      }
      let nid = old;
      if (taken.has(old)) {
        nid = old.indexOf(srcId) === 0 ? newId + old.substring(srcId.length) : newId + "_" + old;
        const base = nid;
        let n = 1;
        while (taken.has(nid)) {
          nid = base + "_" + ++n;
        }
        renames.push({ from: old, to: nid });
      }
      taken.add(nid);
      pmap[old] = nid;
    }

    // checklist (read-only): forms from ProcessBuilder.availableForms (getForms, pbuilder.js:7348)
    const req = isObj(b.requires) ? b.requires : collectRequires(b);
    const forms = PB.availableForms;
    const missingForms = isObj(forms) ? (req.forms || []).filter((f) => !(f in forms)) : null;
    const plugins = await localPlugins();
    const missingPlugins = plugins ? (req.plugins || []).filter((c) => !plugins.has(c)) : null;

    const warnings = [];
    const used = usedParticipantIds(b.process);
    const known = new Set(b.participants.map((p) => p && p["-Id"]));
    [...used].filter((u) => !known.has(u)).forEach((u) => warnings.push("流程用到参与者「" + u + "」，但文件里没有它的定义。"));
    (b.subflows || subflows(b.process)).forEach((s) => {
      warnings.push("活动「" + s.activity + "」调用子流程「" + s.target + "」" +
        (ids.indexOf(s.target) === -1 ? "，本地没有这个流程" : "，会调用本地同名流程") + "（跨流程引用不会自动处理）。");
    });
    if (renames.length) {
      // cloneProcess does not touch plugin properties either; flag values that still use an old id
      const olds = new Set(renames.map((r) => r.from));
      walk(b.activityPlugins || {}, "activityPlugins", (o, key, p) => {
        if (/participant/i.test(key) && typeof o[key] === "string" && o[key].split(/[;,]/).some((x) => olds.has(x.trim()))) {
          warnings.push(p + " = 「" + o[key] + "」引用了改名前的参与者 id，请检查。");
        }
      });
    }
    const toolSet = toolIds(b.process);
    const localApps = new Set(arr(pkg.Applications, "Application").map((a) => a["-Id"]));
    const addApps = (b.applications || []).filter((a) => a && a["-Id"] && !localApps.has(a["-Id"]) && toolSet.has(a["-Id"]));
    [...toolSet].filter((t) => !localApps.has(t) && !addApps.some((a) => a["-Id"] === t))
      .forEach((t) => warnings.push("工具活动用到 Application「" + t + "」，本地和文件里都没有。"));
    if (b.source && b.source.unsavedChanges) {
      warnings.push("导出时远端设计器里有未保存的修改，文件里的是当时屏幕上的版本。");
    }

    // preview what ProcessBuilder.validate would say after this import (does not write)
    const pkgPreview = clone(pkg);
    const previewProc = retarget(clone(b.process), srcId, newId, newName, pmap);
    const previewList = arr(pkgPreview.WorkflowProcesses, "WorkflowProcess");
    previewList.push(previewProc);
    PB.setArray(pkgPreview, "WorkflowProcesses", "WorkflowProcess", previewList);
    const designIssues = collectDesignIssues(pkgPreview);

    return {
      ok: true,
      bundle: b,
      plan: {
        source: b.source || {},
        srcId, newId, newName, renamed, pmap, renames,
        addApps,
        counts: { activities: activities(b.process).length, participants: b.participants.length,
          participantMap: Object.keys(b.participantMap || {}).length,
          activityForms: Object.keys(b.activityForms || {}).length,
          activityPlugins: Object.keys(b.activityPlugins || {}).length },
        missingForms, missingPlugins,
        includeSensitive: !!b.includeSensitive,
        sensitive: Array.isArray(b.sensitive) ? b.sensitive : [],
        warnings,
        designIssues,
        designIssueLines: designIssues.map(formatIssue),
      },
    };
  }

  /* ---------- import: apply (same write + refresh sequence as cloneProcess) ---------- */
  function retarget(proc, srcId, newId, newName, pmap) {
    proc["-Id"] = newId;
    proc["-Name"] = newName;
    const PB = window.ProcessBuilder;
    const pa = attrs(proc);
    for (const a of pa) {
      if (a["-Name"] === "JaWE_GRAPH_WORKFLOW_PARTICIPANT_ORDER" && typeof a["-Value"] === "string") {
        a["-Value"] = a["-Value"].split(";").map((x) => (x && pmap[x]) || x).join(";");
      } else if ((a["-Name"] === "JaWE_GRAPH_START_OF_WORKFLOW" || a["-Name"] === "JaWE_GRAPH_END_OF_WORKFLOW") && typeof a["-Value"] === "string") {
        a["-Value"] = a["-Value"].replace(/JaWE_GRAPH_PARTICIPANT_ID=([^,]*),/, (m, id) => "JaWE_GRAPH_PARTICIPANT_ID=" + (pmap[id] || id) + ",");
      }
    }
    if (pa.length) {
      PB.setArray(proc, "ExtendedAttributes", "ExtendedAttribute", pa);
    }
    const acts = activities(proc);
    for (const a of acts) {
      if (typeof a.Performer === "string" && pmap[a.Performer]) {
        a.Performer = pmap[a.Performer];
      }
      for (const at of attrs(a)) {
        if (at["-Name"] === "JaWE_GRAPH_PARTICIPANT_ID" && pmap[at["-Value"]]) {
          at["-Value"] = pmap[at["-Value"]];
        }
      }
    }
    if (acts.length) {
      PB.setArray(proc, "Activities", "Activity", acts);
    }
    return proc;
  }

  async function apply(text) {
    const r = await plan(text);
    if (!r.ok) {
      return r;
    }
    const b = r.bundle, p = r.plan;
    const PB = window.ProcessBuilder, CB = window.CustomBuilder, D = CB.data;
    const pkg = D.xpdl.Package;
    for (const k of ["participants", "activityForms", "activityPlugins"]) {
      if (!isObj(D[k])) {
        D[k] = {};
      }
    }
    const proc = retarget(clone(b.process), p.srcId, p.newId, p.newName, p.pmap);

    const parts = arr(pkg.Participants, "Participant");
    for (const x of b.participants) {
      if (x && x["-Id"]) {
        const c = clone(x);
        c["-Id"] = p.pmap[x["-Id"]];
        parts.push(c);
      }
    }
    PB.setArray(pkg, "Participants", "Participant", parts);
    if (p.addApps.length) {
      PB.setArray(pkg, "Applications", "Application", arr(pkg.Applications, "Application").concat(p.addApps.map(clone)));
    }
    const procs = arr(pkg.WorkflowProcesses, "WorkflowProcess");
    procs.push(proc);
    PB.setArray(pkg, "WorkflowProcesses", "WorkflowProcess", procs);

    const pm = {};
    for (const [k, v] of Object.entries(b.participantMap || {})) {
      pm[p.newId + "::" + (k === WHITELIST ? WHITELIST : (p.pmap[k] || k))] = clone(v);
    }
    if (pm[p.newId + "::" + WHITELIST] === undefined) { // as cloneProcess (pbuilder.js:4594-4600)
      pm[p.newId + "::" + WHITELIST] = { type: "role", value: "adminUser", properties: {} };
    }
    Object.assign(D.participants, pm);
    for (const m of ["activityForms", "activityPlugins"]) {
      for (const [k, v] of Object.entries(b[m] || {})) {
        D[m][p.newId + "::" + k] = clone(v);
      }
    }

    // refresh exactly like cloneProcess (pbuilder.js:4620-4624)
    CB.update();
    PB.updateProcessSelector();
    CB.Builder.triggerChange();
    window.location.hash = p.newId;
    const designIssues = collectDesignIssues();
    p.designIssues = designIssues;
    p.designIssueLines = designIssues.map(formatIssue);
    return { ok: true, plan: p };
  }

  /* ---------- message channel ---------- */
  const reply = (id, obj) => window.postMessage(JSON.stringify(Object.assign({ source: OUT, id }, obj)), location.origin);
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
    if (!m || m.source !== IN) {
      return;
    }
    const run = async () => {
      if (m.cmd === "export") {
        return doExport(m);
      }
      if (m.cmd === "check") {
        const r = await plan(m.text || "");
        return r.ok ? { ok: true, plan: r.plan } : r;
      }
      if (m.cmd === "apply") {
        return apply(m.text || "");
      }
      if (m.cmd === "ping") {
        return { ok: true };
      }
      if (m.cmd === "validate") {
        const issues = collectDesignIssues();
        return { ok: true, officialValid: window.ProcessBuilder.validate(), issues, lines: issues.map(formatIssue) };
      }
      return { ok: false, error: "unknown cmd " + m.cmd };
    };
    run().then((r) => reply(m.id, r), (err) => reply(m.id, { ok: false, error: "出错了：" + (err && err.message) }));
  });
  reply("ready", { ok: true, ready: true });
})();
