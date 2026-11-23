/* Sentinel app shell: student, gate, and admin screens.
 *
 * Talks to the server through one api() helper. With ?demo=student,
 * ?demo=staff, or ?demo=admin in the address, api() is routed to the
 * browser-only demo backend (/sentinel-preview/app/demo-api.js) instead, and no request
 * reaches a server. Depends on window.GameDay.rules and window.GameDay.qr.
 */
(function () {
"use strict";

const { rules, qr } = window.GameDay || {};
const REQUEST_TIMEOUT_MS = 15000;
const TOAST_MS = 4500;
const SEARCH_DEBOUNCE_MS = 180;
const SCAN_FPS = 10; // enough for a gate line; keeps mid-range phones cool
const SCAN_BOX_RATIO = 0.7; // decode only the center of the frame
const SCAN_HINT_MS = 8000;
const GATE_LIST_LIMIT = 30;
const GATE_RECENT_LIMIT = 8;
const SCANNER_SCRIPT = "/sentinel-preview/vendor/html5-qrcode.min.js";
const DEMO_SCRIPT = "/sentinel-preview/app/demo-api.js";
const FIREBASE_SCRIPT = "/sentinel-preview/vendor/firebase-auth.bundle.js";
const DEMO_ROLES = ["student", "staff", "admin"];
const NETWORK = Object.freeze({
  offline:
    "You are offline. Nothing was saved. Reconnect to the internet and try again.",
  unreachable:
    "The server could not be reached. Nothing was saved. Check the connection and try again.",
  slowRead:
    "The server is taking too long to answer. Check the connection and try again.",
  slowWrite:
    "The server did not confirm this change. Check the connection, refresh, and check whether it went through before you try again.",
  server: "The server had a problem. Wait a moment and try again.",
  generic: "Unable to complete this request.",
});

const query = new URLSearchParams(location.search);
const BROWSER_DEMO = query.has("demo");
const DEMO_ROLE_PARAM = DEMO_ROLES.includes(query.get("demo"))
  ? query.get("demo")
  : null;
let backend = null; // browser-only demo backend, when BROWSER_DEMO

/** Storage that never throws (private windows and strict settings block it). */
const safeSession = {
  get(key) {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      window.sessionStorage.setItem(key, value);
    } catch {
      /* the gate still works; it just forgets the chosen event */
    }
  },
  remove(key) {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      /* nothing to remove */
    }
  },
};

const scriptLoads = new Map();
function loadScript(src, failure) {
  if (!scriptLoads.has(src))
    scriptLoads.set(
      src,
      new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.onload = resolve;
        script.onerror = () => {
          scriptLoads.delete(src);
          script.remove();
          reject(new Error(failure));
        };
        document.head.appendChild(script);
      }),
    );
  return scriptLoads.get(src);
}

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const paths = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13M12 8C4 9 5 2 8 3c3 0 4 5 4 5s1-5 4-5c3-1 4 6-4 5Z"/>',
  history: '<path d="M3 11a9 9 0 1 1 2.6 7M3 4v7h7M12 7v5l3 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  users:
    '<circle cx="9" cy="8" r="3"/><path d="M2 21v-2a7 7 0 0 1 14 0v2M16 5a3 3 0 0 1 0 6M19 15a6 6 0 0 1 3 5"/>',
  scan: '<path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M7 8v8M10 8v8M14 8v8M17 8v8"/>',
  star: '<path d="m12 3 2.8 5.6 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.5l6.2-.9z"/>',
  trophy:
    '<path d="M8 3h8v7a4 4 0 0 1-8 0zM8 5H4v3a4 4 0 0 0 4 4M16 5h4v3a4 4 0 0 1-4 4M12 14v6M8 21h8"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  ticket:
    '<path d="M3 6h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4zM15 6v3M15 11v2M15 15v3"/>',
  shirt: '<path d="m8 3-6 4 3 5 3-2v11h8V10l3 2 3-5-6-4a4 4 0 0 1-8 0Z"/>',
  ball: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18M5 5a10 10 0 0 1 0 14M19 5a10 10 0 0 0 0 14"/>',
  chart:
    '<rect x="3" y="13" width="4" height="8" rx="1"/><rect x="10" y="8" width="4" height="13" rx="1"/><rect x="17" y="3" width="4" height="18" rx="1"/>',
  camera:
    '<path d="M8 5 6 8H3v12h18V8h-3l-2-3z"/><circle cx="12" cy="13" r="4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bag: '<path d="M5 7h14l2 14H3zM8 8V6a4 4 0 0 1 8 0v2"/>',
  qr: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14v1M14 20h1M18 18h3v3h-3"/>',
  image:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
};
const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.star}</svg>`;
const fmtDate = (v, options = {}) =>
  new Date(`${v}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...options,
  });
const fmtTime = (v) =>
  new Date(v).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const fmtStart = (e) =>
  e.time
    ? new Date(`${e.date}T${e.time}:00`).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })
    : "Time TBA";
const today = () => rules.schoolToday();
// Show codes in groups of four so they are easy to read aloud and type.
const groupCode = (code) => String(code || "").replace(/(.{4})(?=.)/g, "$1 ");
const num = (n) => Number(n || 0).toLocaleString("en-US");
const state = { user: null, demo: false, render: 0, cleanup: null };
const NAV = {
  student: [
    ["home", "Dashboard", "home"],
    ["schedule", "Upcoming games", "calendar"],
    ["shop", "Reward shop", "gift"],
    ["history", "My activity", "history"],
    ["account", "My profile", "user"],
  ],
  staff: [
    ["gate", "Gate check-in", "scan"],
    ["account", "My account", "user"],
  ],
  admin: [
    ["overview", "Overview", "chart"],
    ["gate", "Gate check-in", "scan"],
    ["events", "Events", "calendar"],
    ["members", "Members", "users"],
    ["rewards", "Rewards", "gift"],
    ["orders", "Prize pickups", "bag"],
    ["account", "My account", "user"],
  ],
};
const VIEWS = {};
let toastTimer;
function toast(message, error = false) {
  const el = $("#toast");
  el.textContent = message;
  el.className = error ? "error" : "";
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, TOAST_MS);
}
function apiError(message, status = 0, network = false) {
  const err = new Error(message);
  err.status = status;
  err.network = network;
  return err;
}
/**
 * The only way screens talk to a backend. Same contract in both modes:
 * resolves with the JSON body (or CSV text), rejects with a readable Error.
 */
async function api(method, url, body) {
  if (backend) {
    // Browser demo: a structured copy keeps the demo state isolated.
    const result = backend.handle(
      method,
      url,
      body === undefined ? undefined : JSON.parse(JSON.stringify(body)),
    );
    await Promise.resolve();
    if (result.status >= 400)
      throw apiError(result.data?.error || NETWORK.generic, result.status);
    return result.text !== undefined ? result.text : result.data;
  }
  const writes = method !== "GET";
  // Never queue a check-in or order while offline: refuse and say so.
  if (writes && navigator.onLine === false)
    throw apiError(NETWORK.offline, 0, true);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "rewards-app",
      },
      signal: controller.signal,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (err) {
    throw apiError(
      err?.name === "AbortError"
        ? writes
          ? NETWORK.slowWrite
          : NETWORK.slowRead
        : navigator.onLine === false
          ? NETWORK.offline
          : NETWORK.unreachable,
      0,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
  let data = {};
  try {
    data = await response.json();
  } catch {
    /* a proxy error page or an empty body */
  }
  if (!response.ok)
    throw apiError(
      data.error ||
        (response.status >= 500 ? NETWORK.server : NETWORK.generic),
      response.status,
    );
  return data;
}
const btn = (text, id, style = "", ico = "") =>
  `<button class="btn ${style}" type="button" ${id ? `id="${id}"` : ""}>${ico ? icon(ico) : ""}${text}</button>`;
const link = (text, route, style = "text-link") =>
  `<a class="${style}" href="#/${route}">${text}${icon("arrow")}</a>`;
const empty = (text, ico = "calendar") =>
  `<div class="empty">${icon(ico)}${text}</div>`;
const pill = (label, style = "") =>
  `<span class="pill ${style}">${esc(label)}</span>`;
function heading(title, sub, action = "") {
  return `<div class="page-heading"><div><h1>${title}</h1><p>${sub}</p></div>${action}</div>`;
}
/** Inline SVG QR code for a membership code, or a readable fallback. */
function membershipQr(code) {
  if (!code)
    return '<p class="error-message small">No membership QR code is assigned yet. Ask the program admin.</p>';
  try {
    return `<div class="qr-wrap" data-code="${esc(code)}">${qr.svg(code)}</div>`;
  } catch {
    return `<p class="error-message small" data-code="${esc(code)}">The QR code could not be drawn. Reload the page, or give the gate worker the code below.</p>`;
  }
}
function membershipStatus(m) {
  if (m.valid) return pill("Active member", "active");
  if (m.active && m.expires && m.expires < today())
    return pill("Membership expired", "inactive");
  return pill("Inactive membership", "inactive");
}
function membershipCard(u) {
  const m = u.membership || {};
  return `<section class="card membership-card"><div class="membership-top"><div class="membership-brand"><span>Membership card</span>${icon("qr")}</div><div class="membership-name">${esc(u.name)}</div><div class="membership-id">Student ID · ${esc(u.studentNumber)}</div></div><div class="membership-bottom">${membershipQr(m.tag)}<div class="member-code" aria-label="Membership code">${esc(groupCode(m.tag))}</div><div class="membership-meta">${membershipStatus(m)}<span>Through ${m.expires ? fmtDate(m.expires, { year: "numeric" }) : "not set"}</span></div><div class="membership-actions">${btn("View or print QR code", "print-my-tag", "small wide", "download")}</div></div></section>`;
}
function showDialog(title, sub, body, onSave, saveLabel = "Save changes") {
  const dialog = $("#dialog");
  dialog.classList.remove("student-profile-dialog");
  delete dialog.dataset.profileUser;
  $("#dialog-content").innerHTML =
    `<div class="dialog-head"><h2 id="dialog-title">${title}</h2><button type="button" data-close aria-label="Close dialog">×</button></div>${sub ? `<p class="dialog-sub">${sub}</p>` : ""}<form id="dialog-form">${body}<div id="form-error" role="alert" hidden></div><div class="dialog-actions">${btn("Cancel", "", "", "")}<button class="btn primary" type="submit">${saveLabel}</button></div></form>`;
  dialog.setAttribute("aria-labelledby", "dialog-title");
  $("[data-close]", dialog).onclick = () => dialog.close();
  $(".dialog-actions button[type=button]", dialog).onclick = () =>
    dialog.close();
  $("#dialog-form").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget,
      submit = $("button[type=submit]", form),
      error = $("#form-error");
    submit.disabled = true;
    error.hidden = true;
    try {
      await onSave(Object.fromEntries(new FormData(form)), form);
      dialog.close();
    } catch (err) {
      error.textContent = err.message;
      error.className = "form-error";
      error.hidden = false;
    } finally {
      submit.disabled = false;
    }
  };
  dialog.showModal();
}
function printTag(u) {
  const dialog = $("#dialog");
  dialog.classList.remove("student-profile-dialog");
  delete dialog.dataset.profileUser;
  dialog.setAttribute("aria-label", "Printable membership QR code");
  dialog.removeAttribute("aria-labelledby");
  const own = state.user?.id === u.id;
  $("#dialog-content").innerHTML =
    `<div class="dialog-head"><h2>${own ? "Your membership QR code" : `Membership QR code for ${esc(u.name)}`}</h2><button type="button" id="close-tag" aria-label="Close">×</button></div><p class="print-note">Print this QR code or save it as an SVG. Show it at the gate after your admission is checked. A phone screen works too.</p><div class="print-card"><h2>Sentinel</h2><p>Sample High School membership card</p><h3>${esc(u.name)}</h3><p>Student ID ${esc(u.studentNumber)}</p>${membershipQr(u.membership?.tag)}<div class="member-code">${esc(groupCode(u.membership?.tag))}</div></div><div class="dialog-actions">${btn("Save QR code", "save-tag", "", "download")}${btn("Print QR code", "print-tag", "primary")}</div>`;
  dialog.showModal();
  $("#close-tag").onclick = () => dialog.close();
  $("#print-tag").onclick = () => window.print();
  $("#save-tag").onclick = () => {
    const svg = $(".print-card svg.qr", dialog);
    if (!svg)
      return toast(
        "The QR code is not available to save. Reload the page and try again.",
        true,
      );
    downloadFile(
      new XMLSerializer().serializeToString(svg),
      "image/svg+xml",
      `sentinel-qr-code-${u.studentNumber || "member"}.svg`,
    );
  };
}
function downloadFile(content, type, filename) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function activityList(ledger) {
  return ledger.length
    ? ledger
        .map(
          (l) =>
            `<div class="activity-item"><div class="activity-badge">${icon(l.delta > 0 ? "star" : "gift")}</div><div class="activity-info"><strong>${esc(l.reason)}</strong><span>${fmtTime(l.at)}</span></div><span class="delta ${l.delta < 0 ? "negative" : ""}">${l.delta > 0 ? "+" : ""}${num(l.delta)}</span></div>`,
        )
        .join("")
    : empty("No check-ins yet.", "star");
}
function eventList(events) {
  return events.length
    ? events
        .map(
          (e) =>
            `<div class="event-item"><div class="event-date"><span>${fmtDate(e.date, { day: undefined })}</span><strong>${new Date(`${e.date}T12:00:00`).getDate()}</strong></div><div class="event-content">${e.open ? pill("Gate open", "live") : ""}<strong>${esc(e.name)}</strong><p>${esc(e.sport)} · ${fmtStart(e)} · ${esc(e.location)}</p></div><div class="event-points">+${num(e.points)} <span>pts</span></div></div>`,
        )
        .join("")
    : empty("More games are on the way. Check back soon.");
}

