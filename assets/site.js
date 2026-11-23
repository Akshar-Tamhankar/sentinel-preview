/* =====================================================================
   site.js: shared by every page. Loaded with `defer`, so the DOM is ready.
   Every part checks that its elements exist, so a page can leave any out.
   Pages must read fully without this file: it only adds behaviour.
   ===================================================================== */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ---------- mobile menu ----------
     Without JavaScript the "Menu" link jumps to the footer navigation.
     With it, the link becomes a real button that opens the header links as a panel.
     Closes on Escape (focus goes back to the button), a link choice, a click or focus outside the header,
     and when the window grows past the mobile breakpoint. */
  const bar = $(".bar"), menuLink = bar && $("a.menu-btn", bar), panel = $("#site-menu");
  if (menuLink && panel) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = menuLink.className;
    btn.innerHTML = menuLink.innerHTML;
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-controls", panel.id);
    menuLink.replaceWith(btn);
    const isOpen = () => bar.classList.contains("open");
    const set = open => { bar.classList.toggle("open", open); btn.setAttribute("aria-expanded", String(open)); };
    btn.addEventListener("click", () => set(!isOpen()));
    document.addEventListener("keydown", e => { if (e.key === "Escape" && isOpen()) { set(false); btn.focus(); } });
    document.addEventListener("click", e => { if (isOpen() && !bar.contains(e.target)) set(false); });
    bar.addEventListener("focusout", e => { if (isOpen() && e.relatedTarget && !bar.contains(e.relatedTarget)) set(false); });
    panel.addEventListener("click", e => { if (e.target.closest("a")) set(false); });
    const wide = matchMedia("(min-width: 981px)");
    const onWide = e => { if (e.matches) set(false); };
    wide.addEventListener ? wide.addEventListener("change", onWide) : wide.addListener(onWide);
  }

  /* ---------- the header: clear at the top, gone while you scroll down, back (and solid) when you scroll up ---------- */
  if (bar) {
    let last = scrollY, turn = last;
    const move = () => {
      const y = Math.max(0, scrollY);
      if ((y > last) !== (last > turn)) turn = last;
      bar.classList.toggle("solid", y > 60);
      if (y < 80) bar.classList.remove("away"); else if (y > turn + 24) bar.classList.add("away"); else if (y < turn - 24) bar.classList.remove("away");
      last = y;
    };
    addEventListener("scroll", move, { passive: true }); move();
  }

  /* ---------- tabs: any [role=tablist] with [role=tab] buttons that aria-control a panel ----------
     Arrow keys move between tabs in the same list; Home and End jump to the ends. */
  $$('[role="tablist"]').forEach(list => {
    const tabs = $$('[role="tab"]', list);
    const pick = t => {
      tabs.forEach(x => {
        const on = x === t, p = document.getElementById(x.getAttribute("aria-controls"));
        x.setAttribute("aria-selected", on); x.tabIndex = on ? 0 : -1;
        if (p) p.hidden = !on;
      });
      t.focus();
    };
    tabs.forEach((t, i) => {
      t.addEventListener("click", () => pick(t));
      t.addEventListener("keydown", e => {
        const n = tabs.length, to = { ArrowRight: (i + 1) % n, ArrowLeft: (i + n - 1) % n, Home: 0, End: n - 1 }[e.key];
        if (to === undefined) return;
        e.preventDefault(); pick(tabs[to]);
      });
    });
  });

  /* ---------- print buttons: hidden in the HTML (they need JS), shown here ---------- */
  if (typeof window.print === "function") $$("button[data-print]").forEach(b => { b.hidden = false; b.addEventListener("click", () => window.print()); });

  /* ---------- pilot form ----------
     Sends nothing itself. With an address in data-to, it opens the visitor's mail app with the request filled in;
     while data-to is empty or a [[placeholder]], it says plainly that requests aren't connected yet. */
  $$("form.pilot-form").forEach(f => {
    const done = $(".done", f);
    const err = (input, text) => {
      const e = document.getElementById(input.getAttribute("aria-describedby"));
      input.setAttribute("aria-invalid", text ? "true" : "false"); if (e) e.textContent = text;
      return !!text;
    };
    f.addEventListener("submit", e => {
      e.preventDefault();
      const school = f.school.value.trim();
      const a = err(f.school, school ? "" : "Enter your school's name.");
      const b = err(f.email, f.email.value && f.email.checkValidity() ? "" : "Enter an email like name@school.org.");
      if (done) done.textContent = "";
      if (a || b) { (a ? f.school : f.email).focus(); return; }
      const to = (f.dataset.to || "").trim();
      if (!/^[^\s@\[\]]+@[^\s@\[\]]+\.[^\s@\[\]]+$/.test(to)) { if (done) done.textContent = "Pilot requests aren't connected yet, so nothing was sent."; return; }
      location.href = `mailto:${to}?subject=${encodeURIComponent("Sentinel pilot: " + school)}&body=${encodeURIComponent(`School: ${school}\nRole: ${f.role.value}\nEmail: ${f.email.value}`)}`;
      if (done) done.textContent = "Your mail app should open with the request. Send it from there.";
    });
  });

  /* ---------- draft review helper ----------
     Open any page with ?review in the URL to outline every promise that still needs the owner's yes (data-confirm).
     It also reports in the console (review mode only) if any [[placeholder]] is still on the page.
     Safe to delete once every promise is confirmed and every placeholder is filled. */
  let review = false;
  try { review = new URLSearchParams(location.search).has("review"); } catch (e) { /* very old browsers: no review mode */ }
  if (review) {
    document.documentElement.classList.add("tr-review");
    const open = document.querySelectorAll("[data-confirm]").length;
    const holes = (document.body.innerText.match(/\[\[[^\]]+\]\]/g) || []).length;
    if (open || holes) console.warn(`Sentinel draft: ${open} promise(s) need the owner's yes, ${holes} placeholder(s) still to fill.`);
  }
})();
