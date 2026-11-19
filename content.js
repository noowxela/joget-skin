/**
 * Sets classes on <html> so the injected CSS only applies when wanted:
 *   joget-skin                 skin on (storage "jogetSkinEnabled", default true)
 *   joget-skin-theme-indigo    Indigo theme (storage "jogetSkinTheme" === "indigo", default "default")
 * The theme class is only set while the skin is on, so turning the skin off removes everything.
 * Changes from the popup apply live via storage.onChanged (no reload needed).
 */
(function () {
  const SKIN_CLASS = "joget-skin";
  const ENABLED_KEY = "jogetSkinEnabled";
  const THEME_KEY = "jogetSkinTheme";
  const THEMES = ["indigo"]; // class: joget-skin-theme-<name>

  const state = { enabled: true, theme: "default" };

  function apply() {
    const root = document.documentElement;
    if (!root) {
      return;
    }
    root.classList.toggle(SKIN_CLASS, state.enabled);
    for (const t of THEMES) {
      root.classList.toggle("joget-skin-theme-" + t, state.enabled && state.theme === t);
    }
  }

  // Apply as early as possible (run_at: document_start).
  browser.storage.local.get({ [ENABLED_KEY]: true, [THEME_KEY]: "default" }).then((r) => {
    state.enabled = r[ENABLED_KEY] !== false;
    state.theme = r[THEME_KEY] || "default";
    apply();
  });

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }
    if (changes[ENABLED_KEY]) {
      state.enabled = changes[ENABLED_KEY].newValue !== false;
    }
    if (changes[THEME_KEY]) {
      state.theme = changes[THEME_KEY].newValue || "default";
    }
    if (changes[ENABLED_KEY] || changes[THEME_KEY]) {
      apply();
    }
  });
})();