VIEWS.home = async () => {
  const [{ events }, activity, { rewards }] = await Promise.all([
    api("GET", "/api/events"),
    api("GET", "/api/me/activity"),
    api("GET", "/api/rewards"),
  ]);
  const u = state.user,
    next =
      rewards
        .filter((r) => r.stock !== 0)
        .sort((a, b) => a.cost - b.cost)
        .find((r) => r.cost > u.points) || rewards.find((r) => r.stock !== 0);
  const games = events.filter((e) => e.open || e.date >= today()).slice(0, 3);
  const pending = activity.orders.filter((o) => o.status === "pending").length;
  return {
    html:
      heading(
        `Hi, ${esc(u.name.split(" ")[0])}.`,
        "Your points, your QR code and the next games.",
        `<div class="date-chip">${icon("calendar")}${new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" })}</div>`,
      ) +
      `
    <div class="grid dashboard-grid"><div class="stack"><section class="card points-hero"><div class="field-art" aria-hidden="true"></div><div class="hero-main"><p class="eyebrow">Your points</p><div class="balance">${num(u.points)}<span>points</span></div><p class="hero-caption">Points for each game you check in at.</p></div><div class="hero-foot">${icon("star")}Spend them in the reward shop.</div></section>
    <div class="mini-stats"><div class="mini-stat">${icon("ticket")}<strong>${num(activity.attended)}</strong><span>Games attended</span></div><div class="mini-stat">${icon("gift")}<strong>${num(activity.orders.filter((o) => o.status !== "cancelled").length)}</strong><span>Rewards reserved</span></div><div class="mini-stat">${icon("bag")}<strong>${num(pending)}</strong><span>Ready for pickup</span></div></div>
    <section class="card"><div class="card-top"><h2>Next games</h2>${link("All games", "schedule")}</div>${eventList(games)}</section>
    <section class="card"><div class="card-top"><h2>Latest activity</h2>${link("View activity", "history")}</div>${activityList(activity.ledger.slice(0, 3))}</section></div>
    <div class="stack">${membershipCard(u)}<section class="card"><div class="card-top"><h2>Your next reward</h2>${icon("gift")}</div>${next ? `<div class="reward-preview"><div class="reward-icon">${icon(/shirt/i.test(next.name) ? "shirt" : "ticket")}</div><div><h3>${esc(next.name)}</h3><p>${num(next.cost)} points to redeem</p></div></div><div class="progress-top"><span>${num(Math.min(u.points, next.cost))} / ${num(next.cost)} pts</span><strong>${u.points >= next.cost ? "Unlocked!" : `${num(next.cost - u.points)} to go`}</strong></div><div class="progress" role="progressbar" aria-label="Points toward next reward" aria-valuenow="${Math.min(u.points, next.cost)}" aria-valuemin="0" aria-valuemax="${next.cost}"><span style="width:${Math.min(100, (u.points / next.cost) * 100)}%"></span></div><div class="section-gap">${link("See the reward shop", "shop")}</div>` : empty("New rewards are coming soon.", "gift")}</section>
    <section class="card"><h2>How points work</h2><ol class="steps section-gap"><li><div><strong>Get your game ticket</strong>Buy admission separately on GoFan.</div></li><li><div><strong>Bring your membership QR code</strong>A worker checks admission, then scans your QR code from paper or your phone.</div></li><li><div><strong>Get your points</strong>They land in your account right away.</div></li></ol></section></div></div>`,
    mount() {
      $("#print-my-tag").onclick = () => printTag(u);
    },
  };
};

VIEWS.schedule = async () => {
  const { events } = await api("GET", "/api/events");
  const { attendance } = await api("GET", "/api/me/attendance");
  return {
    html:
      heading(
        "Upcoming games",
        "Games and how many points each one is worth.",
      ) +
      `<div class="notice">${icon("info")}Purchase admission separately through your school’s GoFan page. Your rewards membership does not include a game ticket.</div><div class="events-grid section-gap">${events.length ? events.map((e) => `<article class="card event-card"><div class="event-cover"><span class="sport">${esc(e.sport)}</span>${icon("ball")}</div><h3>${esc(e.name)}</h3><p>${fmtDate(e.date, { weekday: "short", year: "numeric" })} · ${fmtStart(e)}</p><p>${esc(e.location)}</p><div class="event-card-foot"><span class="event-points">+${num(e.points)} <span>points</span></span>${attendance.some((a) => a.eventId === e.id) ? pill("Checked in", "active") : e.open ? pill("Gate open", "live") : pill(e.date < today() ? "Past event" : "Upcoming", "blue")}</div></article>`).join("") : `<div class="card empty-state">${empty("No games scheduled yet.")}</div>`}</div>`,
  };
};

VIEWS.shop = async () => {
  const { rewards } = await api("GET", "/api/rewards");
  const u = state.user;
  return {
    html:
      heading(
        "Reward shop",
        "Reserve a prize with your points, then pick it up at the athletics office.",
        `<div class="shop-balance">${icon("star")}<strong>${num(u.points)}</strong> pts available</div>`,
      ) +
      `<div class="rewards-grid">${rewards.length ? rewards.map((r, i) => `<article class="card reward-card"><div class="reward-art art-${i % 3}">${icon(/shirt/i.test(r.name) ? "shirt" : /voucher/i.test(r.name) ? "ticket" : "gift")}</div><div class="reward-info"><div>${pill(r.stock === 0 ? "Sold out" : r.stock === null ? "Available" : `${r.stock} available`, r.stock === 0 ? "inactive" : "blue")}</div><h2>${esc(r.name)}</h2><p>${esc(r.description)}</p><div class="reward-price">${num(r.cost)} <span>points</span></div><button class="btn ${u.points >= r.cost && r.stock !== 0 ? "primary" : ""}" data-order="${esc(r.id)}" ${r.stock === 0 || u.points < r.cost || !u.membership?.valid ? "disabled" : ""}>${r.stock === 0 ? "Sold out" : !u.membership?.valid ? "Active membership required" : u.points < r.cost ? `${num(r.cost - u.points)} more points to go` : "Reserve reward"}</button></div></article>`).join("") : `<div class="card empty-state">${empty("The reward shop is being restocked.", "gift")}</div>`}</div><div class="notice section-gap">${icon("bag")}Reserving a reward deducts your points and holds the item. Bring your school ID to the athletics office for pickup. Check My activity for your order status.</div>`,
    mount() {
      $$("[data-order]").forEach(
        (b) =>
          (b.onclick = () => {
            const r = rewards.find((r) => r.id === b.dataset.order);
            showDialog(
              "Reserve this prize?",
              `Reserve ${esc(r.name)} for ${num(r.cost)} points.`,
              `<div class="notice">${icon("gift")}Your balance after this reservation: ${num(u.points - r.cost)} points.</div>`,
              async () => {
                await api("POST", `/api/rewards/${r.id}/order`, {});
                toast("Reward reserved. Pick it up at the athletics office.");
                route();
              },
              "Reserve reward",
            );
          }),
      );
    },
  };
};

VIEWS.history = async () => {
  const activity = await api("GET", "/api/me/activity");
  return {
    html:
      heading(
        "My activity",
        "Every game you checked in at and every point you earned or spent.",
      ) +
      `<div class="grid two-column"><section class="card"><div class="card-top"><h2>Points activity</h2>${pill(`${activity.attended} games attended`, "blue")}</div>${activityList(activity.ledger)}</section><section class="card"><h2>Your rewards</h2><p class="card-subtitle">Pending reservations are ready for athletics office pickup.</p>${activity.orders.length ? activity.orders.map((o) => `<div class="activity-item"><div class="activity-badge">${icon("gift")}</div><div class="activity-info"><strong>${esc(o.rewardName)}</strong><span>${fmtTime(o.createdAt)} · ${num(o.cost)} pts</span></div>${pill({ pending: "Ready for pickup", fulfilled: "Collected", cancelled: "Canceled" }[o.status], o.status)}</div>`).join("") : empty("Your first reward is waiting in the shop.", "gift")}</section></div>`,
  };
};

