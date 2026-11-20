/**
 * Joget Skin — "全部收起 / 全部展开" button above the property editor sections
 * (content script, top frame only, every builder page).
 *
 * Joget already has icon-only expand/collapse-all buttons in the property header
 * (#expand-all-props-btn / #collapse-all-props-btn, base.jsp:274-279) that call
 * CustomBuilder.expandAllProperties / collapseAllProperties (builder/builder.js:3890-3910):
 * they toggle class "collapsed" on
 *   #right-panel .property-editor-container > .property-editor-pages > .property-editor-page
 * and remember the choice in the builder's localStorage setting "expandProps".
 * This button clicks those same Joget buttons, so Joget's state stays in sync. If the
 * matching Joget button is not visible (its handler ignores hidden buttons), it falls back
 * to the same class change Joget makes.
 *
 * The property editor is re-rendered for each selected element; a MutationObserver puts
 * the button back (one per editor, id-checked). Active only while <html>.joget-skin.
 */
(function () {
  "use strict";

  if (window !== window.top || window.__jskinPropCollapseLoaded) {
    return;
  }
  window.__jskinPropCollapseLoaded = true;

  const ROOT = document.documentElement;
  const SKIN_CLASS = "joget-skin";
  const BAR_CLASS = "jskin-prop-collapse-bar";
  const BTN_CLASS = "jskin-prop-collapse-btn";
  const PAGES_SEL = "#right-panel .property-editor-container > .property-editor-pages";
  const PAGE_SEL = PAGES_SEL + " > .property-editor-page";

  const skinOn = () => ROOT.classList.contains(SKIN_CLASS);
  let busy = false;
  let scheduled = false;

  const visible = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== "none";

  function pages() {
    return [...document.querySelectorAll(PAGE_SEL)].filter(visible);
  }
  function anyExpanded() {
    return pages().some((p) => !p.classList.contains("collapsed"));
  }

  function setAll(collapse) {
    const jogetBtn = document.getElementById(collapse ? "collapse-all-props-btn" : "expand-all-props-btn");
    if (visible(jogetBtn)) {
      jogetBtn.click(); // Joget's own action (also stores the "expandProps" setting)
    }
    // make sure every section matches (fallback, and covers the hidden-button case)
    for (const p of document.querySelectorAll(PAGE_SEL)) {
      p.classList.toggle("collapsed", collapse);
    }
    schedule();
  }

  function label(btn) {
    const collapse = anyExpanded();
    const text = collapse ? "全部收起" : "全部展开";
    const icon = collapse ? "las la-compress" : "las la-expand";
    const i = btn.querySelector("i");
    const s = btn.querySelector("span");
    if (s.textContent !== text) {
      s.textContent = text;
    }
    if (i.className !== icon) {
      i.className = icon;
    }
    if (btn.title !== text) {
      btn.title = text;
    }
  }

  function ensure() {
    const bars = [...document.querySelectorAll("." + BAR_CLASS)];
    const target = skinOn() ? document.querySelector(PAGES_SEL) : null;
    for (const b of bars) {
      if (!target || b.nextElementSibling !== target) {
        b.remove(); // skin off, editor gone, or stale copy from a previous element
      }
    }
    if (!target) {
      return;
    }
    let bar = target.previousElementSibling;
    if (!bar || !bar.classList.contains(BAR_CLASS)) {
      bar = document.createElement("div");
      bar.className = BAR_CLASS;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-light btn-sm " + BTN_CLASS;
      btn.append(document.createElement("i"), document.createTextNode(" "), document.createElement("span"));
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setAll(anyExpanded());
      });
      bar.append(btn);
      target.before(bar);
    }
    label(bar.querySelector("button"));
  }

  function run() {
    scheduled = false;
    busy = true;
    try {
      ensure();
    } finally {
      // let our own mutations flush before listening again
      Promise.resolve().then(() => {
        busy = false;
      });
    }
  }
  function schedule() {
    if (scheduled) {
      return;
    }
    scheduled = true;
    requestAnimationFrame(run);
  }

  new MutationObserver((records) => {
    if (busy) {
      return;
    }
    for (const r of records) {
      const t = r.target;
      if (r.type === "attributes") {
        if (t.classList && t.classList.contains("property-editor-page")) {
          schedule(); // a single section was opened/closed
          return;
        }
        continue;
      }
      if (t.closest && (t.closest("#right-panel") || t === document.body)) {
        schedule();
        return;
      }
    }
  }).observe(document.body || ROOT, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  new MutationObserver(schedule).observe(ROOT, { attributes: true, attributeFilter: ["class"] });
  schedule();
})();
