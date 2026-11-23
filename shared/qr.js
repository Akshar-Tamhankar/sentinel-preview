/* Sentinel: membership QR code rendering.
 *
 * Wraps the local QR generator in public/vendor/qrcode.js (Kazuhiko Arase,
 * MIT license). A membership QR code holds only the random membership code,
 * never a name or points. Error correction level Q survives about 25% damage;
 * a 4-module quiet zone and black on white keep it readable from paper,
 * phone screens, and laptop screens.
 *
 * Classic browser script (window.GameDay.qr) and CommonJS module.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("../vendor/qrcode.js"));
  else {
    root.GameDay = root.GameDay || {};
    root.GameDay.qr = factory(root.qrcode);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (qrcode) {
  "use strict";

  const ERROR_CORRECTION = "Q";
  const QUIET_ZONE = 4; // modules of white border required around the symbol
  const DARK = "#000000";
  const LIGHT = "#ffffff";
  const ALPHANUMERIC = /^[0-9A-Z $%*+\-./:]*$/;

  const escapeAttr = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
          c
        ],
    );

  /** Returns the QR modules as rows of booleans (true = dark), no quiet zone. */
  function matrix(text) {
    if (typeof qrcode !== "function")
      throw new Error("The QR code generator did not load.");
    const value = String(text || "");
    if (!value) throw new Error("There is no membership code to show.");
    const qr = qrcode(0, ERROR_CORRECTION); // 0 = smallest version that fits
    // Membership codes use only uppercase letters and digits, so alphanumeric
    // mode keeps the symbol at version 1 (21 x 21) with large modules.
    qr.addData(value, ALPHANUMERIC.test(value) ? "Alphanumeric" : "Byte");
    qr.make();
    const size = qr.getModuleCount();
    const rows = new Array(size);
    for (let r = 0; r < size; r++) {
      const row = new Array(size);
      for (let c = 0; c < size; c++) row[c] = qr.isDark(r, c);
      rows[r] = row;
    }
    return rows;
  }

  /** One SVG path of horizontal runs: small markup, crisp at any size. */
  function svg(text, { label = "Membership QR code", className = "qr" } = {}) {
    const modules = matrix(text);
    const size = modules.length + QUIET_ZONE * 2;
    let d = "";
    modules.forEach((row, r) => {
      for (let c = 0; c < row.length; ) {
        if (!row[c]) {
          c++;
          continue;
        }
        let end = c;
        while (end < row.length && row[end]) end++;
        d += `M${c + QUIET_ZONE} ${r + QUIET_ZONE}h${end - c}v1h${c - end}z`;
        c = end;
      }
    });
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" class="${escapeAttr(className)}" viewBox="0 0 ${size} ${size}" ` +
      `shape-rendering="crispEdges" role="img" aria-label="${escapeAttr(label)}">` +
      `<rect width="${size}" height="${size}" fill="${LIGHT}"/><path d="${d}" fill="${DARK}"/></svg>`
    );
  }

  const FINDER_ZONE = 8; // finder pattern + separator, in each of 3 corners

  /** ZXing's finder test: runs dark:light:dark:light:dark near 1:1:3:1:1. */
  function finderLike(runs) {
    // Scanners compare pixel runs, so a 1:1:2:1:1 run still passes here.
    const unit = runs.reduce((a, b) => a + b, 0) / 7;
    const slack = unit / 2;
    return (
      Math.abs(unit - runs[0]) < slack &&
      Math.abs(unit - runs[1]) < slack &&
      Math.abs(3 * unit - runs[2]) < 3 * slack &&
      Math.abs(unit - runs[3]) < slack &&
      Math.abs(unit - runs[4]) < slack
    );
  }
  /** Run lengths around index `at` of a line, if it sits in a finder-like run. */
  function crossRuns(line, at) {
    const dark = (i) => line[i] === true; // outside the symbol is quiet zone
    if (!dark(at)) return null;
    const runs = [0, 0, 0, 0, 0];
    let i = at;
    while (dark(i)) (runs[2]++, i--);
    while (i >= 0 && !dark(i)) (runs[1]++, i--);
    while (dark(i)) (runs[0]++, i--);
    i = at + 1;
    while (dark(i)) (runs[2]++, i++);
    while (i < line.length && !dark(i)) (runs[3]++, i++);
    while (dark(i)) (runs[4]++, i++);
    return runs[0] && runs[1] && runs[3] && runs[4] ? runs : null;
  }
  /**
   * True when no module outside the three real finder patterns looks like a
   * finder center both across and down. A false one can make ZXing-based
   * scanners pick the wrong corners, so new codes avoid it.
   */
  function scanFriendly(text) {
    const modules = matrix(text);
    const size = modules.length;
    const inFinder = (r, c) =>
      (r < FINDER_ZONE && (c < FINDER_ZONE || c >= size - FINDER_ZONE)) ||
      (r >= size - FINDER_ZONE && c < FINDER_ZONE);
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++) {
        if (inFinder(r, c) || !modules[r][c]) continue;
        const across = crossRuns(modules[r], c);
        if (!across || !finderLike(across)) continue;
        const down = crossRuns(
          modules.map((row) => row[c]),
          r,
        );
        if (down && finderLike(down)) return false;
      }
    return true;
  }

  return Object.freeze({ ERROR_CORRECTION, QUIET_ZONE, matrix, svg, scanFriendly });
});
