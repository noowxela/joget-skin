const ENABLED_KEY = "jogetSkinEnabled";
const THEME_KEY = "jogetSkinTheme";
const checkbox = document.getElementById("toggle");
const themeSelect = document.getElementById("theme");

function syncDisabled() {
  themeSelect.disabled = !checkbox.checked;
}

browser.storage.local.get({ [ENABLED_KEY]: true, [THEME_KEY]: "default" }).then((result) => {
  checkbox.checked = result[ENABLED_KEY] !== false;
  themeSelect.value = result[THEME_KEY] === "indigo" ? "indigo" : "default";
  syncDisabled();
});

checkbox.addEventListener("change", () => {
  browser.storage.local.set({ [ENABLED_KEY]: checkbox.checked });
  syncDisabled();
});

themeSelect.addEventListener("change", () => {
  browser.storage.local.set({ [THEME_KEY]: themeSelect.value });
});
