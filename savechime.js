/**
 * Joget Skin — save chime (content script, top frame of builder pages; needs chime-sound.js).
 * Pages: /jw/web/console/app/{appId}/{version}/{form|datalist|userview|process|...}/builder/{id}
 *
 * Detection (fastest first, deduped per save):
 *  1. jQuery "ajaxSuccess" for CustomBuilder.saveUrl with response {success:true}
 *     (Firefox: hooked through window.wrappedJSObject) — fires in the same task as the response.
 *  2. Fallback: Joget's ".toast-success" ("Builder Saved") added to #builder-message while armed.
 *  Failures ({success:false} / HTTP error / ".toast-danger") never play.
 *
 * Latency: on Save click / Ctrl(Cmd)+S — inside the user gesture — the AudioContext is created
 * or resumed and a silent keep-warm source starts, so the audio device is already running when
 * the response arrives (a cold macOS/Bluetooth output can add a few hundred ms otherwise).
 * If WebAudio can't run (autoplay blocked), a pre-rendered WAV is played via HTMLAudioElement.
 *
 * Settings (browser.storage.local, live): "jogetSkinSaveChime" (default true),
 * "jogetSkinChimeSound" ("soft" | "marimba" | "bubble", default "soft").
 * Only while the skin is on. Diagnostics: console.debug "[joget-skin] chime: ...".
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

  const Chime = globalThis.JogetSkinChime;
  const KEY = "jogetSkinSaveChime";
  const SOUND_KEY = "jogetSkinChimeSound";
  const ARM_MS = 60000;
  const WARM_MS = 20000;

  let enabled = true;
  let sound = Chime.DEFAULT;
  let armedAt = 0;
  let playedAt = 0;
  let ctx = null;
  let warm = null; // { src, timer }
  let wavUrl = null;
  let wavFor = null;

  const log = (...a) => console.debug("[joget-skin] chime:", ...a);
  const active = () => enabled && document.documentElement.classList.contains("joget-skin");

  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) {
        return null;
      }
      try {
        ctx = new AC({ latencyHint: "interactive" });
      } catch (e) {
        ctx = new AC();
      }
    }
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  // silent source keeps the audio graph/device running until the chime plays
  function keepWarm() {
    const ac = audio();
    if (!ac) {
      return;
    }
    if (!warm) {
      const src = ac.createConstantSource ? ac.createConstantSource() : ac.createOscillator();
      const g = ac.createGain();
      g.gain.value = 0;
      src.connect(g);
      g.connect(ac.destination);
      src.start();
      warm = { src, timer: 0 };
    }
    clearTimeout(warm.timer);
    warm.timer = setTimeout(stopWarm, WARM_MS);
  }

  function stopWarm() {
    if (warm) {
      clearTimeout(warm.timer);
      try {
        warm.src.stop();
      } catch (e) {
        /* already stopped */
      }
      warm = null;
    }
  }

  async function prepareWav() {
    if (wavFor === sound && wavUrl) {
      return;
    }
    try {
      const blob = await Chime.renderWav(sound);
      if (wavUrl) {
        URL.revokeObjectURL(wavUrl);
      }
      wavUrl = URL.createObjectURL(blob);
      wavFor = sound;
    } catch (e) {
      log("wav render failed", e && e.message);
    }
  }

  function playFallback(reason) {
    if (!wavUrl) {
      log("blocked (" + reason + "; no fallback audio)");
      return;
    }
    const el = new Audio(wavUrl);
    el.volume = 1;
    el.play().then(
      () => log("played (HTMLAudio fallback; webaudio " + reason + ")"),
      (e) => log("blocked (" + reason + "; HTMLAudio " + (e && e.name) + ")")
    );
  }

  function play(source, sinceResponseMs) {
    const now = performance.now();
    if (now - playedAt < 1500) {
      return; // already played for this save (other detector)
    }
    playedAt = now;
    armedAt = 0;
    log("success via " + source + (sinceResponseMs != null ? " (+" + sinceResponseMs.toFixed(1) + " ms after response)" : ""));
    const ac = audio();
    if (ac && ac.state === "running") {
      const end = Chime.play(ac, sound);
      const lat = ((ac.baseLatency || 0) + (ac.outputLatency || 0)) * 1000;
      log("played (webaudio, " + (warm ? "warm" : "cold") + ", output latency ~" + lat.toFixed(0) + " ms)");
      document.documentElement.setAttribute(
        "data-jskin-last-chime",
        Date.now() + " " + ac.state + " " + (warm ? "warm" : "cold") + " " + now.toFixed(1) + " " + source.replace(/ /g, "_") + " " + lat.toFixed(0)
      ); // debug aid: epoch state warm/cold perf.now source output-latency-ms
      if (warm) {
        clearTimeout(warm.timer);
        warm.timer = setTimeout(stopWarm, Math.max(0, (end - ac.currentTime) * 1000) + 300);
      }
      return;
    }
    playFallback(ac ? "context " + ac.state : "no AudioContext");
    document.documentElement.setAttribute("data-jskin-last-chime", Date.now() + " " + (ac ? ac.state : "none") + " fallback " + now.toFixed(1));
  }

  function arm(how) {
    armedAt = Date.now();
    if (active()) {
      keepWarm(); // inside the gesture when there is one
      log("armed (" + how + ", context " + (ctx ? ctx.state : "none") + ")");
    }
  }

  // Unlock audio on the first user gesture (autoplay policy); arm on Save click / Ctrl(Cmd)+S.
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!active()) {
        return;
      }
      audio();
      if (e.target.closest && e.target.closest("#save-btn, #save-btn-toolbar")) {
        arm("button");
      }
    },
    true
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (!active()) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
        audio();
        arm(e.metaKey ? "cmd+s" : "ctrl+s");
      }
    },
    true
  );

  // 1. jQuery ajaxSuccess on the save URL (Firefox page access via wrappedJSObject)
  let hooked = false;
  function hookAjax() {
    if (hooked) {
      return true;
    }
    try {
      const pw = window.wrappedJSObject;
      if (!pw || !pw.jQuery || typeof exportFunction !== "function") {
        return false;
      }
      const onSuccess = (ev, xhr, settings, data) => {
        try {
          const saveUrl = pw.CustomBuilder && pw.CustomBuilder.saveUrl;
          if (!saveUrl || !settings || settings.url !== saveUrl) {
            return;
          }
          let ok = data && data.success === true;
          if (!ok && xhr && typeof xhr.responseText === "string") {
            ok = /"success"\s*:\s*true/.test(xhr.responseText);
          }
          if (!ok) {
            armedAt = 0;
            log("save failed (server) — no sound");
            return;
          }
          if (active()) {
            play("save response");
          }
        } catch (e) {
          log("hook error", e && e.message);
        }
      };
      pw.jQuery(pw.document).on("ajaxSuccess", exportFunction(onSuccess, window));
      pw.jQuery(pw.document).on(
        "ajaxError",
        exportFunction((ev, xhr, settings) => {
          if (settings && pw.CustomBuilder && settings.url === pw.CustomBuilder.saveUrl) {
            armedAt = 0;
            log("save failed (HTTP) — no sound");
          }
        }, window)
      );
      hooked = true;
      log("hooked save response");
      return true;
    } catch (e) {
      log("hook unavailable", e && e.message);
      return false;
    }
  }
  if (!hookAjax()) {
    const retry = setInterval(() => {
      if (hookAjax()) {
        clearInterval(retry);
      }
    }, 500);
    setTimeout(() => clearInterval(retry), 15000);
  }

  // 2. fallback: Joget's success toast / save spinner (also arms when save starts without our gesture)
  function isSaveSpinner(el) {
    return el.matches && el.matches("#save-btn > i, #save-btn-toolbar > i") && el.classList.contains("fa-spinner");
  }
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "attributes") {
        if (isSaveSpinner(r.target) && Date.now() - armedAt > 2000) {
          arm("save started");
        }
        continue;
      }
      for (const n of r.addedNodes) {
        if (n.nodeType !== 1 || !n.classList.contains("toast") || !n.parentElement || n.parentElement.id !== "builder-message") {
          continue;
        }
        if (n.classList.contains("toast-danger")) {
          armedAt = 0;
        } else if (n.classList.contains("toast-success") && armedAt && Date.now() - armedAt < ARM_MS && active()) {
          play("success message");
        }
      }
    }
  }).observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });

  browser.storage.local.get({ [KEY]: true, [SOUND_KEY]: Chime.DEFAULT }).then((r) => {
    enabled = r[KEY] !== false;
    sound = Chime.SOUNDS[r[SOUND_KEY]] ? r[SOUND_KEY] : Chime.DEFAULT;
    prepareWav();
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") {
      return;
    }
    if (changes[KEY]) {
      enabled = changes[KEY].newValue !== false;
    }
    if (changes[SOUND_KEY]) {
      sound = Chime.SOUNDS[changes[SOUND_KEY].newValue] ? changes[SOUND_KEY].newValue : Chime.DEFAULT;
      prepareWav();
    }
  });
})();
