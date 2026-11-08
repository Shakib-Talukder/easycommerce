/* global mobile -- defined by the wrapper in layout-check.ts */
// Evaluated inside the page by layout-check.ts (read as text, wrapped in a function
// that defines `mobile`). Plain JavaScript on purpose: no build step touches it.
// Returns [{ kind, detail }] offences: horizontal scroll, tap targets < 44×44,
// and (on phones) form fields with text smaller than 16 px.
const out = [];
const vw = window.innerWidth;
if (document.documentElement.scrollWidth > vw) {
  out.push({ kind: "h-scroll", detail: "scrollWidth " + document.documentElement.scrollWidth + " > " + vw });
}
const describe = (el) => {
  const text = (el.textContent || el.value || "").trim().replace(/\s+/g, " ").slice(0, 40);
  const id = el.id ? "#" + el.id : "";
  const name = el.getAttribute("name") ? "[name=" + el.getAttribute("name") + "]" : "";
  const aria = el.getAttribute("aria-label") ? "[aria-label=" + el.getAttribute("aria-label") + "]" : "";
  return "<" + el.tagName.toLowerCase() + id + name + aria + '> "' + text + '"';
};
for (const el of document.querySelectorAll(
  "a[href], button, input:not([type=hidden]), select, textarea, summary",
)) {
  const style = getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none") continue;
  const r = el.getBoundingClientRect();
  if (r.width <= 1 || r.height <= 1) continue; // visually hidden (sr-only) or collapsed
  let box = r;
  const label = el.closest("label");
  if (label) {
    const lr = label.getBoundingClientRect();
    if (lr.width >= 44 && lr.height >= 44) box = lr;
  }
  if (box.width < 43.5 || box.height < 43.5) {
    out.push({
      kind: "tap-target",
      detail: describe(el) + " " + Math.round(box.width) + "×" + Math.round(box.height),
    });
  }
  // iOS zooms into text-entry fields with text under 16 px (not checkboxes, colour or file pickers).
  const textEntry = el.matches(
    "select, textarea, input:not([type=checkbox]):not([type=radio]):not([type=color]):not([type=file]):not([type=range]):not([type=submit]):not([type=button])",
  );
  if (mobile && textEntry && parseFloat(style.fontSize) < 16) {
    out.push({ kind: "font-size", detail: describe(el) + " " + style.fontSize });
  }
}
return out;
