const ENABLED_KEY = "jogetSkinEnabled";
const THEME_KEY = "jogetSkinTheme";
const CHIME_KEY = "jogetSkinSaveChime";
const SOUND_KEY = "jogetSkinChimeSound";
const CHECKED_AT_KEY = "jogetSkinUpdateCheckedAt";
const UPDATE_URL = "https://noowxela.github.io/joget-skin/updates.json";
const CHANGELOG_URL = "https://noowxela.github.io/joget-skin/changelog.html";
const ADDON_ID_FALLBACK = "joget-skin@alexwoon";
const DAY_MS = 24 * 60 * 60 * 1000;

const checkbox = document.getElementById("toggle");
const themeSelect = document.getElementById("theme");
const chimeBox = document.getElementById("chime");
const chimeRow = document.getElementById("chime-row");
const soundSelect = document.getElementById("sound");
const previewBtn = document.getElementById("preview");
const checkBtn = document.getElementById("update-check");
const statusEl = document.getElementById("update-status");
const hintEl = document.getElementById("update-hint");
let previewCtx = null;
let latestInfo = null; // { version, update_link }

// always the installed version, never hard-coded
const CURRENT_VERSION = browser.runtime.getManifest().version;
document.getElementById("version").textContent = "v" + CURRENT_VERSION;

function addonId() {
  try {
    const gecko = (browser.runtime.getManifest().browser_specific_settings || {}).gecko;
    return (gecko && gecko.id) || ADDON_ID_FALLBACK;
  } catch (e) {
    return ADDON_ID_FALLBACK;
  }
}

function cmpSemver(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) {
      return 1;
    }
    if (da < db) {
      return -1;
    }
  }
  return 0;
}

function highestUpdate(json, id) {
  const list = json && json.addons && json.addons[id] && json.addons[id].updates;
  if (!Array.isArray(list) || !list.length) {
    return null;
  }
  let best = null;
  for (const item of list) {
    if (!item || !item.version) {
      continue;
    }
    if (!best || cmpSemver(item.version, best.version) > 0) {
      best = item;
    }
  }
  return best;
}

function shortReason(err) {
  const msg = err && (err.message || String(err)) || "未知错误";
  if (/^HTTP \d+/.test(msg)) {
    return msg;
  }
  if (/Failed to fetch|NetworkError|Load failed|NS_ERROR|internet|network/i.test(msg)) {
    return "网络错误";
  }
  if (/JSON|Unexpected|SyntaxError|清单无效/i.test(msg)) {
    return "清单无效";
  }
  return msg.length > 40 ? msg.slice(0, 40) + "…" : msg;
}

function setHint(text) {
  hintEl.textContent = text || "";
  hintEl.classList.toggle("show", !!text);
}

function clearStatus() {
  statusEl.replaceChildren();
}

function addStatusText(text) {
  statusEl.append(document.createTextNode(text));
}

function addActions(kids) {
  const wrap = document.createElement("div");
  wrap.className = "update-actions";
  for (const k of kids) {
    wrap.append(k);
  }
  statusEl.append(wrap);
  return wrap;
}

function changelogLink() {
  const a = document.createElement("a");
  a.id = "update-changelog";
  a.href = CHANGELOG_URL;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = "更新日志";
  return a;
}

function actionButton(id, label, fn) {
  const b = document.createElement("button");
  b.type = "button";
  b.id = id;
  b.textContent = label;
  b.addEventListener("click", fn);
  return b;
}

async function isDevInstall() {
  try {
    if (!browser.management || typeof browser.management.getSelf !== "function") {
      return false;
    }
    const self = await browser.management.getSelf();
    return !!(self && self.installType === "development");
  } catch (e) {
    return false;
  }
}

async function fetchLatest() {
  const res = await fetch(UPDATE_URL, { cache: "no-store" });
  if (!res.ok) {
    throw new Error("HTTP " + res.status);
  }
  let json;
  try {
    json = await res.json();
  } catch (e) {
    throw new Error("清单无效");
  }
  const best = highestUpdate(json, addonId());
  if (!best) {
    throw new Error("清单里没有这个扩展");
  }
  return best;
}

function showLatest() {
  latestInfo = null;
  clearStatus(); addStatusText("已是最新版");
}

function showNewer(info) {
  latestInfo = info;
  clearStatus();
  addStatusText("有新版本 v" + info.version);
  addActions([changelogLink(), actionButton("update-now", "立即更新", applyUpdate)]);
}

async function maybeDevHint(force) {
  if (force || await isDevInstall()) {
    setHint("从 about:debugging 临时加载的扩展不会自动更新，请安装签名 xpi。");
    return true;
  }
  return false;
}

