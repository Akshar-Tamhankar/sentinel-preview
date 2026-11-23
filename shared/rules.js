/* Sentinel: shared business rules.
 *
 * One source of truth for memberships, gate check-ins, points, reward orders,
 * refunds, adjustments, and membership code replacement. Used by server.js
 * (through require) and by the browser-only demo backend (as a classic
 * script that sets window.GameDay.rules).
 *
 * The module does no I/O. Callers pass a context with the database object,
 * a clock, an id generator, a hash function, and a random source. Every
 * operation validates its input before it changes anything, so a thrown
 * RuleError never leaves partial changes behind.
 */
(function (root, factory) {
  "use strict";
  const rules = factory();
  if (typeof module === "object" && module.exports) module.exports = rules;
  else {
    root.GameDay = root.GameDay || {};
    root.GameDay.rules = rules;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SCHOOL_TIME_ZONE = "America/New_York";
  const SCHOOL_NAME = "Sample High School";
  const DAY_MS = 86400000;

  // Membership codes: "D" + 11 characters from a 32-character alphabet with
  // no 0/O/1/I. This is the same format the CODE128 cards used, so every
  // existing code keeps working when typed or encoded as a QR code.
  const CODE = Object.freeze({
    alphabet: "23456789ABCDEFGHJKLMNPQRSTUVWXYZ",
    prefix: "D",
    randomLength: 11,
    pattern: /^D[2-9A-HJ-NP-Z]{11}$/,
    maxAttempts: 200,
  });

  const LIMITS = Object.freeze({
    personName: 80,
    studentNumber: 20,
    eventName: 100,
    rewardName: 80,
    description: 200,
    location: 100,
    sport: 40,
    reason: 120,
    codeInput: 40,
    search: 80,
    maxAdjustment: 100000,
    maxEventPoints: 10000,
    maxRewardCost: 100000,
    activityLedger: 100,
    accessLog: 100,
    overviewRecent: 8,
  });

  const ROLES = Object.freeze(["student", "staff", "admin"]);
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

  const MESSAGES = Object.freeze({
    gateClosed: "This gate is closed. Ask a coach to open it.",
    admissionUnconfirmed:
      "Confirm the student’s admission in GoFan before awarding points.",
    memberNotFound: "Membership not found. Try manual lookup or ask a coach.",
    membershipInactive:
      "This membership is inactive or expired. Ask a coach to check it.",
    notOurCode:
      "This QR code is not a Sentinel membership code. Ask for the student’s membership QR code or use name lookup.",
    retiredCode:
      "This QR code was replaced and no longer works. Ask the student to open their new code, or use name lookup.",
    unknownCode:
      "No member has this QR code. Check the code or use name lookup.",
    chooseEvent: "Choose an event.",
  });

  // Demo people shared by the server's demo mode and the browser-only demo.
  const DEMO_ACCOUNTS = Object.freeze({
    student: {
      name: "Ava Clark",
      email: "student@demo.local",
      studentNumber: "100234",
      role: "student",
    },
    staff: { name: "Coach Rivera", email: "staff@demo.local", role: "staff" },
    admin: { name: "Coach Nelson", email: "admin@demo.local", role: "admin" },
  });
  const DEMO_MEMBERS = Object.freeze([
    {
      name: "Marcus Lee",
      email: "marcus@demo.local",
      studentNumber: "100871",
      pts: 200,
      active: true,
    },
    {
      name: "Sophia Nguyen",
      email: "sophia@demo.local",
      studentNumber: "101102",
      pts: 50,
      active: true,
    },
    {
      name: "Jordan Brooks",
      email: "jordan@demo.local",
      studentNumber: "101455",
      pts: 0,
      active: false,
    },
  ]);
  const DEMO_STARTING_POINTS = 150;

  class RuleError extends Error {
    constructor(status, message) {
      super(message);
      this.name = "RuleError";
      this.status = status;
    }
  }
  const fail = (status, message) => {
    throw new RuleError(status, message);
  };

  /* ----- Plain helpers ------------------------------------------------ */

  function cleanText(value, max = 200) {
    return String(value ?? "")
      .replace(/[\u0000-\u001f]/g, "")
      .trim()
      .slice(0, max);
  }
  function toInt(value) {
    const n = Number(value);
    return Number.isInteger(n) ? n : NaN;
  }
  function normEmail(email) {
    return String(email || "")
      .trim()
      .toLowerCase();
  }
  const isEmail = (email) => EMAIL_PATTERN.test(email);
  function isRealDate(value) {
    return (
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value
    );
  }
  function schoolToday(date = new Date()) {
    return date.toLocaleDateString("en-CA", { timeZone: SCHOOL_TIME_ZONE });
  }
  function seasonEnd(date = new Date()) {
    const part = (option) =>
      Number(
        new Intl.DateTimeFormat("en", {
          [option]: "numeric",
          timeZone: SCHOOL_TIME_ZONE,
        }).format(date),
      );
    return part("year") + (part("month") > 6 ? 1 : 0) + "-06-30";
  }
  function addDays(days, from = Date.now()) {
    return new Date(from + days * DAY_MS).toISOString().slice(0, 10);
  }

  /** Normalize what a scanner or a person typed into a membership code. */
  function normalizeCode(raw) {
    return cleanText(raw, LIMITS.codeInput)
      .replace(/[\s-]/g, "")
      .toUpperCase();
  }
  /** Returns { ok: true, code } or { ok: false } for text that is not ours. */
  function parseMembershipCode(raw) {
    const code = normalizeCode(raw);
    return CODE.pattern.test(code) ? { ok: true, code } : { ok: false, code };
  }

  function membershipActive(user, today = schoolToday()) {
    return !!(
      user &&
      !user.disabled &&
      user.membership?.active &&
      user.membership.expires >= today
    );
  }

  function csvCell(value) {
    // Quote every cell; prefix text that Excel would treat as a formula.
    let s = String(value ?? "");
    if (typeof value !== "number" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  }

  /* ----- Service bound to one database --------------------------------- */

  /**
   * @param {object} ctx
   * @param {() => object} ctx.getDb      current database object
   * @param {(prefix: string) => string} ctx.newId
   * @param {(value: string) => string} ctx.hash   sync SHA-256 hex
   * @param {(n: number) => string} ctx.randomChars  n chars from CODE.alphabet
   * @param {() => string} [ctx.now]       ISO timestamp
   * @param {() => string} [ctx.today]     YYYY-MM-DD in school time
   * @param {(code: string) => boolean} [ctx.acceptCode]  extra check for new
   *   codes; both backends pass GameDay.qr.scanFriendly
   */
  function createService(ctx) {
    const db = () => ctx.getDb();
    const now = ctx.now || (() => new Date().toISOString());
    const today = ctx.today || (() => schoolToday());
    const { newId, hash, randomChars } = ctx;
    const acceptCode = ctx.acceptCode || (() => true);

    const findUser = (id) => db().users.find((u) => u.id === id) || null;
    const findEvent = (id) => db().events.find((e) => e.id === id) || null;
    const findReward = (id) => db().rewards.find((r) => r.id === id) || null;
    const isActive = (user) => membershipActive(user, today());

    function publicUser(u) {
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        studentNumber: u.studentNumber || "",
        role: u.role,
        points: u.points,
        disabled: !!u.disabled,
        isHeadAdmin: !!u.isHeadAdmin,
        firebaseLinked: !!u.firebaseUid,
        banReason: u.banReason || "",
        lastLoginAt: u.lastLoginAt || null,
        createdAt: u.createdAt,
        membership:
          u.role === "student"
            ? { ...u.membership, valid: isActive(u) }
            : null,
      };
    }

    function addPoints(user, delta, reason, byUserId = null, ref = null) {
      user.points += delta;
      db().ledger.push({
        id: newId("led"),
        userId: user.id,
        delta,
        reason,
        ref,
        by: byUserId,
        at: now(),
      });
    }

    /* Membership codes */

    function isRetiredCode(code) {
      return (db().retiredTagHashes || []).includes(hash(code));
    }
    function newMembershipCode() {
      for (let attempt = 0; ; attempt++) {
        const code = CODE.prefix + randomChars(CODE.randomLength);
        if (
          db().users.some((u) => u.membership?.tag === code) ||
          isRetiredCode(code)
        )
          continue;
        // About half of random codes pass; the cap only guards a broken check.
        if (attempt < CODE.maxAttempts && !acceptCode(code)) continue;
        return code;
      }
    }
    function newMembership(active = false) {
      return { tag: newMembershipCode(), active, expires: seasonEnd() };
    }
    function replaceMembershipCode(user, actorId, detail) {
      const replacement = newMembershipCode();
      const data = db();
      data.retiredTagHashes ||= [];
      if (user.membership?.tag)
        data.retiredTagHashes.push(hash(user.membership.tag));
      user.membership = {
        ...user.membership,
        tag: replacement,
        tagUpdatedAt: now(),
      };
      data.audit.push({
        id: newId("audit"),
        at: now(),
        by: actorId,
        action: "membership.tag_replaced",
        target: user.id,
        detail,
      });
    }
    function findStudentByCode(code) {
      const user = db().users.find((u) => u.membership?.tag === code);
      return user && user.role === "student" ? user : null;
    }

    /* Accounts and seed data */

    /** Creates an account. `secrets` holds server-only fields (password hash). */
    function createAccount({ name, email, studentNumber, role }, secrets = {}) {
      const user = {
        id: newId("usr"),
        name,
        email,
        studentNumber: studentNumber || "",
        role,
        points: 0,
        ...secrets,
        disabled: false,
        createdAt: now(),
      };
      db().users.push(user);
      if (role === "student") user.membership = newMembership(false);
      return user;
    }
    const demoAccount = (role) => {
      const acct = DEMO_ACCOUNTS[role];
      return acct ? db().users.find((u) => u.email === acct.email) : null;
    };

    function seedCatalog() {
      const data = db();
      data.events.push(
        {
          id: newId("evt"),
          name: "Football vs. Eastside",
          date: addDays(1),
          points: 50,
          open: false,
          createdAt: now(),
        },
        {
          id: newId("evt"),
          name: "Basketball Home Opener",
          date: addDays(14),
          points: 50,
          open: false,
          createdAt: now(),
        },
      );
      data.rewards.push(
        {
          id: newId("rwd"),
          name: "Concession Voucher",
          description: "$5 at the concession stand",
          cost: 100,
          stock: null,
          active: true,
        },
        {
          id: newId("rwd"),
          name: "$10 Gift Card",
          description: "Picked up from the athletics office",
          cost: 250,
          stock: 20,
          active: true,
        },
        {
          id: newId("rwd"),
          name: "Spirit T-Shirt",
          description: "Limited student section shirt",
          cost: 400,
          stock: 15,
          active: true,
        },
      );
    }

    /** Adds the sample people once. `create` may add server-only secrets. */
    function seedDemoPeople(create = createAccount) {
      const data = db();
      if (data.users.some((u) => u.email === DEMO_ACCOUNTS.student.email))
        return false;
      for (const acct of Object.values(DEMO_ACCOUNTS)) create({ ...acct });
      const ava = demoAccount("student");
      ava.membership.active = true;
      addPoints(ava, DEMO_STARTING_POINTS, "Demo starting points");
      if (data.events[0]) data.events[0].open = true;
      for (const x of DEMO_MEMBERS) {
        const u = create({
          name: x.name,
          email: x.email,
          studentNumber: x.studentNumber,
          role: "student",
        });
        u.membership.active = x.active;
        if (x.pts) addPoints(u, x.pts, "Demo starting points");
      }
      return true;
    }

    /** Fills fields added by later versions and carries legacy attendance. */
    function normalizeData() {
      const data = db();
      for (const u of data.users.filter((u) => u.role === "student")) {
        if (!u.membership)
          u.membership = {
            tag: newMembershipCode(),
            active: u.email !== "jordan@demo.local",
            expires: seasonEnd(),
          };
      }
      for (const t of (data.tickets || []).filter((t) => t.redeemedAt)) {
        if (!data.attendance.some((a) => a.legacyTicketId === t.id))
          data.attendance.push({
            id: newId("att"),
            legacyTicketId: t.id,
            userId: t.userId,
            eventId: t.eventId,
            points: findEvent(t.eventId)?.points || 0,
            at: t.redeemedAt,
            by: t.issuedBy,
            method: "legacy",
          });
      }
      for (const e of data.events) {
        if (!e.sport)
          e.sport = /basketball/i.test(e.name)
            ? "Basketball"
            : /volley/i.test(e.name)
              ? "Volleyball"
              : "Football";
        if (!e.location) e.location = SCHOOL_NAME;
        if (!e.time) e.time = "19:30";
      }
      const admin = demoAccount("admin");
      if (admin && !data.membershipDemoVersion) admin.name = "Coach Nelson";
      data.membershipDemoVersion = 1;
    }

    /** Server demo and browser demo: restore a sample account before use. */
    function prepareDemoAccount(role) {
      const user = demoAccount(role);
      if (!user) fail(400, "Unknown role.");
      user.disabled = false;
      user.role = role; // undo any role change made from the access screen
      return user;
    }

    /* Read models */

    function attendanceRecord(a) {
      return {
        ...a,
        studentName: findUser(a.userId)?.name || "Former student",
        studentNumber: findUser(a.userId)?.studentNumber || "",
        eventName: findEvent(a.eventId)?.name || "Removed event",
        workerName: findUser(a.by)?.name || "Program administrator",
      };
    }
    function listEvents() {
      const data = db();
      return {
        events: data.events
          .slice()
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((e) => ({
            ...e,
            attendanceCount: data.attendance.filter((t) => t.eventId === e.id)
              .length,
          })),
      };
    }
    function listRewards(actor, wantAll) {
      const all = actor.role === "admin" && wantAll;
      return { rewards: db().rewards.filter((r) => all || r.active) };
    }
    function activity(user) {
      const data = db();
      const ledger = data.ledger
        .filter((l) => l.userId === user.id)
        .slice(-LIMITS.activityLedger)
        .reverse()
        .map(({ id, delta, reason, at }) => ({ id, delta, reason, at }));
      const orders = data.orders
        .filter((o) => o.userId === user.id)
        .slice()
        .reverse()
        .map((o) => ({
          ...o,
          rewardName: findReward(o.rewardId)?.name || "Removed reward",
        }));
      const attended = data.attendance.filter(
        (t) => t.userId === user.id,
      ).length;
      return { ledger, orders, attended };
    }
    function myAttendance(user) {
      return {
        attendance: db()
          .attendance.filter((a) => a.userId === user.id)
          .slice()
          .reverse()
          .map(attendanceRecord),
      };
    }
    function gateMember(u, event) {
      return {
        id: u.id,
        name: u.name,
        studentNumber: u.studentNumber,
        membership: { valid: isActive(u) },
        checkedIn: db().attendance.some(
          (a) => a.userId === u.id && a.eventId === event.id,
        ),
      };
    }
    function gateMembers(eventId, query) {
      const event = findEvent(eventId);
      if (!event) fail(404, MESSAGES.chooseEvent);
      const q = cleanText(query, LIMITS.search).toLowerCase();
      return {
        members: db()
          .users.filter(
            (u) =>
              u.role === "student" &&
              (!q ||
                [u.name, u.studentNumber, u.membership?.tag].some((v) =>
                  String(v || "")
                    .toLowerCase()
                    .includes(q),
                )),
          )
          .map((u) => gateMember(u, event)),
      };
    }
    /** Exact lookup of a scanned or typed code, with a specific reason on failure. */
    function gateLookup(eventId, rawCode) {
      const event = findEvent(eventId);
      if (!event) fail(404, MESSAGES.chooseEvent);
      const parsed = parseMembershipCode(rawCode);
      if (!parsed.ok) fail(400, MESSAGES.notOurCode);
      const user = findStudentByCode(parsed.code);
      if (!user)
        fail(
          isRetiredCode(parsed.code) ? 410 : 404,
          isRetiredCode(parsed.code)
            ? MESSAGES.retiredCode
            : MESSAGES.unknownCode,
        );
      return { member: gateMember(user, event), code: parsed.code };
    }
    function gateAttendance(eventId) {
      return {
        attendance: db()
          .attendance.filter((a) => a.eventId === eventId)
          .slice()
          .reverse()
          .map(attendanceRecord),
      };
    }

    function userProfile(user) {
      const data = db();
      const newestFirst = (key) => (a, b) =>
        String(b[key] || "").localeCompare(String(a[key] || ""));
      const orders = data.orders
        .filter((o) => o.userId === user.id)
        .map((o) => ({
          id: o.id,
          rewardName: findReward(o.rewardId)?.name || "Removed reward",
          cost: o.cost,
          status: o.status,
          createdAt: o.createdAt,
          handledAt: o.handledAt || null,
          handledByName: findUser(o.handledBy)?.name || "",
        }))
        .sort(newestFirst("createdAt"));
      const orderIds = new Set(orders.map((o) => o.id));
      const ledger = data.ledger
        .filter((l) => l.userId === user.id)
        .map((l) => ({
          id: l.id,
          delta: l.delta,
          reason: l.reason,
          at: l.at,
          byName: findUser(l.by)?.name || "Program administrator",
          refund: l.delta > 0 && orderIds.has(l.ref),
        }))
        .sort(newestFirst("at"));
      const attendance = data.attendance
        .filter((a) => a.userId === user.id)
        .map((a) => {
          const event = findEvent(a.eventId);
          return {
            id: a.id,
            eventName: event?.name || "Removed event",
            eventDate: event?.date || "",
            sport: event?.sport || "",
            points: a.points,
            at: a.at,
            workerName: findUser(a.by)?.name || "Program administrator",
            method: a.method,
          };
        })
        .sort(newestFirst("at"));
      const sum = (list, pick) => list.reduce((n, x) => n + pick(x), 0);
      return {
        user: publicUser(user),
        summary: {
          balance: user.points,
          gamesAttended: attendance.length,
          pointsEarned: sum(
            ledger.filter((l) => l.delta > 0 && !l.refund),
            (l) => l.delta,
          ),
          attendancePoints: sum(attendance, (a) => a.points),
          pointsSpent: sum(
            orders.filter((o) => o.status !== "cancelled"),
            (o) => o.cost,
          ),
          pointsRefunded: sum(
            ledger.filter((l) => l.refund),
            (l) => l.delta,
          ),
          pendingPickups: orders.filter((o) => o.status === "pending").length,
          rewardsCollected: orders.filter((o) => o.status === "fulfilled")
            .length,
        },
        attendance,
        orders,
        ledger,
      };
    }
    function adminUserProfile(id) {
      const user = findUser(id);
      if (!user) fail(404, "Student account not found.");
      return userProfile(user);
    }
    function listUsers(query) {
      const data = db();
      const q = String(query || "")
        .trim()
        .toLowerCase();
      return {
        users: data.users
          .filter(
            (u) =>
              !q ||
              [u.name, u.email, u.studentNumber].some((f) =>
                String(f || "")
                  .toLowerCase()
                  .includes(q),
              ),
          )
          .map((u) => ({
            ...publicUser(u),
            attended: data.attendance.filter((t) => t.userId === u.id).length,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    }
    function adminOrders() {
      return {
        orders: db()
          .orders.slice()
          .reverse()
          .map((o) => {
            const u = findUser(o.userId) || {};
            const r = findReward(o.rewardId) || {};
            return {
              ...o,
              studentName: u.name || "?",
              studentNumber: u.studentNumber || "",
              email: u.email || "",
              rewardName: r.name || "Removed reward",
            };
          }),
      };
    }
    function overview() {
      const data = db();
      const students = data.users.filter((u) => u.role === "student");
      return {
        students: students.length,
        activeMembers: students.filter(isActive).length,
        checkIns: data.attendance.length,
        pointsAwarded: data.attendance.reduce((n, a) => n + a.points, 0),
        recentAttendance: data.attendance
          .slice(-LIMITS.overviewRecent)
          .reverse()
          .map(attendanceRecord),
        pointsOutstanding: students.reduce((s, u) => s + u.points, 0),
        pendingOrders: data.orders.filter((o) => o.status === "pending").length,
        openEvents: data.events.filter((e) => e.open).map((e) => e.name),
      };
    }
    function accessLog(actor) {
      if (!actor.isHeadAdmin)
        fail(403, "Only the head admin can view the access log.");
      return {
        entries: db()
          .audit.slice(-LIMITS.accessLog)
          .reverse()
          .map((a) => ({
            ...a,
            actorName: findUser(a.by)?.name || "System",
            targetName: findUser(a.target)?.name || "Account",
          })),
      };
    }
    function ledgerCsv() {
      const header = [
        "time",
        "student",
        "student_number",
        "email",
        "points",
        "reason",
        "by",
      ].join(",");
      const rows = db().ledger.map((l) => {
        const u = findUser(l.userId) || {};
        const by = findUser(l.by) || {};
        return [
          l.at,
          u.name,
          u.studentNumber,
          u.email,
          l.delta,
          l.reason,
          by.name,
        ]
          .map(csvCell)
          .join(",");
      });
      return [header, ...rows].join("\n");
    }

    /* Gate check-in */

    function checkIn(actor, body) {
      const event = findEvent(body.eventId);
      if (!event || !event.open) fail(400, MESSAGES.gateClosed);
      if (body.admissionConfirmed !== true)
        fail(400, MESSAGES.admissionUnconfirmed);
      const code = cleanText(body.tag, LIMITS.codeInput).toUpperCase();
      const user = body.userId
        ? findUser(body.userId)
        : db().users.find((u) => u.membership?.tag === code);
      if (!user || user.role !== "student") fail(404, MESSAGES.memberNotFound);
      if (!isActive(user)) fail(403, MESSAGES.membershipInactive);
      const summary = () => ({
        name: user.name,
        studentNumber: user.studentNumber,
        points: user.points,
      });
      const existing = db().attendance.find(
        (a) => a.userId === user.id && a.eventId === event.id,
      );
      if (existing)
        return {
          duplicate: true,
          attendance: attendanceRecord(existing),
          user: summary(),
        };
      // No async gap: the duplicate check and the award happen together, so
      // simultaneous requests cannot both award points.
      const attendance = {
        id: newId("att"),
        userId: user.id,
        eventId: event.id,
        points: event.points,
        at: now(),
        by: actor.id,
        method: body.userId ? "manual" : body.entry === "typed" ? "typed" : "qr",
      };
      db().attendance.push(attendance);
      addPoints(
        user,
        event.points,
        "Attended: " + event.name,
        actor.id,
        attendance.id,
      );
      return {
        duplicate: false,
        attendance: attendanceRecord(attendance),
        user: summary(),
      };
    }

    /* Rewards and orders */

    function orderReward(user, rewardId) {
      const reward = db().rewards.find((r) => r.id === rewardId && r.active);
      if (!reward) fail(404, "That reward is not available.");
      if (reward.stock !== null && reward.stock <= 0) fail(400, "Sold out.");
      if (!isActive(user))
        fail(403, "An active membership is required to reserve rewards.");
      if (user.points < reward.cost)
        fail(400, `You need ${reward.cost - user.points} more points.`);
      const order = {
        id: newId("ord"),
        userId: user.id,
        rewardId: reward.id,
        cost: reward.cost,
        status: "pending",
        createdAt: now(),
        handledBy: null,
        handledAt: null,
      };
      if (reward.stock !== null) reward.stock -= 1;
      db().orders.push(order);
      addPoints(user, -reward.cost, `Ordered: ${reward.name}`, user.id, order.id);
      return { order, user: publicUser(user) };
    }
    function handleOrder(actor, orderId, action) {
      const order = db().orders.find((o) => o.id === orderId);
      if (!order) fail(404, "Order not found.");
      if (order.status !== "pending")
        fail(400, `This order is already ${order.status}.`);
      if (action === "fulfill") {
        order.status = "fulfilled";
      } else if (action === "cancel") {
        order.status = "cancelled";
        const student = findUser(order.userId);
        const reward = findReward(order.rewardId);
        if (reward && reward.stock !== null) reward.stock += 1;
        if (student)
          addPoints(
            student,
            order.cost,
            `Refund: ${reward ? reward.name : "order"} cancelled`,
            actor.id,
            order.id,
          );
      } else {
        fail(400, "Unknown action.");
      }
      order.handledBy = actor.id;
      order.handledAt = now();
      return { order };
    }
    function readRewardBody(body) {
      const name = cleanText(body.name, LIMITS.rewardName);
      const description = cleanText(body.description, LIMITS.description);
      const cost = toInt(body.cost);
      const stock =
        body.stock === "" || body.stock === null || body.stock === undefined
          ? null
          : toInt(body.stock);
      if (!name) fail(400, "Reward name is required.");
      if (!(cost >= 1 && cost <= LIMITS.maxRewardCost))
        fail(400, "Cost must be a whole number of points.");
      if (stock !== null && !(stock >= 0))
        fail(400, "Stock must be blank (unlimited) or a whole number.");
      return { name, description, cost, stock, active: body.active !== false };
    }
    function createReward(body) {
      const reward = { id: newId("rwd"), ...readRewardBody(body) };
      db().rewards.push(reward);
      return { reward };
    }
    function updateReward(id, body) {
      const reward = findReward(id);
      if (!reward) fail(404, "Reward not found.");
      Object.assign(reward, readRewardBody(body));
      return { reward };
    }

    /* Events */

    function readEventBody(body) {
      const name = cleanText(body.name, LIMITS.eventName);
      const date = cleanText(body.date, 10);
      const points = toInt(body.points);
      if (!name) fail(400, "Event name is required.");
      if (!DATE_PATTERN.test(date)) fail(400, "Pick a date.");
      if (!(points >= 0 && points <= LIMITS.maxEventPoints))
        fail(400, "Points must be a whole number from 0 to 10000.");
      const sport = cleanText(body.sport, LIMITS.sport) || "Football";
      const location = cleanText(body.location, LIMITS.location) || SCHOOL_NAME;
      const time = cleanText(body.time, 5) || "19:30";
      if (!TIME_PATTERN.test(time)) fail(400, "Choose a valid start time.");
      if (!isRealDate(date)) fail(400, "Choose a valid event date.");
      return { name, date, points, sport, location, time };
    }
    function createEvent(body) {
      const event = {
        id: newId("evt"),
        ...readEventBody(body),
        open: false,
        createdAt: now(),
      };
      db().events.push(event);
      return { event };
    }
    function updateEvent(id, body) {
      const event = findEvent(id);
      if (!event) fail(404, "Event not found.");
      if (typeof body.open === "boolean" && Object.keys(body).length === 1)
        event.open = body.open;
      else Object.assign(event, readEventBody(body));
      return { event };
    }
    function deleteEvent(id) {
      const data = db();
      if (data.attendance.some((t) => t.eventId === id))
        fail(400, "This event has attendance records, so it cannot be deleted.");
      data.events = data.events.filter((e) => e.id !== id);
      return { ok: true };
    }

    /* Members, adjustments, and access */

    function createMember(body, create = createAccount) {
      const name = cleanText(body.name, LIMITS.personName),
        studentNumber = cleanText(body.studentNumber, LIMITS.studentNumber),
        email = normEmail(body.email);
      if (!name || !studentNumber || !isEmail(email))
        fail(400, "Enter a name, student ID, and valid email.");
      if (
        db().users.some(
          (u) => u.email === email || u.studentNumber === studentNumber,
        )
      )
        fail(409, "This email or student ID is already registered.");
      const user = create({ name, studentNumber, email, role: "student" });
      user.membership = newMembership(body.active === true);
      return { user: publicUser(user) };
    }
    function updateMember(actor, id, body) {
      const user = findUser(id);
      if (!user || user.role !== "student") fail(404, "Student not found.");
      const expires = cleanText(body.expires, 10);
      if (!DATE_PATTERN.test(expires) || !isRealDate(expires))
        fail(400, "Choose a valid membership end date.");
      const delta = body.delta === undefined ? 0 : toInt(body.delta);
      const reason = cleanText(body.reason, LIMITS.reason);
      if (!Number.isInteger(delta) || Math.abs(delta) > LIMITS.maxAdjustment)
        fail(
          400,
          "Points adjustment must be a whole number between -100000 and 100000.",
        );
      if (delta && !reason)
        fail(400, "Enter a reason for the points adjustment.");
      if (user.points + delta < 0)
        fail(400, "That adjustment would make the balance negative.");
      user.membership = { ...user.membership, active: body.active === true, expires };
      if (body.replaceTag === true)
        replaceMembershipCode(user, actor.id, "Admin replaced membership QR code");
      if (delta) addPoints(user, delta, `Adjustment: ${reason}`, actor.id);
      return { user: publicUser(user) };
    }
    function adjustPoints(actor, id, body) {
      const user = findUser(id);
      if (!user) fail(404, "User not found.");
      const delta = toInt(body.delta);
      const reason = cleanText(body.reason, LIMITS.reason);
      if (
        !Number.isInteger(delta) ||
        delta === 0 ||
        Math.abs(delta) > LIMITS.maxAdjustment
      )
        fail(400, "Enter a non-zero whole number.");
      if (!reason)
        fail(400, "A reason is required (it shows in the student’s history).");
      if (user.points + delta < 0)
        fail(400, "That would make their balance negative.");
      addPoints(user, delta, `Adjustment: ${reason}`, actor.id);
      return { user: publicUser(user) };
    }
    function resetOwnCode(user, body) {
      if (Object.keys(body).some((k) => !["confirmed", "currentTag"].includes(k)))
        fail(400, "This action can only replace your own membership QR code.");
      if (body.confirmed !== true)
        fail(
          400,
          "Confirm that your old QR code and any printed copies will stop working.",
        );
      if (!user.membership?.tag)
        fail(404, "No membership QR code is assigned. Contact the program admin.");
      if (body.currentTag !== user.membership.tag)
        fail(
          409,
          "Your QR code changed on another device. Refresh your profile before trying again.",
        );
      replaceMembershipCode(
        user,
        user.id,
        "Student replaced a lost or exposed QR code",
      );
      return { user: publicUser(user) };
    }
    /** Demo-mode staff invitation (Firebase mode uses its own flow). */
    function inviteDemoStaff(body, create = createAccount) {
      const name = cleanText(body.name, LIMITS.personName);
      const email = normEmail(body.email);
      const role = body.role;
      if (!name) fail(400, "Name is required.");
      if (!isEmail(email)) fail(400, "Enter a valid email.");
      if (!["staff", "admin"].includes(role))
        fail(400, "Role must be staff or admin.");
      if (db().users.some((u) => u.email === email))
        fail(409, "That email already has an account.");
      return create({ name, email, role });
    }
    /** Demo-mode role and ban changes (Firebase mode uses its own flow). */
    function updateDemoAccess(actor, id, body) {
      const user = findUser(id);
      if (!user) fail(404, "User not found.");
      if (user.id === actor.id)
        fail(400, "You cannot change your own role or disable yourself.");
      if (body.role !== undefined && !ROLES.includes(body.role))
        fail(400, "Invalid role.");
      const data = db();
      if (body.role !== undefined) {
        user.role = body.role;
        if (user.role === "student" && !user.membership)
          user.membership = newMembership(false);
      }
      if (body.disabled !== undefined) {
        user.disabled = !!body.disabled;
        if (user.disabled && data.sessions)
          data.sessions = data.sessions.filter((s) => s.userId !== user.id);
      }
      return { user: publicUser(user) };
    }

    return {
      // lookups and projections
      findUser,
      findEvent,
      publicUser,
      membershipActive: isActive,
      attendanceRecord,
      listEvents,
      listRewards,
      activity,
      myAttendance,
      gateMembers,
      gateLookup,
      gateAttendance,
      userProfile,
      adminUserProfile,
      listUsers,
      adminOrders,
      overview,
      accessLog,
      ledgerCsv,
      // membership codes
      newMembershipCode,
      newMembership,
      replaceMembershipCode,
      isRetiredCode,
      findStudentByCode,
      // accounts and data
      createAccount,
      demoAccount,
      prepareDemoAccount,
      seedCatalog,
      seedDemoPeople,
      normalizeData,
      addPoints,
      // operations
      checkIn,
      orderReward,
      handleOrder,
      createReward,
      updateReward,
      createEvent,
      updateEvent,
      deleteEvent,
      createMember,
      updateMember,
      adjustPoints,
      resetOwnCode,
      inviteDemoStaff,
      updateDemoAccess,
    };
  }

  function emptyDb(version) {
    return {
      version,
      users: [],
      sessions: [],
      events: [],
      tickets: [],
      rewards: [],
      orders: [],
      ledger: [],
      attendance: [],
      loginChallenges: [],
      audit: [],
      settings: {},
      retiredTagHashes: [],
    };
  }

  return Object.freeze({
    SCHOOL_TIME_ZONE,
    CODE,
    LIMITS,
    ROLES,
    MESSAGES,
    DEMO_ACCOUNTS,
    RuleError,
    cleanText,
    toInt,
    normEmail,
    isEmail,
    isRealDate,
    schoolToday,
    seasonEnd,
    normalizeCode,
    parseMembershipCode,
    membershipActive,
    csvCell,
    emptyDb,
    createService,
  });
});
