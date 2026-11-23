/* ===== home.js: the parts of the home page you can press: the scoreboard and the scan demo.
   The drawn scenes are scene.js. Everything here reads as plain text without JavaScript. ===== */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const QR = window.GameDay && window.GameDay.qr;

  /* ---------- sample QR codes: the app's own encoder ---------- */
  function svgQR(svg, text) {
    if (!svg || !QR) return;
    const m = QR.matrix(text), q = QR.QUIET_ZONE, w = m.length + 2 * q;
    let d = "";
    m.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x + q} ${y + q}h1v1h-1z`; }));
    svg.setAttribute("viewBox", `0 0 ${w} ${w}`);
    svg.innerHTML = `<rect width="${w}" height="${w}" fill="#fff"/><path fill="#06141B" shape-rendering="crispEdges" d="${d}"/>`;
  }
  $$("svg.qr[data-code]").forEach(s => svgQR(s, s.dataset.code));

  /* ---------- the scoreboard: the digits roll. Drag the handle, press - or +, or pick a prize. ---------- */
  const games = $("#games");
  if (games) {
    const g = $("#seg-games"), p = $("#seg-points"), note = $("#board-note");
    const reel = '<span class="roll"><i>' + [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => `<b>${d}</b>`).join("") + "</i></span>";
    const show = (el, n, len) => {
      if (el.dataset.len !== String(len)) { el.innerHTML = `<span class="sr"></span><span class="reels" aria-hidden="true">${reel.repeat(len)}</span>`; el.dataset.len = len; }
      el.firstChild.textContent = n; const t = String(n).padStart(len, "0");
      $$(".roll i", el).forEach((r, i) => r.style.setProperty("--d", t[i]));
    };
    const set = said => {
      const n = +games.value, pts = n * 50; let best = "";
      show(g, n, 2); show(p, pts, 3);
      games.style.setProperty("--v", n / 10); $("#fewer").disabled = n === 0; $("#more").disabled = n === 10;
      games.setAttribute("aria-valuetext", `${n} games, ${pts} points`);
      $$("#prizes li").forEach(li => { const on = pts >= +li.dataset.cost; li.classList.toggle("on", on); if (on) best = li.querySelector("b").textContent; });
      if (note && said) note.textContent = best ? `${pts} points. Enough for: ${best}.` : `${pts} points.`;
    };
    /* It counts up once when you reach it, then waits for you. The handle keeps asking until someone takes it. */
    const board = games.closest(".board"), fewer = $("#fewer"), more = $("#more"); let timer = 0;
    const take = () => { board.classList.add("taken"); clearTimeout(timer); };
    const go = n => { games.value = Math.max(0, Math.min(10, n)); set(true); };
    games.addEventListener("input", () => { take(); set(true); });
    ["pointerdown", "keydown"].forEach(n => games.addEventListener(n, take));
    fewer.addEventListener("click", () => { take(); go(+games.value - 1); });
    more.addEventListener("click", () => { take(); go(+games.value + 1); });
    $$("#prizes li").forEach(li => li.querySelector("button").addEventListener("click", () => { take(); go(Math.ceil(li.dataset.cost / 50)); }));
    set();
    if (!calm && "IntersectionObserver" in window) {
      games.value = 0; set();
      const next = () => { if (+games.value >= 3) return; games.value = +games.value + 1; set(); timer = setTimeout(next, 620); };
      new IntersectionObserver((es, io) => { if (!es[0].isIntersecting) return; io.disconnect(); timer = setTimeout(next, 500); }, { threshold: .5 }).observe(board);
    }
  }

  /* ---------- the scanner: every state the gate shows ---------- */
  const students = [
    { name: "Ava Clark", id: "100234", code: "D7K2M9QX4T26", pts: 150, active: true },
    { name: "Marcus Lee", id: "100871", code: "DH3P8W2RN6C2", pts: 200, active: true },
    { name: "Sophia Nguyen", id: "101102", code: "DQ9T4K7VM2F3", pts: 50, active: true },
    { name: "Jordan Brooks", id: "101455", code: "DW2F7C9PL4M9", pts: 0, active: false },
  ];
  const queue = $("#queue"), result = $("#result"), vf = $("#vf"), sb = $("#scanqr");
  if (!queue) return;
  svgQR(sb, students[0].code);
  students.forEach((st, i) => { const li = document.createElement("li"); li.innerHTML = `<button type="button" aria-pressed="false" data-i="${i}"><b>${st.name}</b>ID ${st.id}</button>`; queue.appendChild(li); });
  const state = (v, cls, html) => { vf.dataset.state = v; result.className = "result"; void result.offsetWidth; result.className = "result " + cls; result.innerHTML = html; };
  let busy = false;
  queue.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b || busy) return;
    const st = students[+b.dataset.i];
    queue.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b));
    svgQR(sb, st.code); busy = true;
    state("scanning", "busy", `<strong>Reading the QR code</strong>Hold it inside the square.`);
    const later = (ms, fn) => setTimeout(fn, calm ? 0 : ms);
    later(650, () => {
      state("checking", "busy", `<strong>Checking ${st.name}</strong>Membership and tonight's check-ins.`);
      later(420, () => {
        busy = false;
        if (!st.active) return state("no", "no", `<strong>This membership is inactive or expired</strong>No points added. The athletics office can activate it.`);
        if (st.in) return state("no", "no", `<strong>Already checked in</strong>${st.name} already got points for this game.`);
        st.in = true; st.pts += 50;
        state("ok", "ok", `<strong>${st.name} checked in</strong><span class="plus">+50</span>Balance is now ${st.pts} points.`);
      });
    });
  });
  const again = $("#scan-reset");
  if (again) again.addEventListener("click", () => { students.forEach((s, i) => { if (s.in) { s.in = false; s.pts -= 50; } }); queue.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", "false")); svgQR(sb, students[0].code); state("idle", "", "<strong>Pick a student to scan</strong>The result shows up here."); });
})();