async function applyUpdate() {
  const info = latestInfo;
  setHint("");
  if (await maybeDevHint()) {
    return;
  }
  // Bracket access so web-ext does not warn: Firefox has not implemented this API.
  const request = browser.runtime && browser.runtime["requestUpdateCheck"];
  if (typeof request === "function") {
    try {
      const result = await request.call(browser.runtime);
      const status = result && result.status != null ? result.status : result;
      const ver = (result && result.version) || (info && info.version);
      if (status === "update_available") {
        clearStatus();
        addStatusText("有新版本 v" + ver + "，正在准备安装，完成后会重新加载扩展。");
        if (browser.runtime.onUpdateAvailable && browser.runtime.onUpdateAvailable.addListener) {
          browser.runtime.onUpdateAvailable.addListener(() => browser.runtime.reload());
        }
        return;
      }
      if (status === "throttled") {
        clearStatus();
        addStatusText("刚才已经检查过，请稍后再试。");
        return;
      }
      if (status === "no_update") {
        // We already saw a newer version in updates.json; this usually means
        // a temporary / unpacked install that Firefox will not update.
        await maybeDevHint(true);
        clearStatus();
        addStatusText("当前安装不会自动更新。请安装签名 xpi。");
        return;
      }
      clearStatus();
      addStatusText("检查失败：" + (status || "未知状态"));
      return;
    } catch (e) {
      clearStatus(); addStatusText("检查失败：" + shortReason(e));
      return;
    }
  }
  // Firefox does not implement requestUpdateCheck (Bug 1740508). Point the
  // user at about:addons, which is how a signed self-hosted install updates.
  clearStatus();
  addStatusText("请到 about:addons 的齿轮菜单点「检查更新」，或等大约 24 小时自动更新。");
  addActions([actionButton("update-addons", "打开附加组件管理页", () => {
    if (browser.tabs && typeof browser.tabs.create === "function") {
      browser.tabs.create({ url: "about:addons" });
    }
  })]);
}

async function checkForUpdate(silent) {
  if (!silent) {
    checkBtn.disabled = true;
    setHint("");
    clearStatus(); addStatusText("检查中…");
  }
  try {
    const info = await fetchLatest();
    await browser.storage.local.set({ [CHECKED_AT_KEY]: Date.now() });
    if (cmpSemver(info.version, CURRENT_VERSION) > 0) {
      showNewer(info);
      await maybeDevHint();
    } else if (!silent) {
      showLatest();
    }
  } catch (e) {
    if (!silent) {
      clearStatus(); addStatusText("检查失败：" + shortReason(e));
    }
  } finally {
    if (!silent) {
      checkBtn.disabled = false;
    }
  }
}

function syncDisabled() {
  themeSelect.disabled = !checkbox.checked;
  chimeBox.disabled = !checkbox.checked;
  chimeRow.classList.toggle("disabled", !checkbox.checked);
  soundSelect.disabled = !checkbox.checked || !chimeBox.checked;
}

browser.storage.local
  .get({ [ENABLED_KEY]: true, [THEME_KEY]: "default", [CHIME_KEY]: true, [SOUND_KEY]: JogetSkinChime.DEFAULT, [CHECKED_AT_KEY]: 0 })
  .then((result) => {
    checkbox.checked = result[ENABLED_KEY] !== false;
    themeSelect.value = result[THEME_KEY] === "indigo" ? "indigo" : "default";
    chimeBox.checked = result[CHIME_KEY] !== false;
    soundSelect.value = JogetSkinChime.SOUNDS[result[SOUND_KEY]] ? result[SOUND_KEY] : JogetSkinChime.DEFAULT;
    syncDisabled();
    const last = Number(result[CHECKED_AT_KEY]) || 0;
    if (Date.now() - last >= DAY_MS) {
      checkForUpdate(true);
    }
  });

checkbox.addEventListener("change", () => {
  browser.storage.local.set({ [ENABLED_KEY]: checkbox.checked });
  syncDisabled();
});

themeSelect.addEventListener("change", () => {
  browser.storage.local.set({ [THEME_KEY]: themeSelect.value });
});

chimeBox.addEventListener("change", () => {
  browser.storage.local.set({ [CHIME_KEY]: chimeBox.checked });
  syncDisabled();
});

function preview() {
  // created/resumed inside the click => allowed by the autoplay policy
  if (!previewCtx) {
    previewCtx = new AudioContext({ latencyHint: "interactive" });
  }
  const start = () => {
    JogetSkinChime.play(previewCtx, soundSelect.value);
    document.body.setAttribute("data-preview", previewCtx.state + " " + soundSelect.value);
  };
  if (previewCtx.state !== "running") {
    previewCtx.resume().then(start, (e) => document.body.setAttribute("data-preview", "blocked " + (e && e.name)));
  } else {
    start();
  }
}

soundSelect.addEventListener("change", () => {
  browser.storage.local.set({ [SOUND_KEY]: soundSelect.value });
  preview();
});

previewBtn.addEventListener("click", preview);
checkBtn.addEventListener("click", () => checkForUpdate(false));
