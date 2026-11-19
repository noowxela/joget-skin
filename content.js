/**
 * Toggle class on <html> so injected CSS only applies when enabled.
 * Storage key: jogetSkinEnabled (default true).
 */
(function () {
  const CLASS_NAME = "joget-skin";
  const STORAGE_KEY = "jogetSkinEnabled";

  function applyEnabled(enabled) {
    const root = document.documentElement;
    if (!root) {
      return;
    }
    if (enabled) {
      root.classList.add(CLASS_NAME);
    } else {
      root.classList.remove(CLASS_NAME);
    }
  }

  // Apply as early as possible (run_at: document_start).
  browser.storage.local.get({ [STORAGE_KEY]: true }).then((result) => {
    applyEnabled(result[STORAGE_KEY] !== false);
  });

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[STORAGE_KEY]) {
      return;
    }
    applyEnabled(changes[STORAGE_KEY].newValue !== false);
  });
})();