VIEWS.account = async () => {
  const u = state.user;
  const profile =
    u.role === "student" ? await api("GET", "/api/me/profile") : null;
  const profileActivity = profile
    ? `<section class="card"><div class="card-top"><h2>Your points & activity</h2>${link("Full history", "history")}</div><div class="profile-stats account-stats"><div><span>Current balance</span><strong>${num(profile.summary.balance)}<small> pts</small></strong></div><div><span>Games attended</span><strong>${num(profile.summary.gamesAttended)}</strong></div><div><span>Reward spending</span><strong>${num(profile.summary.pointsSpent)}<small> pts</small></strong></div><div><span>Awaiting pickup</span><strong>${num(profile.summary.pendingPickups)}</strong></div></div>${activityList(profile.ledger.slice(0, 5))}</section>`
    : "";
  const securityCard = profile
    ? `<section class="card"><div class="card-top"><h2>Protect your membership QR code</h2>${icon("qr")}</div><p class="card-subtitle">Lost a printed copy or shared your QR code? Replace it here. The old QR code stops working right away.</p>${u.membership?.tagUpdatedAt ? `<p class="small muted">Last replaced ${fmtTime(u.membership.tagUpdatedAt)}</p>` : ""}<button type="button" class="btn primary wide section-gap" id="reset-my-barcode">${icon("qr")}Replace my QR code</button><p class="security-note">Your points, purchases, and game history stay on your account. Your school-issued student ID stays the same.</p><p class="small muted">To correct your school ID, contact the program admin.</p></section>`
    : `<section class="card"><h2>Game night, made simple.</h2><ol class="steps section-gap"><li><div><strong>Confirm admission</strong>Follow your school’s GoFan ticket procedure.</div></li><li><div><strong>Scan the membership QR code</strong>Check the student’s name before awarding points.</div></li><li><div><strong>Keep the line moving</strong>Type the code or use name lookup if a QR code won’t scan.</div></li></ol></section>`;
  return {
    html:
      heading(
        "My profile",
        "Your Sentinel account.",
      ) +
      `<div class="grid two-column"><div class="stack"><section class="card"><div class="account-header"><span class="avatar">${esc(
        u.name
          .split(" ")
          .map((n) => n[0])
          .slice(0, 2)
          .join(""),
      )}</span><div><h2>${esc(u.name)}</h2><p>${esc({ student: "Student member", staff: "Gate worker", admin: "Program administrator" }[u.role])}</p></div></div><dl class="account-grid"><dt>Email</dt><dd>${esc(u.email)}</dd>${u.studentNumber ? `<dt>Student ID</dt><dd>${esc(u.studentNumber)}</dd>` : ""}<dt>School</dt><dd>Sample High School</dd><dt>Access</dt><dd>${state.demo ? "Demo role switcher" : "Signed-in account"}</dd></dl><div class="notice section-gap">${icon("info")}${backend ? "You’re exploring sample accounts in this browser. Nothing is sent to a server. Use the role switcher to see the student, gate worker, and coach screens." : state.demo ? "You’re exploring sample accounts. Use the role switcher to see the student, gate worker, and coach experiences." : "Ask your program administrator to update your account details."}</div>${!state.demo ? '<button class="btn section-gap" id="logout">Log out</button>' : ""}</section>${profileActivity}</div><div class="stack">${u.role === "student" ? membershipCard(u) : ""}${securityCard}</div></div>`,
    mount() {
      if ($("#print-my-tag")) $("#print-my-tag").onclick = () => printTag(u);
      if ($("#reset-my-barcode"))
        $("#reset-my-barcode").onclick = () => {
          showDialog(
            "Replace your membership QR code?",
            "Use this if you lost a printed copy or someone copied your code.",
            `<div class="form-stack"><div class="notice warning">${icon("info")}Your current QR code and every printed or saved copy will stop working right away. Save or print the new QR code before your next game.</div><p class="small muted">Your points, reward orders, attendance history, and school ID stay on your account.</p><label class="check-label"><input type="checkbox" name="confirmed" required>I understand my old QR code will stop working.</label></div>`,
            async (data) => {
              const { user } = await api(
                "POST",
                "/api/me/membership/reset-tag",
                {
                  currentTag: u.membership.tag,
                  confirmed: data.confirmed === "on",
                },
              );
              state.user = user;
              toast(
                "QR code replaced. The old one no longer works. Save or print your new QR code.",
              );
              route();
            },
            "Replace QR code",
          );
        };
      if ($("#logout"))
        $("#logout").onclick = async () => {
          await api("POST", "/api/auth/logout", {});
          await window.GameDayAuth?.signOut();
          route();
        };
    },
  };
};

VIEWS.overview = async () => {
  const [o, { events }] = await Promise.all([
    api("GET", "/api/admin/overview"),
    api("GET", "/api/events"),
  ]);
  const stats = [
    [
      "Active members",
      o.activeMembers,
      `${o.students} students enrolled`,
      "users",
    ],
    ["Game check-ins", o.checkIns, "One award per student, per event", "scan"],
    [
      "Attendance points",
      o.pointsAwarded,
      "Earned through game check-ins",
      "star",
    ],
    [
      "Prize pickups",
      o.pendingOrders,
      "Reservations awaiting collection",
      "gift",
    ],
  ];
  return {
    html:
      heading(
        "Program overview",
        `Welcome, ${esc(state.user.name)}. Here’s how the program is doing.`,
        `<a class="btn" id="export-ledger" href="/api/admin/export/ledger.csv" download="points-ledger.csv">${icon("download")}Export points log</a>`,
      ) +
      `<div class="stats-row">${stats.map(([label, count, sub, ico]) => `<div class="card stat-card"><div class="stat-label">${label}${icon(ico)}</div><strong>${num(count)}</strong><p>${sub}</p></div>`).join("")}</div>${events
        .filter((e) => e.open)
        .map(
          (e) =>
            `<div class="live-event-banner"><div>${pill("Gate open", "live")}<h2>${esc(e.name)}</h2><p>${e.attendanceCount} checked in · ${e.points} points per student</p></div>${link("Open gate screen", "gate", "btn primary")}</div>`,
        )
        .join(
          "",
        )}<div class="grid two-column"><section class="card"><div class="card-top"><h2>Recent check-ins</h2>${link("Gate check-in", "gate")}</div>${o.recentAttendance.length ? o.recentAttendance.map((a) => `<div class="activity-item"><div class="activity-badge">${icon("check")}</div><div class="activity-info">${studentProfileLink(a.userId, a.studentName)}<span>${esc(a.eventName)} · ${fmtTime(a.at)}</span></div><span class="delta">+${a.points}</span></div>`).join("") : empty("Check in your first student at the gate.", "scan")}</section><div class="stack"><section class="card"><div class="card-top"><h2>On the calendar</h2>${link("Manage", "events")}</div>${eventList(events.slice(0, 3))}</section><section class="card"><h2>Shortcuts</h2><div class="form-stack section-gap">${link("Enroll a member or replace a QR code", "members", "btn")}${link("Manage prize pickups", "orders", "btn")}${link("Update the reward shop", "rewards", "btn")}</div></section></div></div>`,
    mount() {
      bindStudentProfiles();
      // The browser demo has no server to download from, so build the file here.
      if (backend)
        $("#export-ledger").onclick = async (e) => {
          e.preventDefault();
          try {
            downloadFile(
              await api("GET", "/api/admin/export/ledger.csv"),
              "text/csv;charset=utf-8",
              "points-ledger.csv",
            );
          } catch (err) {
            toast(err.message, true);
          }
        };
    },
  };
};

function eventEditor(event = {}) {
  showDialog(
    event.id ? "Edit game" : "Add a game",
    "Choose the points students earn for attending.",
    `<div class="form-grid"><label class="full">Event name<input name="name" maxlength="100" required value="${esc(event.name)}" placeholder="Football vs. Eastside"></label><label>Date<input type="date" name="date" required value="${esc(event.date || today())}"></label><label>Start time<input type="time" name="time" required value="${esc(event.time || "19:30")}"></label><label>Sport<select name="sport">${["Football", "Basketball", "Volleyball", "Baseball", "Softball", "Soccer", "Lacrosse", "Other"].map((s) => `<option ${event.sport === s ? "selected" : ""}>${s}</option>`).join("")}</select></label><label>Points per check-in<input type="number" name="points" min="0" max="10000" step="1" required value="${event.points ?? 50}"></label><label class="full">Location<input name="location" maxlength="100" value="${esc(event.location || "Sample High School")}"></label></div>`,
    async (data) => {
      await api(
        event.id ? "PUT" : "POST",
        `/api/admin/events${event.id ? "/" + event.id : ""}`,
        { ...data, points: Number(data.points) },
      );
      toast("Event saved.");
      route();
    },
  );
}
VIEWS.events = async () => {
  const { events } = await api("GET", "/api/events");
  return {
    html:
      heading(
        "Events",
        "Create games, choose point values, and open the gate.",
        btn("Add game", "add-event", "primary", "plus"),
      ) +
      `<section class="card"><div class="table-wrap"><table><thead><tr><th>Event</th><th>Date / time</th><th>Points</th><th>Check-ins</th><th>Gate</th><th>Manage</th></tr></thead><tbody>${events.map((e) => `<tr><td><strong>${esc(e.name)}</strong><small>${esc(e.sport)} · ${esc(e.location)}</small></td><td>${fmtDate(e.date, { year: "numeric" })}<small>${fmtStart(e)}</small></td><td>${num(e.points)}</td><td>${e.attendanceCount}</td><td><button class="btn small ${e.open ? "danger" : "blue"}" data-toggle="${e.id}">${e.open ? "Close gate" : "Open gate"}</button></td><td><div class="actions"><button class="btn small" data-edit="${e.id}">Edit</button>${!e.attendanceCount ? `<button class="btn small danger" data-delete="${e.id}">Delete</button>` : ""}</div></td></tr>`).join("") || '<tr><td colspan="6">No games yet. Add your first event.</td></tr>'}</tbody></table></div></section><div class="notice section-gap">${icon("info")}Workers can award points only while a gate is open. Closing a gate preserves its attendance records. Event dates and times use the school’s Eastern time.</div>`,
    mount() {
      $("#add-event").onclick = () => eventEditor();
      $$("[data-edit]").forEach(
        (b) =>
          (b.onclick = () =>
            eventEditor(events.find((e) => e.id === b.dataset.edit))),
      );
      $$("[data-toggle]").forEach(
        (b) =>
          (b.onclick = async () => {
            b.disabled = true;
            try {
              const e = events.find((e) => e.id === b.dataset.toggle);
              await api("PUT", `/api/admin/events/${e.id}`, { open: !e.open });
              toast(e.open ? "Gate closed." : "Gate is open for check-ins.");
              route();
            } catch (err) {
              toast(err.message, true);
              b.disabled = false;
            }
          }),
      );
      $$("[data-delete]").forEach(
        (b) =>
          (b.onclick = () => {
            const e = events.find((e) => e.id === b.dataset.delete);
            showDialog(
              "Delete this event?",
              esc(e.name),
              '<p class="small muted">This removes the event from the schedule.</p>',
              async () => {
                await api("DELETE", `/api/admin/events/${e.id}`);
                route();
                toast("Event deleted.");
              },
              "Delete event",
            );
          }),
      );
    },
  };
};

