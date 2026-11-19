const ENABLED_KEY = "jogetSkinEnabled";
const THEME_KEY = "jogetSkinTheme";
const CHIME_KEY = "jogetSkinSaveChime";
const SOUND_KEY = "jogetSkinChimeSound";
const checkbox = document.getElementById("toggle");
const themeSelect = document.getElementById("theme");
const chimeBox = document.getElementById("chime");
const chimeRow = document.getElementById("chime-row");
const soundSelect = document.getElementById("sound");
const previewBtn = document.getElementById("preview");
let previewCtx = null;

// always the installed version, never hard-coded
document.getElementById("version").textContent = "v" + browser.runtime.getManifest().version;

function syncDisabled() {
  themeSelect.disabled = !checkbox.checked;
  chimeBox.disabled = !checkbox.checked;
  chimeRow.classList.toggle("disabled", !checkbox.checked);
  soundSelect.disabled = !checkbox.checked || !chimeBox.checked;
}

browser.storage.local
  .get({ [ENABLED_KEY]: true, [THEME_KEY]: "default", [CHIME_KEY]: true, [SOUND_KEY]: JogetSkinChime.DEFAULT })
  .then((result) => {
    checkbox.checked = result[ENABLED_KEY] !== false;
    themeSelect.value = result[THEME_KEY] === "indigo" ? "indigo" : "default";
    chimeBox.checked = result[CHIME_KEY] !== false;
    soundSelect.value = JogetSkinChime.SOUNDS[result[SOUND_KEY]] ? result[SOUND_KEY] : JogetSkinChime.DEFAULT;
    syncDisabled();
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
