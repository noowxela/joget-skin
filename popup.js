const ENABLED_KEY = "jogetSkinEnabled";
const THEME_KEY = "jogetSkinTheme";
const CHIME_KEY = "jogetSkinSaveChime";
const checkbox = document.getElementById("toggle");
const themeSelect = document.getElementById("theme");
const chimeBox = document.getElementById("chime");
const chimeRow = document.getElementById("chime-row");

// always the installed version, never hard-coded
document.getElementById("version").textContent = "v" + browser.runtime.getManifest().version;

function syncDisabled() {
  themeSelect.disabled = !checkbox.checked;
  chimeBox.disabled = !checkbox.checked;
  chimeRow.classList.toggle("disabled", !checkbox.checked);
}

browser.storage.local
  .get({ [ENABLED_KEY]: true, [THEME_KEY]: "default", [CHIME_KEY]: true })
  .then((result) => {
    checkbox.checked = result[ENABLED_KEY] !== false;
    themeSelect.value = result[THEME_KEY] === "indigo" ? "indigo" : "default";
    chimeBox.checked = result[CHIME_KEY] !== false;
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
});
