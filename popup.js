const STORAGE_KEY = "jogetSkinEnabled";
const checkbox = document.getElementById("toggle");

browser.storage.local.get({ [STORAGE_KEY]: true }).then((result) => {
  checkbox.checked = result[STORAGE_KEY] !== false;
});

checkbox.addEventListener("change", () => {
  browser.storage.local.set({ [STORAGE_KEY]: checkbox.checked });
});