VIEWS.members = async () => {
  const { users } = await api("GET", "/api/admin/users");
  const members = users.filter((u) => u.role === "student");
  function memberRows(q = "") {
    return (
      members
        .filter((u) =>
          `${u.name} ${u.studentNumber}`
            .toLowerCase()
            .includes(q.toLowerCase()),
        )
        .map(
          (u) =>
            `<tr><td>${studentProfileLink(u.id, u.name)}<small>#${esc(u.studentNumber)} · ${esc(u.email)}</small></td><td>${membershipStatus(u.membership || {})}<small>Through ${u.membership?.expires ? fmtDate(u.membership.expires, { year: "numeric" }) : "not set"}</small></td><td>${num(u.points)}</td><td>${u.attended}</td><td><div class="actions"><button class="btn small" data-manage="${u.id}">Manage</button><button class="btn small" data-tag="${u.id}" aria-label="Show ${esc(u.name)}’s QR code">${icon("qr")}QR code</button></div></td></tr>`,
        )
        .join("") ||
      '<tr><td colspan="5">No students match your search.</td></tr>'
    );
  }
  return {
    html:
      heading(
        "Members",
        "Manage memberships, QR codes, and student points.",
        btn("Enroll student", "add-member", "primary", "plus"),
      ) +
      `<section class="card"><div class="card-top"><h2>Members <span class="muted">(${members.length})</span></h2><input class="search-input" id="member-search" type="search" aria-label="Search members" placeholder="Search name or student ID"></div><div class="table-wrap"><table><thead><tr><th>Student</th><th>Membership</th><th>Points</th><th>Games</th><th>Actions</th></tr></thead><tbody id="member-rows">${memberRows()}</tbody></table></div></section><div class="notice section-gap">${icon("info")}Membership payments happen outside this website. Activate membership after the school confirms enrollment. Replacing a QR code turns off the old one and keeps the student’s points.</div>`,
    mount() {
      const wire = () => {
        bindStudentProfiles($("#member-rows"));
        $$("[data-tag]").forEach(
          (b) =>
            (b.onclick = () =>
              printTag(members.find((u) => u.id === b.dataset.tag))),
        );
        $$("[data-manage]").forEach(
          (b) =>
            (b.onclick = () => {
              const u = members.find((u) => u.id === b.dataset.manage);
              showDialog(
                esc(u.name),
                `Student #${esc(u.studentNumber)} · ${num(u.points)} points`,
                `<div class="form-stack"><label class="check-label"><input type="checkbox" name="active" ${u.membership.active ? "checked" : ""}>Membership activated by the school</label><label>Membership valid through<input type="date" name="expires" value="${esc(u.membership.expires)}" required></label><label class="check-label"><input type="checkbox" name="replaceTag">Replace a lost QR code and turn off the old one</label><div class="notice">${icon("info")}Current code: ${esc(groupCode(u.membership.tag))}</div><label>Points adjustment (optional)<input name="delta" type="number" step="1" min="-100000" max="100000" placeholder="e.g. 20 or -10"></label><label>Reason for adjustment<input name="reason" maxlength="120" placeholder="Required when adjusting points"></label></div>`,
                async (data) => {
                  const delta = data.delta === "" ? 0 : Number(data.delta);
                  if (delta && !data.reason.trim())
                    throw new Error(
                      "Enter a reason for the points adjustment.",
                    );
                  if (delta && u.points + delta < 0)
                    throw new Error(
                      "That adjustment would make the balance negative.",
                    );
                  await api("PUT", `/api/admin/members/${u.id}`, {
                    active: data.active === "on",
                    expires: data.expires,
                    replaceTag: data.replaceTag === "on",
                    delta,
                    reason: data.reason,
                  });
                  toast("Member updated.");
                  route();
                },
              );
            }),
        );
      };
      wire();
      $("#member-search").oninput = (e) => {
        $("#member-rows").innerHTML = memberRows(e.target.value);
        wire();
      };
      $("#add-member").onclick = () =>
        showDialog(
          "Enroll a student",
          "Enroll a student and assign their unique membership QR code.",
          `<div class="form-stack"><label>Full name<input name="name" maxlength="80" required></label><label>Student ID<input name="studentNumber" maxlength="20" required></label><label>Email<input name="email" type="email" required></label><label class="check-label"><input name="active" type="checkbox">School has confirmed enrollment payment</label></div>`,
          async (data) => {
            await api("POST", "/api/admin/members", {
              ...data,
              active: data.active === "on",
            });
            toast("Student enrolled. Their QR code is ready.");
            route();
          },
          "Enroll student",
        );
    },
  };
};

function rewardEditor(r = {}) {
  showDialog(
    r.id ? "Edit reward" : "Add a reward",
    "Name the prize, its point cost and how many you have.",
    `<div class="form-stack"><label>Reward name<input name="name" maxlength="80" required value="${esc(r.name)}"></label><label>Description<input name="description" maxlength="200" value="${esc(r.description)}"></label><div class="form-grid"><label>Point cost<input name="cost" type="number" step="1" min="1" max="100000" required value="${r.cost || 100}"></label><label>Available stock<input name="stock" type="number" step="1" min="0" value="${r.stock ?? ""}" placeholder="Blank = unlimited"></label></div><label class="check-label"><input name="active" type="checkbox" ${r.active !== false ? "checked" : ""}>Show in reward shop</label></div>`,
    async (data) => {
      await api(
        r.id ? "PUT" : "POST",
        `/api/admin/rewards${r.id ? "/" + r.id : ""}`,
        {
          ...data,
          cost: Number(data.cost),
          stock: data.stock === "" ? null : Number(data.stock),
          active: data.active === "on",
        },
      );
      toast("Reward saved.");
      route();
    },
  );
}
VIEWS.rewards = async () => {
  const { rewards } = await api("GET", "/api/rewards?all=1");
  return {
    html:
      heading(
        "Rewards",
        "Choose the prizes, what they cost and how many are in stock.",
        btn("Add reward", "add-reward", "primary", "plus"),
      ) +
      `<section class="card"><div class="table-wrap"><table><thead><tr><th>Reward</th><th>Points</th><th>Stock</th><th>Visibility</th><th></th></tr></thead><tbody>${rewards.map((r) => `<tr><td><strong>${esc(r.name)}</strong><small>${esc(r.description)}</small></td><td>${num(r.cost)}</td><td>${r.stock === null ? "Unlimited" : r.stock}</td><td>${pill(r.active ? "In shop" : "Hidden", r.active ? "active" : "")}</td><td><button class="btn small" data-reward="${r.id}">Edit reward</button></td></tr>`).join("") || '<tr><td colspan="5">No rewards yet. Add your first item.</td></tr>'}</tbody></table></div></section>`,
    mount() {
      $("#add-reward").onclick = () => rewardEditor();
      $$("[data-reward]").forEach(
        (b) =>
          (b.onclick = () =>
            rewardEditor(rewards.find((r) => r.id === b.dataset.reward))),
      );
    },
  };
};

const METHOD_LABELS = Object.freeze({
  qr: "QR code scan",
  typed: "Typed code",
  barcode: "Code scan (older card)",
  manual: "Manual lookup",
  legacy: "Imported attendance",
});
const studentProfileLink = (id, name) =>
  `<button type="button" class="student-name-link" data-student-profile="${esc(id)}" aria-haspopup="dialog" aria-label="View ${esc(name)}'s student profile">${esc(name)}</button>`;
