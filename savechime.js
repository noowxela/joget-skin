/**
 * Joget Skin — save chime (content script, top frame of builder pages).
 * Pages: /jw/web/console/app/{appId}/{version}/{form|datalist|userview|process|...}/builder/{id}
 *
 * Plays a short two-note chime when a Save really completes: Joget's CustomBuilder.save()
 * posts the JSON and, only when the server answers success, prepends a ".toast-success"
 * into #builder-message (failures add ".toast-danger" => no sound). The Save button and
 * Ctrl/Cmd+S (also when pressed inside the canvas iframe, which Joget forwards) both go
 * through save(), so we "arm" on the start of a save — the Save button switching to its
 * spinner or a click on it — and play on the next success toast within 60 s.
 *
 * Setting: browser.storage.local "jogetSkinSaveChime" (default true), live.
 * Only while the skin is on (<html class="joget-skin">), like everything else.
 */
(function () {
  "use strict";

  if (window !== window.top || window.__jskinSaveChimeLoaded) {
    return;
  }
  if (!/\/web\/console\/app\/[^/]+\/[^/]+\/[^/]+\/builder\//.test(location.pathname)) {
    return;
  }
  window.__jskinSaveChimeLoaded = true;

  const KEY = "jogetSkinSaveChime";
  const ARM_MS = 60000;
  let enabled = true;
  let armedAt = 0;
  let ctx = null;

  const skinOn = () => document.documentElement.classList.contains("joget-skin");

  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) {
        return null;
      }
      ctx = new AC();
    }
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  // A short, soft "ding-ding" (E6 -> A6), ~0.45 s, generated on the fly.
  function chime() {
    const ac = audio();
    if (!ac) {
      return;
    }
    const t0 = ac.currentTime + 0.01;
    const master = ac.createGain();
    master.gain.value = 0.18;
    master.connect(ac.destination);
    [
      [1318.5, 0],
      [1760.0, 0.11],
    ].forEach(([freq, delay]) => {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = t0 + delay;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(1, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + 0.36);
    });
    document.documentElement.setAttribute("data-jskin-last-chime", Date.now() + " " + ac.state); // debug aid
  }

  function arm() {
    armedAt = Date.now();
    if (enabled && skinOn()) {
      audio(); // create/resume inside the user gesture when there is one
    }
  }

  // Unlock audio on the first user gesture (autoplay policy), arm on Save click / Ctrl+S.
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (enabled && skinOn()) {
        audio();
      }
      if (e.target.closest && e.target.closest("#save-btn, #save-btn-toolbar")) {
        arm();
      }
    },
    true
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
        arm();
      }
    },
    true
  );

  function isSaveSpinner(el) {
    return (
      el.matches &&
      el.matches("#save-btn > i, #save-btn-toolbar > i") &&
      el.classList.contains("fa-spinner")
    );
  }

  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "attributes") {
        if (isSaveSpinner(r.target)) {
          arm(); // save() started (button, Ctrl+S in either frame)
        }
        continue;
      }
      for (const n of r.addedNodes) {
        if (n.nodeType !== 1 || !n.classList.contains("toast") || !n.parentElement || n.parentElement.id !== "builder-message") {
          continue;
        }
        if (n.classList.contains("toast-danger")) {
          armedAt = 0; // failed: no sound
        } else if (n.classList.contains("toast-success") && armedAt && Date.now() - armedAt < ARM_MS) {
          armedAt = 0;
          if (enabled && skinOn()) {
            chime();
          }
        }
      }
    }
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });

  browser.storage.local.get({ [KEY]: true }).then((r) => {
    enabled = r[KEY] !== false;
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[KEY]) {
      enabled = changes[KEY].newValue !== false;
    }
  });
})();
