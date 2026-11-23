/* Sentinel: browser-only demo backend.
 *
 * Loaded only when the app opens with ?demo=student, ?demo=staff, or
 * ?demo=admin. It answers the same /api/* requests as server.js, using the
 * same shared rules (public/shared/rules.js), but keeps sample data in this
 * browser. It never calls the network, so it cannot touch real data.
 *
 * Storage: localStorage when available, otherwise memory for this tab only.
 * Every request reloads the saved state first, so two tabs stay consistent,
 * and a failed change is rolled back from a snapshot.
 *
 * Classic browser script (window.GameDay.demoApi) and CommonJS module.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports)
    module.exports = factory(
      require("../shared/rules.js"),
      require("../shared/qr.js"),
    );
  else {
    root.GameDay = root.GameDay || {};
    root.GameDay.demoApi = factory(root.GameDay.rules, root.GameDay.qr);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (rules, qr) {
  "use strict";

  const STORAGE_KEY = "gameday-rewards-demo";
  const STATE_VERSION = 1;
  const DB_VERSION = 2;
  const ROLES = rules.ROLES;
  const DEFAULT_ROLE = "student";
  const ID_BYTES = 8;
  const MESSAGES = Object.freeze({
    login: "Please log in.",
    forbidden: "You do not have access to that.",
    notFound: "Not found.",
    firebaseOff: "Firebase sign-in is not available in demo mode.",
    crashed:
      "Something went wrong in the demo. Use Reset demo to start over with fresh sample data.",
  });

  /* ----- Small sync SHA-256 (retired codes are stored as hashes) ------ */

  const SHA_K = [];
  const SHA_H0 = [];
  (function buildConstants() {
    const frac = (x) => ((x - Math.floor(x)) * 0x100000000) >>> 0;
    for (let n = 2, found = 0; found < 64; n++) {
      let prime = true;
      for (let d = 2; d * d <= n; d++) if (n % d === 0) prime = false;
      if (!prime) continue;
      if (found < 8) SHA_H0.push(frac(Math.sqrt(n)));
      SHA_K.push(frac(Math.cbrt(n)));
      found++;
    }
  })();
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));

  function sha256Hex(message) {
    const bytes = new TextEncoder().encode(String(message));
    const length = bytes.length;
    const padded = new Uint8Array(((length + 9 + 63) >> 6) << 6);
    padded.set(bytes);
    padded[length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, Math.floor(length / 0x20000000));
    view.setUint32(padded.length - 4, (length << 3) >>> 0);
    const h = SHA_H0.slice();
    const w = new Uint32Array(64);
    for (let offset = 0; offset < padded.length; offset += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, k] = h;
      for (let i = 0; i < 64; i++) {
        const t1 =
          (k +
            (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) +
            ((e & f) ^ (~e & g)) +
            SHA_K[i] +
            w[i]) >>>
          0;
        const t2 =
          ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) +
            ((a & b) ^ (a & c) ^ (b & c))) >>>
          0;
        k = g;
        g = f;
        f = e;
        e = (d + t1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) >>> 0;
      }
      [a, b, c, d, e, f, g, k].forEach((v, i) => {
        h[i] = (h[i] + v) >>> 0;
      });
    }
    return h.map((v) => v.toString(16).padStart(8, "0")).join("");
  }

  /* ----- Storage that never throws ------------------------------------ */

  /** Wraps localStorage (or a test double). Falls back to memory. */
  function createStore(getStorage) {
    let storage = null;
    let problem = "";
    try {
      storage = getStorage ? getStorage() : null;
      if (storage) {
        const probe = `${STORAGE_KEY}-probe`;
        storage.setItem(probe, "1");
        storage.removeItem(probe);
      }
    } catch {
      storage = null;
    }
    if (!storage) problem = "blocked";
    return {
      get mode() {
        return storage ? "local" : "memory";
      },
      get problem() {
        return problem;
      },
      load() {
        if (!storage) return null;
        try {
          const raw = storage.getItem(STORAGE_KEY);
          return raw ? JSON.parse(raw) : null;
        } catch {
          return null; // unreadable or corrupted: start fresh
        }
      },
      save(state) {
        if (!storage) return false;
        try {
          storage.setItem(STORAGE_KEY, JSON.stringify(state));
          problem = "";
          return true;
        } catch (err) {
          // Quota exceeded or storage revoked: keep working in memory.
          problem = /quota/i.test(`${err && err.name} ${err && err.message}`)
            ? "full"
            : "blocked";
          return false;
        }
      },
      clear() {
        if (!storage) return;
        try {
          storage.removeItem(STORAGE_KEY);
        } catch {
          /* nothing to clear */
        }
      },
    };
  }

  /* ----- Backend ------------------------------------------------------ */

  function defaultRandomBytes(n) {
    const bytes = new Uint8Array(n);
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }

  /**
   * @param {object} [options]
   * @param {() => Storage} [options.storage]  returns localStorage (may throw)
   * @param {(n: number) => Uint8Array} [options.randomBytes]
   * @param {() => string} [options.now]
   */
  function createDemoBackend(options = {}) {
    const store = createStore(options.storage);
    const randomBytes = options.randomBytes || defaultRandomBytes;
    const now = options.now || (() => new Date().toISOString());
    let state = null;
    let unsaved = false; // true while changes exist only in memory

    const randomChars = (n) => {
      const alphabet = rules.CODE.alphabet;
      let out = "";
      for (const b of randomBytes(n)) out += alphabet[b % alphabet.length];
      return out;
    };
    const newId = (prefix) =>
      `${prefix}_${Array.from(randomBytes(ID_BYTES), (b) => b.toString(16).padStart(2, "0")).join("")}`;
    const svc = rules.createService({
      getDb: () => state.db,
      newId,
      hash: sha256Hex,
      randomChars,
      now,
      acceptCode: qr.scanFriendly,
    });

    function freshState(role) {
      state = {
        version: STATE_VERSION,
        role: ROLES.includes(role) ? role : DEFAULT_ROLE,
        createdAt: now(),
        db: rules.emptyDb(DB_VERSION),
      };
      svc.seedCatalog();
      svc.seedDemoPeople();
      svc.normalizeData();
      // The browser demo signs in Coach Nelson as head admin so the account
      // access screens can be shown. The server demo has no head admin.
      svc.demoAccount("admin").isHeadAdmin = true;
      return state;
    }
    function isValidState(s) {
      return (
        s &&
        s.version === STATE_VERSION &&
        s.db &&
        s.db.version === DB_VERSION &&
        Array.isArray(s.db.users) &&
        Array.isArray(s.db.events)
      );
    }
    /** Picks up changes from other tabs; keeps memory state if storage is off. */
    function sync() {
      const saved = unsaved ? null : store.load();
      if (isValidState(saved)) state = saved;
      else if (!state) {
        freshState(DEFAULT_ROLE);
        persist();
      }
    }
    function persist() {
      unsaved = !store.save(state);
    }

    function currentUser() {
      const user = state.role ? svc.demoAccount(state.role) : null;
      return user && !user.disabled ? user : null;
    }
    function switchRole(role) {
      const user = svc.prepareDemoAccount(role);
      state.role = role;
      return { user: svc.publicUser(user) };
    }

    const TEXT = "__text"; // marks a plain-text (CSV) response
    const ANY = ["student", "staff", "admin"];
    const STUDENT = ["student"];
    const STAFF = ["staff", "admin"];
    const ADMIN = ["admin"];
    // [method, path pattern, allowed roles (null = public), handler, writes?]
    const ROUTES = [
      ["GET", "/api/me", null, ({ user }) => ({
        user: user ? svc.publicUser(user) : null,
        demo: true,
        authMode: "demo",
        browserDemo: true,
      })],
      ["GET", "/api/auth/config", null, () => ({
        mode: "demo",
        configured: false,
        emailDeliveryConfigured: false,
        firebase: null,
        requiresEmailCode: true,
      })],
      ["POST", "/api/auth/logout", null, () => {
        state.role = null;
        return { ok: true };
      }, true],
      ["POST", "/api/auth/firebase/request-code", null, () => {
        throw new rules.RuleError(404, MESSAGES.firebaseOff);
      }],
      ["POST", "/api/auth/firebase/verify-code", null, () => {
        throw new rules.RuleError(404, MESSAGES.firebaseOff);
      }],
      ["POST", "/api/demo/switch", null, ({ body }) => switchRole(body.role), true],
      ["GET", "/api/me/profile", STUDENT, ({ user }) => svc.userProfile(user)],
      ["POST", "/api/me/membership/reset-tag", STUDENT, ({ user, body }) =>
        svc.resetOwnCode(user, body), true],
      ["GET", "/api/events", ANY, () => svc.listEvents()],
      ["GET", "/api/rewards", ANY, ({ user, query }) =>
        svc.listRewards(user, query.get("all") === "1")],
      ["GET", "/api/me/activity", STUDENT, ({ user }) => svc.activity(user)],
      ["POST", "/api/rewards/:id/order", STUDENT, ({ user, params }) =>
        svc.orderReward(user, params.id), true],
      ["GET", "/api/me/attendance", STUDENT, ({ user }) => svc.myAttendance(user)],
      ["GET", "/api/gate/members", STAFF, ({ query }) =>
        svc.gateMembers(query.get("eventId"), query.get("q"))],
      ["GET", "/api/gate/lookup", STAFF, ({ query }) =>
        svc.gateLookup(query.get("eventId"), query.get("code"))],
      ["GET", "/api/gate/attendance", STAFF, ({ query }) =>
        svc.gateAttendance(query.get("eventId"))],
      ["POST", "/api/gate/check-in", STAFF, ({ user, body }) =>
        svc.checkIn(user, body), true],
      ["POST", "/api/admin/members", ADMIN, ({ body }) =>
        svc.createMember(body), true],
      ["PUT", "/api/admin/members/:id", ADMIN, ({ user, params, body }) =>
        svc.updateMember(user, params.id, body), true],
      ["POST", "/api/admin/events", ADMIN, ({ body }) => svc.createEvent(body), true],
      ["PUT", "/api/admin/events/:id", ADMIN, ({ params, body }) =>
        svc.updateEvent(params.id, body), true],
      ["DELETE", "/api/admin/events/:id", ADMIN, ({ params }) =>
        svc.deleteEvent(params.id), true],
      ["POST", "/api/admin/rewards", ADMIN, ({ body }) => svc.createReward(body), true],
      ["PUT", "/api/admin/rewards/:id", ADMIN, ({ params, body }) =>
        svc.updateReward(params.id, body), true],
      ["GET", "/api/admin/orders", ADMIN, () => svc.adminOrders()],
      ["POST", "/api/admin/orders/:id/:action", ADMIN, ({ user, params }) =>
        svc.handleOrder(user, params.id, params.action), true],
      ["GET", "/api/admin/users/:id/profile", ADMIN, ({ params }) =>
        svc.adminUserProfile(params.id)],
      ["GET", "/api/admin/users", ADMIN, ({ query }) => svc.listUsers(query.get("q"))],
      ["POST", "/api/admin/users", ADMIN, ({ body }) => ({
        user: svc.publicUser(svc.inviteDemoStaff(body)),
      }), true],
      ["POST", "/api/admin/users/:id/points", ADMIN, ({ user, params, body }) =>
        svc.adjustPoints(user, params.id, body), true],
      ["PUT", "/api/admin/users/:id", ADMIN, ({ user, params, body }) =>
        svc.updateDemoAccess(user, params.id, body), true],
      ["GET", "/api/admin/access-log", ADMIN, ({ user }) => svc.accessLog(user)],
      ["GET", "/api/admin/overview", ADMIN, () => svc.overview()],
      ["GET", "/api/admin/export/ledger.csv", ADMIN, () => ({
        [TEXT]: svc.ledgerCsv(),
      })],
    ].map(([method, pattern, roles, handler, writes]) => ({
      method,
      roles,
      handler,
      writes: !!writes,
      keys: (pattern.match(/:\w+/g) || []).map((k) => k.slice(1)),
      regex: new RegExp(
        "^" + pattern.replace(/:\w+/g, "([^/]+)").replace(/\./g, "\\.") + "$",
      ),
    }));
    function match(method, pathname) {
      for (const route of ROUTES) {
        if (route.method !== method) continue;
        const m = route.regex.exec(pathname);
        if (!m) continue;
        const params = {};
        route.keys.forEach((key, i) => {
          try {
            params[key] = decodeURIComponent(m[i + 1]);
          } catch {
            params[key] = m[i + 1];
          }
        });
        return { route, params };
      }
      return null;
    }

    /**
     * Handles one request synchronously.
     * @returns {{ status: number, data?: object, text?: string }}
     */
    function handle(method, url, body) {
      const verb = String(method || "GET").toUpperCase();
      let parsed;
      try {
        parsed = new URL(String(url), "http://demo.invalid");
      } catch {
        return { status: 400, data: { error: "Bad request." } };
      }
      sync();
      const found = match(verb, parsed.pathname);
      if (!found) return { status: 404, data: { error: MESSAGES.notFound } };
      const { route, params } = found;
      const user = currentUser();
      if (route.roles) {
        if (!user) return { status: 401, data: { error: MESSAGES.login } };
        if (!route.roles.includes(user.role))
          return { status: 403, data: { error: MESSAGES.forbidden } };
      }
      const input =
        body && typeof body === "object" && !Array.isArray(body) ? body : {};
      const snapshot = route.writes ? JSON.stringify(state) : null;
      try {
        const result = route.handler({
          user,
          params,
          query: parsed.searchParams,
          body: input,
        });
        if (route.writes) persist();
        if (result && TEXT in result) return { status: 200, text: result[TEXT] };
        // Return a copy so callers can never mutate demo state directly.
        return { status: 200, data: JSON.parse(JSON.stringify(result)) };
      } catch (err) {
        if (snapshot) state = JSON.parse(snapshot);
        if (err instanceof rules.RuleError)
          return { status: err.status, data: { error: err.message } };
        if (typeof console !== "undefined") console.error(err);
        return { status: 500, data: { error: MESSAGES.crashed } };
      }
    }

    return {
      handle,
      /** Starts over with fresh sample data, signed in as `role`. */
      reset(role = DEFAULT_ROLE) {
        store.clear();
        freshState(role);
        persist();
        return state.role;
      },
      /** Switches the signed-in sample account without an API call. */
      ensureRole(role) {
        sync();
        if (!ROLES.includes(role)) return;
        if (state.role === role && currentUser()) return;
        switchRole(role);
        persist();
      },
      get role() {
        sync();
        return state.role;
      },
      get storageMode() {
        return store.mode;
      },
      get storageProblem() {
        return store.problem;
      },
      STORAGE_KEY,
    };
  }

  return Object.freeze({ createDemoBackend, sha256Hex, STORAGE_KEY });
});