function bindStudentProfiles(root = $("#view")) {
  $$("[data-student-profile]", root).forEach((button) => {
    button.onclick = () => openStudentProfile(button.dataset.studentProfile);
  });
}
let profileSequence = 0;
async function openStudentProfile(userId) {
  const dialog = $("#dialog"),
    sequence = ++profileSequence;
  if (dialog.open) dialog.close();
  dialog.classList.add("student-profile-dialog");
  dialog.dataset.profileUser = userId;
  dialog.removeAttribute("aria-label");
  dialog.setAttribute("aria-labelledby", "student-profile-title");
  const closeButton =
    '<button type="button" data-close-profile aria-label="Close student profile">×</button>';
  const close = () => {
    delete dialog.dataset.profileUser;
    dialog.close();
  };
  $("#dialog-content").innerHTML =
    `<div class="dialog-head"><h2 id="student-profile-title">Student profile</h2>${closeButton}</div><div class="loading" role="status">Loading student history…</div>`;
  $("[data-close-profile]", dialog).onclick = close;
  dialog.showModal();
  try {
    const { user, summary, attendance, orders, ledger } = await api(
      "GET",
      `/api/admin/users/${encodeURIComponent(userId)}/profile`,
    );
    if (
      !dialog.open ||
      dialog.dataset.profileUser !== userId ||
      sequence !== profileSequence
    )
      return;
    const firstName = esc(user.name.split(" ")[0]);
    const tabs = [
      ["games", "Game history", attendance.length],
      ["spending", "Spending history", orders.length],
      ["points", "Points history", ledger.length],
    ];
    $("#dialog-content").innerHTML =
      `<div class="dialog-head"><div><p class="eyebrow">Student profile</p><h2 id="student-profile-title">${esc(user.name)}</h2></div>${closeButton}</div><div class="profile-identity"><span>Student #${esc(user.studentNumber || "not assigned")} · ${esc(user.email)}</span>${pill(user.disabled ? "Account disabled" : user.membership?.valid ? "Active member" : "Inactive membership", user.disabled || !user.membership?.valid ? "inactive" : "active")}</div><div class="profile-stats"><div><span>Current balance</span><strong>${num(summary.balance)}<small> pts</small></strong></div><div><span>Games attended</span><strong>${num(summary.gamesAttended)}</strong></div><div><span>Total points earned</span><strong>${num(summary.pointsEarned)}<small> pts</small></strong></div><div><span>Reward spending</span><strong>${num(summary.pointsSpent)}<small> pts</small></strong></div></div><p class="profile-summary-note">${num(summary.attendancePoints)} points from games · ${num(summary.rewardsCollected)} rewards collected · ${num(summary.pendingPickups)} awaiting pickup · ${num(summary.pointsRefunded)} points refunded</p><div class="profile-tabs" role="tablist" aria-label="Student history">${tabs.map(([id, label, count], i) => `<button type="button" id="profile-tab-${id}" role="tab" aria-controls="profile-panel-${id}" aria-selected="${i === 0}" tabindex="${i === 0 ? "0" : "-1"}" data-profile-tab="${id}" class="${i === 0 ? "active" : ""}">${label}<span>${count}</span></button>`).join("")}</div><section id="profile-panel-games" role="tabpanel" aria-labelledby="profile-tab-games" tabindex="0"><p class="profile-panel-note">Game check-ins and the points awarded at the time of attendance.</p>${attendance.length ? `<div class="table-wrap"><table><thead><tr><th>Game</th><th>Checked in</th><th>Points earned</th><th>Recorded by</th></tr></thead><tbody>${attendance.map((a) => `<tr><td><strong>${esc(a.eventName)}</strong><small>${a.eventDate ? fmtDate(a.eventDate, { year: "numeric" }) : "Date unavailable"}${a.sport ? ` · ${esc(a.sport)}` : ""}</small></td><td>${fmtTime(a.at)}<small>${METHOD_LABELS[a.method] || "Gate check-in"}</small></td><td><span class="delta">+${num(a.points)}</span></td><td>${esc(a.workerName)}</td></tr>`).join("")}</tbody></table></div>` : empty(`${firstName} has no recorded game check-ins yet.`, "calendar")}</section><section id="profile-panel-spending" role="tabpanel" aria-labelledby="profile-tab-spending" tabindex="0" hidden><p class="profile-panel-note">Reward spending includes reserved and collected prizes. Canceled orders are refunded and excluded from the spending total.</p>${orders.length ? `<div class="table-wrap"><table><thead><tr><th>Reward</th><th>Reserved</th><th>Points</th><th>Status</th></tr></thead><tbody>${orders.map((o) => `<tr><td><strong>${esc(o.rewardName)}</strong>${o.handledAt ? `<small>${o.status === "cancelled" ? "Canceled" : "Collected"} ${fmtTime(o.handledAt)}${o.handledByName ? ` · ${esc(o.handledByName)}` : ""}</small>` : ""}</td><td>${fmtTime(o.createdAt)}</td><td>${num(o.cost)} pts${o.status === "cancelled" ? `<small class="delta">${num(o.cost)} pts refunded</small>` : ""}</td><td>${pill({ pending: "Awaiting pickup", fulfilled: "Collected", cancelled: "Canceled & refunded" }[o.status] || o.status, o.status)}</td></tr>`).join("")}</tbody></table></div>` : empty(`${firstName} has not reserved any rewards yet.`, "gift")}</section><section id="profile-panel-points" role="tabpanel" aria-labelledby="profile-tab-points" tabindex="0" hidden><p class="profile-panel-note">Every points change, including game awards, starting points, adjustments, spending, and refunds. Refunds are excluded from total points earned.</p>${ledger.length ? `<div class="table-wrap"><table><thead><tr><th>Activity</th><th>Date</th><th>Change</th><th>Recorded by</th></tr></thead><tbody>${ledger.map((l) => `<tr><td><strong>${esc(l.reason)}</strong>${l.refund ? "<small>Reward refund</small>" : ""}</td><td>${fmtTime(l.at)}</td><td><span class="delta ${l.delta < 0 ? "negative" : ""}">${l.delta > 0 ? "+" : ""}${num(l.delta)} pts</span></td><td>${esc(l.byName)}</td></tr>`).join("")}</tbody></table></div>` : empty(`${firstName} has no points activity yet.`, "star")}</section><div class="profile-footer"><span>Account created ${fmtTime(user.createdAt)}</span><button type="button" class="btn" id="close-profile">Back to admin page</button></div>`;
    $("[data-close-profile]", dialog).onclick = close;
    $("#close-profile", dialog).onclick = close;
    const tabButtons = $$("[data-profile-tab]", dialog);
    function selectTab(id) {
      tabButtons.forEach((button) => {
        const selected = button.dataset.profileTab === id;
        button.classList.toggle("active", selected);
        button.setAttribute("aria-selected", String(selected));
        button.tabIndex = selected ? 0 : -1;
        $(`#profile-panel-${button.dataset.profileTab}`, dialog).hidden =
          !selected;
      });
    }
    tabButtons.forEach((button, index) => {
      button.onclick = () => selectTab(button.dataset.profileTab);
      button.onkeydown = (event) => {
        const step =
          event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (!step && !["Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const target =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabButtons.length - 1
              : (index + step + tabButtons.length) % tabButtons.length;
        selectTab(tabButtons[target].dataset.profileTab);
        tabButtons[target].focus();
      };
    });
  } catch (err) {
    if (
      !dialog.open ||
      dialog.dataset.profileUser !== userId ||
      sequence !== profileSequence
    )
      return;
    $("#dialog-content").innerHTML =
      `<div class="dialog-head"><h2 id="student-profile-title">Student profile unavailable</h2>${closeButton}</div><p class="form-error" role="alert">${esc(err.message)}</p>`;
    $("[data-close-profile]", dialog).onclick = close;
  }
}

VIEWS.orders = async () => {
  const { orders } = await api("GET", "/api/admin/orders");
  const rows = (status) =>
    orders
      .filter((o) => !status || o.status === status)
      .map(
        (o) =>
          `<tr><td>${studentProfileLink(o.userId, o.studentName)}<small>#${esc(o.studentNumber)}</small></td><td><strong>${esc(o.rewardName)}</strong><small>${num(o.cost)} points · ${fmtTime(o.createdAt)}</small></td><td>${pill({ pending: "Ready for pickup", fulfilled: "Collected", cancelled: "Canceled" }[o.status], o.status)}</td><td>${o.status === "pending" ? `<div class="actions"><button class="btn small primary" data-fulfill="${o.id}">Handed out</button><button class="btn small" data-cancel="${o.id}">Cancel & refund</button></div>` : '<span class="muted">No action needed</span>'}</td></tr>`,
      )
      .join("") ||
    '<tr><td colspan="4">No reservations in this view.</td></tr>';
  return {
    html:
      heading(
        "Prize pickups",
        "Check the student’s school ID, then hand over their reward.",
      ) +
      `<section class="card"><div class="card-top"><h2>Prize pickups</h2><div class="filters"><button class="tab-filter active" data-status="pending">Ready for pickup</button><button class="tab-filter" data-status="">All orders</button></div></div><div class="table-wrap"><table><thead><tr><th>Student</th><th>Reward</th><th>Status</th><th>Actions</th></tr></thead><tbody id="order-rows">${rows("pending")}</tbody></table></div></section>`,
    mount() {
      const wire = () => {
        bindStudentProfiles($("#order-rows"));
        ["fulfill", "cancel"].forEach((action) =>
          $$(`[data-${action}]`).forEach(
            (b) =>
              (b.onclick = () => {
                const o = orders.find((o) => o.id === b.dataset[action]);
                showDialog(
                  action === "fulfill"
                    ? "Reward collected?"
                    : "Cancel this reservation?",
                  `${esc(o.rewardName)} · ${esc(o.studentName)}`,
                  `<div class="notice">${icon("info")}${action === "fulfill" ? "Confirm you checked the student’s school ID and gave them this reward." : `This returns ${o.cost} points to the student and restores the item’s stock.`}</div>`,
                  async () => {
                    await api(
                      "POST",
                      `/api/admin/orders/${o.id}/${action}`,
                      {},
                    );
                    toast(
                      action === "fulfill"
                        ? "Marked as collected."
                        : "Reservation canceled and points refunded.",
                    );
                    route();
                  },
                  action === "fulfill" ? "Mark collected" : "Cancel & refund",
                );
              }),
          ),
        );
      };
      wire();
      $$("[data-status]").forEach(
        (b) =>
          (b.onclick = () => {
            $$("[data-status]").forEach((el) =>
              el.classList.toggle("active", el === b),
            );
            $("#order-rows").innerHTML = rows(b.dataset.status);
            wire();
          }),
      );
    },
  };
};

const CAMERA_HELP = Object.freeze({
  idle: "Point the camera at the student’s membership QR code.",
  opening: "Opening the camera. Allow camera access when your browser asks.",
  live: "Camera is live. Hold the QR code inside the square.",
  hint: "Having trouble? Move closer, add light, or tilt the code to cut glare. You can also type the code.",
  stopped: "Camera stopped. You can still type the code or use name lookup.",
  insecure:
    "The camera needs a secure HTTPS address, or localhost on this computer. Use Scan a photo, type the code, or use name lookup.",
  unsupported:
    "This browser cannot use the camera here. Use Scan a photo, type the code, or use name lookup.",
  noLibrary:
    "The QR scanner could not load. Reload the page, or type the code or use name lookup.",
  denied:
    "Camera permission was denied. Allow camera access in your browser settings, or type the code or use name lookup.",
  missing:
    "No camera was found on this device. Use Scan a photo, type the code, or use name lookup.",
  busy: "The camera is in use by another app. Close that app and try again, or use name lookup.",
  failed:
    "The camera could not start. Check camera permission, or type the code or use name lookup.",
  photoReading: "Reading the photo.",
  photoNone:
    "No QR code was found in that photo. Take it closer with the whole code in view, or type the code.",
});
const LOOKUP_TITLES = Object.freeze({
  400: "Not a membership QR code",
  410: "This QR code was replaced",
  404: "QR code not found",
});
function cameraProblem(err) {
  const text = `${err?.name || ""} ${err?.message || err || ""}`;
  if (/NotAllowed|Permission|denied|SecurityError/i.test(text))
    return CAMERA_HELP.denied;
  if (/NotFound|DevicesNotFound|Overconstrained|no camera/i.test(text))
    return CAMERA_HELP.missing;
  if (/NotReadable|TrackStart|in use|Could not start video/i.test(text))
    return CAMERA_HELP.busy;
  if (/not supported|streaming not supported|mediaDevices/i.test(text))
    return CAMERA_HELP.unsupported;
  return CAMERA_HELP.failed;
}
function loadScanner() {
  return loadScript(SCANNER_SCRIPT, CAMERA_HELP.noLibrary).then(() => {
    if (!window.Html5Qrcode || !window.Html5QrcodeSupportedFormats)
      throw new Error(CAMERA_HELP.noLibrary);
  });
}
function newQrReader(elementId) {
  return new window.Html5Qrcode(elementId, {
    verbose: false,
    formatsToSupport: [window.Html5QrcodeSupportedFormats.QR_CODE],
    // Native BarcodeDetector where the browser has it; ZXing otherwise.
    useBarCodeDetectorIfSupported: true,
  });
}
async function stopQrReader(reader) {
  if (!reader) return;
  try {
    if (reader.isScanning) await reader.stop();
  } catch {
    /* already stopped */
  }
  try {
    reader.clear();
  } catch {
    /* element already removed by a route change */
  }
}

VIEWS.gate = async () => {
  const { events } = await api("GET", "/api/events");
  const open = events.filter((e) => e.open);
  const saved = safeSession.get("gateEvent");
  const selected = open.find((e) => e.id === saved) || open[0];
  if (!selected)
    return {
      html:
        heading(
          "Gate check-in",
          "Check the ticket, scan the QR code, then award points.",
        ) +
        `<section class="card">${empty("No gates are open. Ask a coach to open tonight’s event.", "scan")}${state.user.role === "admin" ? link("Manage events", "events", "btn primary") : ""}</section>`,
    };
  return {
    html:
      heading(
        "Gate check-in",
        "Check the ticket, scan the QR code, then award points.",
        pill(state.demo ? "Demo gate access" : "VERIFIED GATE ACCESS", "blue"),
      ) +
      `<div class="gate-steps"><span><b>1</b>Check the ticket</span>${icon("arrow")}<span><b>2</b>Scan membership QR code</span>${icon("arrow")}<span><b>3</b>Confirm & award points</span></div><div class="grid gate-layout"><section class="card"><div class="card-top"><h2>Membership scanner</h2>${pill("Gate open", "live")}</div><label>Checking in for<select id="gate-event">${open.map((e) => `<option value="${e.id}" ${e.id === selected.id ? "selected" : ""}>${esc(e.name)} · +${e.points} pts</option>`).join("")}</select></label><div class="scanner section-gap" id="scanner"><div id="qr-reader" class="scanner-feed" hidden></div><div class="scan-target" aria-hidden="true">${icon("qr")}</div><p id="camera-message" role="status">${CAMERA_HELP.idle}</p></div><div class="scanner-controls">${btn("Start camera", "start-camera", "primary", "camera")}${btn("Stop camera", "stop-camera", "", "")}${btn("Scan a photo", "scan-photo", "", "image")}</div><input type="file" id="qr-photo" accept="image/*" capture="environment" hidden><div id="qr-file-reader" class="visually-hidden" aria-hidden="true"></div><form class="scan-form" id="tag-form"><label>Or type the membership code<input id="tag-input" name="tag" placeholder="D234 5678 9ABC" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40" required></label><button class="btn" type="submit">Look up</button></form><div class="gate-result" id="gate-result" role="status" aria-live="polite">${icon("qr")}<h3>Waiting for a membership QR code</h3><p>Points are awarded after you confirm this student’s admission.</p></div><div class="notice section-gap">${icon("info")}This scanner reads Sentinel membership QR codes only. It does not read GoFan tickets, so check admission in GoFan first.</div></section><div class="stack"><section class="card"><div class="card-top"><h2>Find a student</h2>${icon("users")}</div><input type="search" id="gate-search" aria-label="Search student name or ID" placeholder="Search name or student ID"><p class="gate-search-status" id="gate-count"></p><div id="gate-members"></div></section><section class="card"><div class="card-top"><h2>Recent check-ins</h2><button type="button" class="btn small" id="refresh-gate">Refresh</button></div><div id="gate-recent"></div></section></div></div>`,
    async mount() {
      const root = $("#view"),
        eventSelect = $("#gate-event"),
        resultBox = $("#gate-result"),
        scannerBox = $("#scanner", root),
        feed = $("#qr-reader", root),
        startButton = $("#start-camera", root),
        photoInput = $("#qr-photo", root);
      let disposed = false,
        reader = null, // live camera reader
        starting = false,
        scanEpoch = 0, // bumps on every stop so late callbacks are ignored
        hintTimer,
        members = [],
        searchTimer,
        searchEpoch = 0,
        lookupEpoch = 0;
      const activeEvent = () => events.find((e) => e.id === eventSelect.value);
      const cameraMessage = (text) => {
        if (!disposed) $("#camera-message", root).textContent = text;
      };

      function stopCamera() {
        scanEpoch++;
        clearTimeout(hintTimer);
        const current = reader;
        reader = null;
        starting = false;
        feed.hidden = true;
        scannerBox.classList.remove("live");
        if (!disposed) startButton.disabled = false;
        return stopQrReader(current);
      }
      async function startCamera() {
        if (disposed || starting || reader) return;
        if (!window.isSecureContext)
          return cameraMessage(CAMERA_HELP.insecure);
        if (!navigator.mediaDevices?.getUserMedia)
          return cameraMessage(CAMERA_HELP.unsupported);
        starting = true;
        startButton.disabled = true;
        const epoch = ++scanEpoch;
        cameraMessage(CAMERA_HELP.opening);
        let next = null;
        try {
          await loadScanner();
          if (disposed || epoch !== scanEpoch) return;
          feed.hidden = false;
          scannerBox.classList.add("live");
          next = newQrReader("qr-reader");
          await next.start(
            { facingMode: "environment" },
            {
              fps: SCAN_FPS,
              qrbox: (width, height) => {
                const side = Math.floor(Math.min(width, height) * SCAN_BOX_RATIO);
                return { width: side, height: side };
              },
            },
            (text) => {
              // The decoder can fire several times for one code: take the first.
              if (disposed || epoch !== scanEpoch) return;
              stopCamera();
              lookUpCode(text, "scan");
            },
            () => {}, // "no code in this frame" is normal; stay quiet
          );
          if (disposed || epoch !== scanEpoch) {
            await stopQrReader(next); // stopped while the camera was opening
            return;
          }
          reader = next;
          cameraMessage(CAMERA_HELP.live);
          hintTimer = setTimeout(
            () => reader && cameraMessage(CAMERA_HELP.hint),
            SCAN_HINT_MS,
          );
        } catch (err) {
          if (next && next !== reader) await stopQrReader(next);
          if (!disposed && epoch === scanEpoch) {
            stopCamera();
            cameraMessage(
              err?.message === CAMERA_HELP.noLibrary
                ? CAMERA_HELP.noLibrary
                : cameraProblem(err),
            );
          }
        } finally {
          if (epoch === scanEpoch) starting = false;
          if (!disposed) startButton.disabled = !!reader || starting;
        }
      }
      async function scanPhoto(file) {
        if (!file) return;
        await stopCamera();
        cameraMessage(CAMERA_HELP.photoReading);
        let fileReader = null;
        try {
          await loadScanner();
          if (disposed) return;
          fileReader = newQrReader("qr-file-reader");
          const text = await fileReader.scanFile(file, false);
          if (disposed) return;
          cameraMessage(CAMERA_HELP.idle);
          lookUpCode(text, "scan");
        } catch (err) {
          cameraMessage(
            err?.message === CAMERA_HELP.noLibrary
              ? CAMERA_HELP.noLibrary
              : CAMERA_HELP.photoNone,
          );
        } finally {
          try {
            fileReader?.clear();
          } catch {
            /* nothing drawn */
          }
          photoInput.value = "";
        }
      }

      function onHidden() {
        if (document.hidden && (reader || starting)) {
          stopCamera();
          cameraMessage(CAMERA_HELP.stopped);
        }
      }
      document.addEventListener("visibilitychange", onHidden);
      state.cleanup = () => {
        disposed = true;
        clearTimeout(searchTimer);
        stopCamera();
        document.removeEventListener("visibilitychange", onHidden);
      };

      async function loadMembers() {
        const epoch = ++searchEpoch,
          eventId = eventSelect.value;
        const data = await api(
          "GET",
          `/api/gate/members?eventId=${encodeURIComponent(eventId)}&q=${encodeURIComponent($("#gate-search", root).value)}`,
        );
        if (disposed || epoch !== searchEpoch || eventId !== eventSelect.value)
          return;
        members = data.members;
        $("#gate-count", root).textContent =
          `${members.length} student${members.length === 1 ? "" : "s"} found`;
        $("#gate-members", root).innerHTML =
          members
            .slice(0, GATE_LIST_LIMIT)
            .map(
              (u) =>
                `<div class="manual-result"><div><strong>${esc(u.name)}</strong><small>#${esc(u.studentNumber)} · ${u.checkedIn ? "Already checked in" : u.membership.valid ? "Active member" : "Inactive membership"}</small></div><button class="btn small ${u.checkedIn ? "" : "blue"}" data-pick="${u.id}" ${!u.membership.valid ? "disabled" : ""}>${u.checkedIn ? "View" : "Select"}</button></div>`,
            )
            .join("") ||
          empty("No students match. Try another name or ID.", "users");
        $$("[data-pick]", root).forEach(
          (b) =>
            (b.onclick = () =>
              chooseMember(
                members.find((u) => u.id === b.dataset.pick),
                { userId: b.dataset.pick },
              )),
        );
      }
      async function loadRecent() {
        const eventId = eventSelect.value,
          { attendance } = await api(
            "GET",
            `/api/gate/attendance?eventId=${encodeURIComponent(eventId)}`,
          );
        if (disposed || eventId !== eventSelect.value) return;
        $("#gate-recent", root).innerHTML = attendance.length
          ? attendance
              .slice(0, GATE_RECENT_LIMIT)
              .map(
                (a) =>
                  `<div class="activity-item"><div class="activity-badge">${icon("check")}</div><div class="activity-info"><strong>${esc(a.studentName)}</strong><span>${fmtTime(a.at)} · ${esc(a.workerName)}</span></div><span class="delta">+${a.points}</span></div>`,
              )
              .join("")
          : empty("No check-ins yet.", "scan");
      }
      function showError(err, title = "Couldn’t check in") {
        if (disposed) return;
        resultBox.className = "gate-result error";
        resultBox.innerHTML = `${icon("info")}<h3>${esc(title)}</h3><p>${esc(err.message)}</p>${err.network ? "<p><strong>No points were awarded.</strong></p>" : ""}`;
      }
      function readyForNext() {
        resultBox.className = "gate-result";
        resultBox.innerHTML = `${icon("qr")}<h3>Ready for the next student.</h3><p>Scan a QR code or find a student.</p>`;
        $("#tag-input", root).value = "";
      }
      function chooseMember(u, identity) {
        stopCamera();
        const event = activeEvent();
        resultBox.className = "gate-result";
        if (u.checkedIn) {
          resultBox.innerHTML = `${icon("check")}<h3>${esc(u.name)} is already checked in</h3><p>No extra points awarded. Each student earns points once per event.</p><button type="button" class="btn" id="scan-next">Scan next student</button>`;
          $("#scan-next", root).onclick = () => {
            readyForNext();
            startCamera();
          };
          return;
        }
        if (!u.membership.valid)
          return showError(new Error(rules.MESSAGES.membershipInactive));
        resultBox.innerHTML = `${icon("user")}<h3>${esc(u.name)}</h3><p>Student #${esc(u.studentNumber)} · ${esc(event.name)}</p><p>Confirm the name and validate this student’s admission in GoFan.</p><button type="button" class="btn primary" id="confirm-admission">Admission verified · Award ${event.points} pts</button>`;
        $("#confirm-admission", root).onclick = async (e) => {
          const button = e.currentTarget;
          button.disabled = true; // one tap, one request
          try {
            const data = await api("POST", "/api/gate/check-in", {
              eventId: event.id,
              ...identity,
              admissionConfirmed: true,
            });
            if (disposed) return;
            resultBox.className = "gate-result success";
            resultBox.innerHTML = `${icon("check")}<h3>${esc(data.user.name)}</h3>${data.duplicate ? '<div class="award">Already checked in</div><p>No extra points awarded.</p>' : `<div class="award">+${data.attendance.points} points</div><p>Checked in. ${num(data.user.points)} points now in their account.</p>`}<button type="button" class="btn" id="scan-next">Scan next student</button>`;
            $("#scan-next", root).onclick = () => {
              readyForNext();
              startCamera();
            };
            await Promise.all([loadMembers(), loadRecent()]);
          } catch (err) {
            showError(err);
          }
        };
        resultBox.scrollIntoView({
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
          block: "nearest",
        });
      }
      /** Scanned or typed text: check it is ours, then look it up exactly. */
      async function lookUpCode(raw, entry) {
        stopCamera();
        const parsed = rules.parseMembershipCode(raw);
        if (!parsed.ok)
          return showError(
            new Error(rules.MESSAGES.notOurCode),
            LOOKUP_TITLES[400],
          );
        const epoch = ++lookupEpoch,
          eventId = eventSelect.value;
        try {
          const { member } = await api(
            "GET",
            `/api/gate/lookup?eventId=${encodeURIComponent(eventId)}&code=${encodeURIComponent(parsed.code)}`,
          );
          if (disposed || epoch !== lookupEpoch || eventId !== eventSelect.value)
            return;
          chooseMember(member, {
            tag: parsed.code,
            ...(entry === "typed" ? { entry: "typed" } : {}),
          });
        } catch (err) {
          if (epoch === lookupEpoch) showError(err, LOOKUP_TITLES[err.status]);
        }
      }

      startButton.onclick = startCamera;
      $("#stop-camera", root).onclick = () => {
        stopCamera();
        cameraMessage(CAMERA_HELP.stopped);
      };
      $("#scan-photo", root).onclick = () => photoInput.click();
      photoInput.onchange = () => scanPhoto(photoInput.files?.[0]);
      $("#tag-form", root).onsubmit = (e) => {
        e.preventDefault();
        lookUpCode($("#tag-input", root).value, "typed");
      };
      $("#gate-search", root).oninput = () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(
          () => loadMembers().catch(showError),
          SEARCH_DEBOUNCE_MS,
        );
      };
      eventSelect.onchange = () => {
        stopCamera();
        safeSession.set("gateEvent", eventSelect.value);
        resultBox.className = "gate-result";
        resultBox.innerHTML = `${icon("qr")}<h3>Event selected</h3><p>Ready for ${esc(activeEvent().name)}.</p>`;
        Promise.all([loadMembers(), loadRecent()]).catch(showError);
      };
      $("#refresh-gate", root).onclick = () =>
        Promise.all([loadMembers(), loadRecent()]).catch(showError);
      await Promise.all([loadMembers(), loadRecent()]);
    },
  };
};

function friendlyAuthError(err) {
  return (
    {
      "auth/invalid-credential": "Email or password is incorrect.",
      "auth/wrong-password": "Email or password is incorrect.",
      "auth/user-not-found": "Email or password is incorrect.",
      "auth/email-already-in-use":
        "That email already has an account. Sign in or reset your password.",
      "auth/weak-password": "Choose a password with at least 8 characters.",
      "auth/too-many-requests":
        "Too many attempts. Wait a little before trying again.",
      "auth/network-request-failed":
        "Could not connect to sign-in. Check your internet connection.",
      "auth/unauthorized-domain":
        "This website address needs to be authorized in Firebase.",
      "auth/user-disabled": "Your account is banned. Contact the head admin.",
      "auth/operation-not-allowed":
        "The owner needs to enable Email/Password sign-in in Firebase.",
      "auth/invalid-api-key":
        "The owner needs to finish the Firebase connection.",
      "auth/configuration-not-found":
        "The owner needs to enable Firebase Authentication.",
    }[err.code] ||
    err.message ||
    "Sign-in could not be completed."
  );
}
async function authView(generation = state.render) {
  $("#roles").hidden = true;
  $("#navigation").innerHTML = "";
  $("#page-name").textContent = "Sign in";
  $("#avatar").textContent = "D";
  document.body.classList.add("signed-out");
  const config = await api("GET", "/api/auth/config");
  if (generation !== state.render) return;
  $("#access-mode").textContent = "EMAIL-CODE VERIFICATION";
  if (!config.configured || !config.emailDeliveryConfigured) {
    $("#view").innerHTML =
      `<section class="card auth-card auth-setup"><div class="auth-symbol">${icon("user")}</div><h1>Secure sign-in is almost ready.</h1><p class="card-subtitle">The website owner needs to finish connecting Firebase and email delivery before accounts can sign in.</p><div class="setup-status">${pill(config.configured ? "Firebase connected" : "Firebase setup needed", config.configured ? "active" : "pending")}${pill(config.emailDeliveryConfigured ? "Email delivery connected" : "Email delivery setup needed", config.emailDeliveryConfigured ? "active" : "pending")}</div><div class="notice section-gap">${icon("info")}Every account will use a password and an emailed one-time code. Demo role switching is disabled in this mode.</div></section>`;
    return;
  }
  if (!window.GameDayAuth)
    await loadScript(
      FIREBASE_SCRIPT,
      "The sign-in library could not load. Refresh and try again.",
    );
  await GameDayAuth.initialize(config.firebase);
  if (generation !== state.render) return;
  const shell = (inner) =>
    `<section class="card auth-card"><div class="auth-symbol">${icon("user")}</div>${inner}<div class="auth-security-note">${icon("check")}Password + email code. Required for every account.</div></section>`;
  let pending = null,
    busy = false;
  function message(text, bad = false) {
    const el = $("#login-error");
    if (el) {
      el.textContent = text;
      el.className = bad ? "form-error" : "notice";
      el.hidden = false;
    }
  }
  async function submit(form, handler) {
    if (busy) return;
    busy = true;
    const button = $("button[type=submit]", form);
    button.disabled = true;
    try {
      await handler(Object.fromEntries(new FormData(form)));
    } catch (err) {
      message(friendlyAuthError(err), true);
    } finally {
      busy = false;
      if (button.isConnected) button.disabled = false;
    }
  }
  function showForm(mode = "login", initialEmail = "") {
    pending = null;
    $("#view").innerHTML = shell(
      `<h1>${mode === "register" ? "Create your account" : mode === "reset" ? "Reset your password" : "Sign in"}</h1><p class="card-subtitle">${mode === "register" ? "Create your account, verify your email, then sign in securely." : mode === "reset" ? "We’ll email a password-reset link if an account exists." : "Sign in to your points, your pass, and your next game."}</p><div class="filters auth-tabs"><button class="tab-filter ${mode === "login" ? "active" : ""}" id="show-login">Sign in</button><button class="tab-filter ${mode === "register" ? "active" : ""}" id="show-register">Create account</button></div><form id="login-form" class="form-stack">${mode === "register" ? '<label>Full name<input name="name" autocomplete="name" maxlength="80" required></label>' : ""}<label>Email<input type="email" name="email" value="${esc(initialEmail)}" autocomplete="username" maxlength="254" required></label>${mode !== "reset" ? `<label>Password<input type="password" name="password" autocomplete="${mode === "register" ? "new-password" : "current-password"}" minlength="8" required></label>` : ""}${mode === "login" ? '<label>Student ID <span class="muted">(students’ first sign-in only)</span><input name="studentNumber" maxlength="20" autocomplete="off" placeholder="Admins and gate workers can leave blank"></label>' : ""}<button class="btn primary wide" type="submit">${mode === "register" ? "Create account & verify email" : mode === "reset" ? "Send password-reset link" : "Continue to email code"}</button><div id="login-error" role="alert" hidden></div></form><div class="auth-links">${mode !== "reset" ? '<button class="text-button" id="forgot-password">Forgot password?</button>' : ""}${mode === "login" ? '<button class="text-button" id="resend-verification">Resend email verification</button>' : ""}</div>`,
    );
    $("#show-login").onclick = () => {
      if (!busy) showForm("login", $("input[name=email]")?.value);
    };
    $("#show-register").onclick = () => {
      if (!busy) showForm("register", $("input[name=email]")?.value);
    };
    if ($("#forgot-password"))
      $("#forgot-password").onclick = () => {
        if (!busy) showForm("reset", $("input[name=email]")?.value);
      };
    if ($("#resend-verification"))
      $("#resend-verification").onclick = async () => {
        if (busy) return;
        const email = $("input[name=email]").value,
          password = $("input[name=password]").value;
        if (!email || !password)
          return message(
            "Enter your email and password first, then resend verification.",
            true,
          );
        busy = true;
        try {
          await GameDayAuth.resendVerification(email, password);
          message(
            "If your address is unverified, a verification link has been sent.",
          );
        } catch (err) {
          message(friendlyAuthError(err), true);
        } finally {
          busy = false;
        }
      };
    $("#login-form").onsubmit = (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      submit(form, async (data) => {
        if (mode === "register") {
          await GameDayAuth.register(data);
          showForm("login", data.email);
          message(
            "Account created. Open the verification link in your email, then sign in here. Students should enter their student ID on their first sign-in.",
          );
          return;
        }
        if (mode === "reset") {
          await GameDayAuth.resetPassword(data.email);
          message("If an account exists, a password-reset link has been sent.");
          return;
        }
        const who = await GameDayAuth.signIn(data.email, data.password);
        if (!who.emailVerified) {
          await GameDayAuth.signOut();
          throw new Error(
            "Verify your email first. Check your inbox or use “Resend email verification.”",
          );
        }
        const profile = {
          name: who.name,
          studentNumber: data.studentNumber || "",
        };
        const challenge = await api("POST", "/api/auth/firebase/request-code", {
          idToken: who.idToken,
          profile,
        });
        pending = {
          ...challenge,
          idToken: who.idToken,
          profile,
          requestedAt: Date.now(),
        };
        showCode();
      });
    };
  }
  function showCode() {
    const current = pending;
    $("#view").innerHTML = shell(
      `<h1>Check your inbox.</h1><p class="card-subtitle">Enter the 6-digit code sent to <strong>${esc(current.email)}</strong>. It expires in 10 minutes.</p><form id="login-form" class="form-stack"><label>One-time email code<input class="otp-input" name="code" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="one-time-code" required autofocus></label><button class="btn primary wide" type="submit">Verify code & sign in</button><div id="login-error" role="alert" hidden></div></form><div class="auth-links"><button class="text-button" id="resend-code">Send a new code</button><button class="text-button" id="back-login">Back to sign in</button></div><p class="small muted">You can request another code after 60 seconds. Never share your code.</p>`,
    );
    $("#back-login").onclick = async () => {
      if (busy) return;
      await GameDayAuth.signOut();
      showForm();
    };
    $("#resend-code").onclick = async () => {
      if (busy) return;
      if (Date.now() - current.requestedAt < current.resendAfter * 1000)
        return message(
          "Wait 60 seconds after the last email before requesting another code.",
          true,
        );
      busy = true;
      try {
        const next = await api("POST", "/api/auth/firebase/request-code", {
          idToken: current.idToken,
          profile: current.profile,
        });
        pending = { ...current, ...next, requestedAt: Date.now() };
        showCode();
        message("A new code was sent. The previous code no longer works.");
      } catch (err) {
        message(friendlyAuthError(err), true);
      } finally {
        busy = false;
      }
    };
    $("#login-form").onsubmit = (e) => {
      e.preventDefault();
      submit(e.currentTarget, async (data) => {
        await api("POST", "/api/auth/firebase/verify-code", {
          challengeId: current.challengeId,
          code: data.code,
        });
        pending = null;
        await GameDayAuth.signOut();
        await route();
      });
    };
  }
  showForm();
}

const AUDIT_LABELS = Object.freeze({
  "membership.tag_replaced": "QR code replaced",
  "account.created": "Account created",
  "account.invited": "Access assigned",
  "account.banned": "Account banned",
  "account.restored": "Access restored",
  "account.role-changed": "Role changed",
  "auth.login": "Signed in",
  "access.firebase-sync-failed": "Firebase sync failed",
});
VIEWS.access = async () => {
  const [{ users }, { entries }] = await Promise.all([
    api("GET", "/api/admin/users"),
    api("GET", "/api/admin/access-log"),
  ]);
  function rows(q = "") {
    return (
      users
        .filter((u) =>
          `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase()),
        )
        .map(
          (u) =>
            `<tr><td><strong>${esc(u.name)}</strong><small>${esc(u.email)}</small></td><td>${pill(u.isHeadAdmin ? "Head admin" : { student: "Student", staff: "Gate worker", admin: "Admin" }[u.role], u.isHeadAdmin ? "blue" : "")}<small>${backend ? "Sample account" : u.firebaseLinked ? "Firebase linked" : "Not linked yet"}</small></td><td>${pill(u.disabled ? "Banned" : "Allowed", u.disabled ? "inactive" : "active")}${u.banReason ? `<small>${esc(u.banReason)}</small>` : ""}</td><td>${u.isHeadAdmin || u.id === state.user.id ? '<span class="muted">Protected account</span>' : `<button class="btn small" data-access="${u.id}">Manage access</button>`}</td></tr>`,
        )
        .join("") ||
      '<tr><td colspan="4">No accounts match your search.</td></tr>'
    );
  }
  return {
    html:
      heading(
        "Account access",
        "Head-admin controls for roles, bans, and account access.",
        btn("Add admin / gate worker", "invite-access", "primary", "plus"),
      ) +
      `<section class="card"><div class="card-top"><h2>Account access</h2><input type="search" id="access-search" class="search-input" aria-label="Search accounts" placeholder="Search name or email"></div><div class="table-wrap"><table><thead><tr><th>Account</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody id="access-rows">${rows()}</tbody></table></div></section><section class="card section-gap"><h2>Recent access changes</h2><p class="card-subtitle">Sign-ins, invitations, roles, and bans are recorded here.</p>${entries.length ? entries.map((a) => `<div class="activity-item"><div class="activity-badge">${icon("user")}</div><div class="activity-info"><strong>${esc(AUDIT_LABELS[a.action] || a.action)} · ${esc(a.targetName)}</strong><span>${esc(a.actorName)} · ${fmtTime(a.at)}${a.detail ? ` · ${esc(a.detail)}` : ""}</span></div></div>`).join("") : empty("No access changes yet.", "users")}</section>`,
    mount() {
      const wire = () =>
        $$("[data-access]").forEach(
          (b) =>
            (b.onclick = () => {
              const u = users.find((u) => u.id === b.dataset.access);
              showDialog(
                `Manage ${esc(u.name)}`,
                esc(u.email),
                `<div class="form-stack"><label>Role<select name="role">${[
                  ["student", "Student"],
                  ["staff", "Gate worker"],
                  ["admin", "Admin"],
                ]
                  .map(
                    ([v, l]) =>
                      `<option value="${v}" ${u.role === v ? "selected" : ""}>${l}</option>`,
                  )
                  .join(
                    "",
                  )}</select></label><label>Account access<select name="disabled"><option value="false" ${!u.disabled ? "selected" : ""}>Allowed</option><option value="true" ${u.disabled ? "selected" : ""}>Banned</option></select></label><label>Reason <span class="muted">(required for a ban or reinstatement)</span><input name="reason" maxlength="200" placeholder="Explain this access change"></label><div class="notice">${icon("info")}Changes end existing website sessions. Banned users cannot sign in or earn points.</div></div>`,
                async (data) => {
                  await api("PUT", `/api/admin/users/${u.id}`, {
                    role: data.role,
                    disabled: data.disabled === "true",
                    reason: data.reason,
                  });
                  toast("Account access updated.");
                  route();
                },
              );
            }),
        );
      wire();
      $("#access-search").oninput = (e) => {
        $("#access-rows").innerHTML = rows(e.target.value);
        wire();
      };
      $("#invite-access").onclick = () =>
        showDialog(
          "Add an admin or gate worker",
          backend
            ? "In this demo the sample account is added right away."
            : "Assign access now. They must create an account with this email and complete verification before using it.",
          `<div class="form-stack"><label>Full name<input name="name" maxlength="80" required></label><label>Email<input name="email" type="email" required></label><label>Role<select name="role"><option value="admin">Admin</option><option value="staff">Gate worker</option></select></label></div>`,
          async (data) => {
            await api("POST", "/api/admin/users", data);
            toast(
              backend
                ? "Access assigned to the sample account."
                : "Access assigned. Have them register with the same email.",
            );
            route();
          },
          "Assign access",
        );
    },
  };
};
/** URL for a role in the browser demo, so a reload keeps the same role. */
function demoUrl(role, tab) {
  const params = new URLSearchParams(location.search);
  params.set("demo", role);
  return `${location.pathname}?${params}#/${tab}`;
}
function unreachableHelp(err) {
  // A static host has no /api. Point people at the browser demo instead.
  return !backend && err.network
    ? `<p class="small muted section-gap">Just looking around? <a class="text-link" href="/sentinel-preview/app/?demo=student">Open the browser demo</a>. It runs on sample data and needs no server.</p>`
    : "";
}
async function route() {
  const generation = ++state.render;
  state.cleanup?.();
  state.cleanup = null;
  if ($("#dialog").open) $("#dialog").close();
  try {
    const me = await api("GET", "/api/me");
    if (generation !== state.render) return;
    state.demo = me.demo;
    state.user = me.user;
    if (!state.user && state.demo)
      state.user = (
        await api("POST", "/api/demo/switch", {
          role: DEMO_ROLE_PARAM || "student",
        })
      ).user;
    if (generation !== state.render) return;
    if (!state.user) return await authView(generation);
    document.body.classList.remove("signed-out");
    $("#access-mode").textContent = backend
      ? "Browser demo"
      : state.demo
        ? "DEMO EXPERIENCE"
        : "EMAIL-CODE VERIFICATION";
    let tab = location.hash.replace("#/", "").split("?")[0];
    const nav = [...NAV[state.user.role]];
    if (state.user.isHeadAdmin)
      nav.splice(nav.length - 1, 0, ["access", "Account access", "users"]);
    if (!nav.some(([id]) => id === tab)) {
      tab = nav[0][0];
      history.replaceState(
        null,
        "",
        backend ? demoUrl(state.user.role, tab) : `#/${tab}`,
      );
    }
    $("#roles").hidden = !state.demo;
    $$("#roles button").forEach((b) => {
      b.classList.toggle("active", b.dataset.role === state.user.role);
      b.setAttribute(
        "aria-pressed",
        String(b.dataset.role === state.user.role),
      );
    });
    $("#avatar").textContent = state.user.name
      .split(" ")
      .map((n) => n[0])
      .slice(0, 2)
      .join("");
    $("#avatar").title = state.user.name;
    const label = nav.find(([id]) => id === tab)[1];
    $("#page-name").textContent = label;
    $("#navigation").innerHTML = nav
      .map(
        ([id, text, ico]) =>
          `<a href="#/${id}" class="${id === tab ? "active" : ""}" ${id === tab ? 'aria-current="page"' : ""}>${icon(ico)}${text}</a>`,
      )
      .join("");
    document.title = `${label} | Sentinel`;
    $("#view").innerHTML =
      '<div class="loading">Loading…</div>';
    const view = await VIEWS[tab]();
    if (generation !== state.render) return;
    $("#view").innerHTML = view.html;
    await view.mount?.();
  } catch (err) {
    if (generation !== state.render) return;
    $("#view").innerHTML =
      `<section class="card">${empty(esc(err.message), "info")}<button class="btn primary" id="retry">Try again</button>${unreachableHelp(err)}</section>`;
    $("#retry").onclick = route;
  }
}
$$("#roles button").forEach(
  (b) =>
    (b.onclick = async () => {
      if (b.dataset.role === state.user?.role) return;
      $$("#roles button").forEach((el) => {
        el.disabled = true;
      });
      state.cleanup?.();
      state.cleanup = null;
      try {
        const { user } = await api("POST", "/api/demo/switch", {
          role: b.dataset.role,
        });
        state.user = user;
        const first = NAV[user.role][0][0];
        history.replaceState(
          null,
          "",
          backend ? demoUrl(user.role, first) : `#/${first}`,
        );
        await route();
      } catch (err) {
        toast(err.message, true);
      } finally {
        $$("#roles button").forEach((el) => {
          el.disabled = false;
        });
      }
    }),
);

/* ----- Connection status (real mode) ------------------------------ */

function showConnection() {
  const banner = $("#net-banner");
  if (banner) banner.hidden = !!backend || navigator.onLine !== false;
}
window.addEventListener("online", showConnection);
window.addEventListener("offline", showConnection);

/* ----- Browser demo ------------------------------------------------ */

function showDemoBanner() {
  const banner = $("#demo-banner");
  banner.hidden = false;
  document.body.classList.add("browser-demo");
  const note = $("#demo-storage-note");
  const problem = backend.storageProblem;
  note.hidden = !problem;
  note.textContent =
    problem === "full"
      ? "Browser storage is full, so new changes last only until you close this tab."
      : problem
        ? "This browser blocks storage, so changes last only until you close this tab."
        : "";
}
function resetDemo() {
  state.cleanup?.(); // stop the camera before the data disappears
  state.cleanup = null;
  const role = state.user?.role || DEMO_ROLE_PARAM || "student";
  backend.reset(role);
  safeSession.remove("gateEvent");
  history.replaceState(null, "", demoUrl(role, NAV[role][0][0]));
  toast("Demo reset. Fresh sample data is ready.");
  showDemoBanner();
  route();
}
async function startBrowserDemo() {
  await loadScript(
    DEMO_SCRIPT,
    "The demo could not load. Reload the page to try again.",
  );
  backend = window.GameDay.demoApi.createDemoBackend({
    storage: () => window.localStorage,
  });
  if (DEMO_ROLE_PARAM) backend.ensureRole(DEMO_ROLE_PARAM);
  $("#demo-reset").onclick = resetDemo;
  // Another tab reset the demo: show the fresh data here too.
  window.addEventListener("storage", (e) => {
    if (e.key === backend.STORAGE_KEY && e.newValue === null) route();
  });
  showDemoBanner();
}

async function boot() {
  if (!rules || !qr) {
    $("#view").innerHTML =
      `<section class="card">${empty("Part of the app did not load. Reload the page to try again.", "info")}</section>`;
    return;
  }
  if (BROWSER_DEMO) {
    try {
      await startBrowserDemo();
    } catch (err) {
      $("#view").innerHTML =
        `<section class="card">${empty(esc(err.message), "info")}</section>`;
      return;
    }
  }
  showConnection();
  // The skip link must not count as a route change.
  $(".skip-link").onclick = (e) => {
    e.preventDefault();
    $("#view").focus();
  };
  window.addEventListener("hashchange", () => {
    if (!location.hash || location.hash.startsWith("#/")) route();
  });
  window.addEventListener("pagehide", () => state.cleanup?.());
  route();
}
boot();
})();
