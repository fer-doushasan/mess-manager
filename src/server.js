const express = require("express");
const crypto = require("node:crypto");
const path = require("node:path");
const { money } = require("./calculator");
const { hashPassword, verifyPassword } = require("./passwords");
const { backend, initStore, monthReport, nowId, readStore, resetStore, startNextMonth, updateStore } = require("./store");

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_DAYS = 30;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
const loginFailures = new Map();

// Hosts like Render terminate HTTPS at a proxy; this makes req.secure and req.ip correct.
app.set("trust proxy", 1);
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requireText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function parseAmount(value) {
  return money(Number(value));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeMobile(value) {
  return String(value || "").replace(/\D/g, "");
}

function parseCookies(cookieHeader = "") {
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        if (separator === -1) {
          return [part, ""];
        }
        return [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
      })
  );
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function setSessionCookie(req, res, token) {
  const secure = req.secure ? "; Secure" : "";
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  res.setHeader(
    "Set-Cookie",
    `sessionId=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`
  );
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "sessionId=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0");
}

async function createSession(memberId) {
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await backend.createSession(hashToken(token), memberId, expiresAt);
  return token;
}

async function clearSession(token) {
  if (token) {
    await backend.deleteSession(hashToken(token));
  }
}

function sanitizeMember(member) {
  const { password, ...safeMember } = member;
  return safeMember;
}

function sanitizeStore(store) {
  return {
    ...store,
    members: store.members.map(sanitizeMember)
  };
}

function findActiveMember(store, memberId) {
  return store.members.find((member) => member.id === memberId && member.active !== false) || null;
}

function requireActiveMember(store, memberId) {
  const member = findActiveMember(store, memberId);
  if (!member) {
    throw new HttpError(400, "Valid member is required.");
  }
  return member;
}

function findApprovedMemberByMobile(store, mobile) {
  const normalizedMobile = normalizeMobile(mobile);
  return (
    store.members.find(
      (member) =>
        member.active !== false && member.approved !== false && normalizeMobile(member.mobile) === normalizedMobile
    ) || null
  );
}

function isLoginBlocked(key) {
  const entry = loginFailures.get(key);
  if (!entry || entry.resetAt <= Date.now()) {
    loginFailures.delete(key);
    return false;
  }
  return entry.count >= LOGIN_MAX_FAILURES;
}

function recordLoginFailure(key) {
  const entry = loginFailures.get(key);
  if (!entry || entry.resetAt <= Date.now()) {
    loginFailures.set(key, { count: 1, resetAt: Date.now() + LOGIN_WINDOW_MS });
    return;
  }
  entry.count += 1;
}

async function getRequestMember(req) {
  const token = parseCookies(req.headers.cookie).sessionId;
  const session = token ? await backend.getSession(hashToken(token)) : null;
  if (!session) {
    return null;
  }

  const store = await readStore();
  const member = findActiveMember(store, session.memberId);
  if (!member || member.approved === false) {
    await clearSession(token);
    return null;
  }

  return member;
}

function requireAuth(req, res, next) {
  getRequestMember(req)
    .then((member) => {
      if (!member) {
        res.status(401).json({ message: "Login required." });
        return;
      }
      req.member = member;
      next();
    })
    .catch(next);
}

function requireAdmin(req, res, next) {
  if (!req.member || req.member.role !== "admin") {
    res.status(403).json({ message: "Admin access required." });
    return;
  }
  next();
}

// Members get their own figures plus the mess's shared tables (bazar, meal calculation,
// monthly settlement) for transparency, but never other members' mobile numbers,
// payments, fixed-cost settings or admin data. Only the open month is included.
const SHARED_ROW_FIELDS = [
  "memberId",
  "name",
  "role",
  "bazarPaid",
  "mealCount",
  "mealCost",
  "mealPaid",
  "mealTotalPaid",
  "mealBalance",
  "fixedBalance",
  "fixedDue",
  "previousBalance",
  "balance",
  "status"
];

function memberView(store, report, member) {
  const names = new Map(store.members.map((item) => [item.id, item.name]));
  const activeIds = new Set(report.rows.map((row) => row.memberId));
  const pick = (row) => Object.fromEntries(SHARED_ROW_FIELDS.map((field) => [field, row[field]]));
  return {
    viewer: sanitizeMember(member),
    settings: store.settings,
    month: store.month,
    me: report.rows.find((row) => row.memberId === member.id) || null,
    summary: {
      totalMembers: report.summary.totalMembers,
      totalBazarCost: report.summary.totalBazarCost,
      totalMeals: report.summary.totalMeals,
      mealRate: report.summary.mealRate,
      totalMealCost: report.summary.totalMealCost,
      mealTotalPaid: report.summary.mealTotalPaid,
      mealBalanceTotal: report.summary.mealBalanceTotal,
      fixedDueTotal: report.summary.fixedDueTotal,
      netBalance: report.summary.netBalance
    },
    members: report.rows.map(pick),
    bazarEntries: store.bazarEntries
      .filter((entry) => entry.month === store.month && activeIds.has(entry.memberId))
      .map(({ id, memberId, date, description, amount }) => ({
        id,
        memberId,
        memberName: names.get(memberId),
        date,
        description,
        amount
      })),
    payments: store.payments.filter((entry) => entry.month === store.month && entry.memberId === member.id)
  };
}

async function getState(member) {
  const store = await readStore();
  const report = monthReport(store);
  if (member.role !== "admin") {
    return memberView(store, report, member);
  }
  return {
    viewer: sanitizeMember(member),
    settings: store.settings,
    month: store.month,
    store: sanitizeStore(store),
    report,
    previousMonths: store.history.map((closed) => ({
      month: closed.month,
      closedAt: closed.closedAt,
      report: monthReport(store, closed.month)
    }))
  };
}

// Closed months are history: their entries can be viewed but not changed.
function requireOpenMonthEntry(store, entries, id, label) {
  const entry = entries.find((item) => item.id === id);
  if (!entry) {
    throw new HttpError(404, `${label} not found.`);
  }
  if (entry.month !== store.month) {
    throw new HttpError(400, `This ${label.toLowerCase()} belongs to a closed month and cannot be changed.`);
  }
  return entry;
}

// Members act only on their own account; asking to act for someone else is refused,
// not silently redirected.
function targetMemberId(req) {
  const requested = requireText(req.body.memberId);
  if (req.member.role === "admin") {
    return requested || req.member.id;
  }
  if (requested && requested !== req.member.id) {
    throw new HttpError(403, "You can only add entries for your own account.");
  }
  return req.member.id;
}

function countAdmins(store) {
  return store.members.filter((member) => member.active !== false && member.role === "admin").length;
}

app.post("/api/session", async (req, res, next) => {
  try {
    const mobile = normalizeMobile(req.body.mobile);
    const password = requireText(req.body.password);
    const limitKey = `${req.ip}|${mobile}`;

    if (!mobile) {
      return res.status(400).json({ message: "Mobile number is required." });
    }
    if (isLoginBlocked(limitKey)) {
      return res.status(429).json({ message: "Too many failed attempts. Try again in 15 minutes." });
    }

    const store = await readStore();
    const member = findApprovedMemberByMobile(store, mobile);
    if (!member || !(await verifyPassword(password, member.password))) {
      recordLoginFailure(limitKey);
      return res.status(401).json({ message: "Mobile number or password is incorrect." });
    }

    loginFailures.delete(limitKey);
    const token = await createSession(member.id);
    setSessionCookie(req, res, token);
    res.json(await getState(member));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/session", async (req, res, next) => {
  try {
    await clearSession(parseCookies(req.headers.cookie).sessionId);
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/state", requireAuth, async (req, res, next) => {
  try {
    res.json(await getState(req.member));
  } catch (error) {
    next(error);
  }
});

app.post("/api/members", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const name = requireText(req.body.name);
    const mobile = normalizeMobile(req.body.mobile);
    const password = requireText(req.body.password);
    if (!name || !mobile || !password) {
      return res.status(400).json({ message: "Member name, mobile number, and password are required." });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters." });
    }

    const role = req.body.role === "admin" ? "admin" : "member";
    await updateStore((store) => {
      const existingMember = store.members.find(
        (member) => member.active !== false && normalizeMobile(member.mobile) === mobile
      );
      if (existingMember) {
        throw new HttpError(409, "Mobile number already exists.");
      }
      const member = {
        id: nowId("member"),
        name,
        role,
        active: true,
        mobile,
        approved: req.body.approved === false ? false : true,
        password: hashPassword(password),
        fixedAmount: 0,
        openingBalance: 0
      };
      store.members.push(member);
      return store;
    });
    res.status(201).json(await getState(req.member));
  } catch (error) {
    next(error);
  }
});

app.put("/api/members/:id/approval", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await updateStore((store) => {
      const member = findActiveMember(store, req.params.id);
      if (!member) {
        throw new HttpError(404, "Member not found.");
      }
      member.approved = req.body.approved !== false;
      return store;
    });
    res.json(await getState(req.member));
  } catch (error) {
    next(error);
  }
});

app.put("/api/members/:id", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const name = requireText(req.body.name);
    const mobile = normalizeMobile(req.body.mobile);
    const password = requireText(req.body.password);
    if (!name || !mobile) {
      return res.status(400).json({ message: "Member name and mobile number are required." });
    }
    if (password && password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters." });
    }

    await updateStore((store) => {
      const member = findActiveMember(store, req.params.id);
      if (!member) {
        throw new HttpError(404, "Member not found.");
      }
      const duplicate = store.members.find(
        (item) => item.id !== member.id && item.active !== false && normalizeMobile(item.mobile) === mobile
      );
      if (duplicate) {
        throw new HttpError(409, "Mobile number already exists.");
      }
      const role = req.body.role === "admin" ? "admin" : "member";
      if (member.role === "admin" && role !== "admin" && countAdmins(store) <= 1) {
        throw new HttpError(400, "The mess needs at least one admin.");
      }
      member.name = name;
      member.mobile = mobile;
      member.role = role;
      if (password) {
        member.password = hashPassword(password);
      }
      return store;
    });
    res.json(await getState(await getRequestMember(req)));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/members/:id", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    if (req.params.id === req.member.id) {
      return res.status(400).json({ message: "You cannot remove your own admin account." });
    }

    await updateStore((store) => {
      store.members = store.members.map((member) =>
        member.id === req.params.id ? { ...member, active: false } : member
      );
      return store;
    });
    res.json(await getState(req.member));
  } catch (error) {
    next(error);
  }
});

app.post("/api/bazar", requireAuth, async (req, res, next) => {
  try {
    const amount = parseAmount(req.body.amount);
    if (amount <= 0) {
      return res.status(400).json({ message: "Bazar amount must be greater than 0." });
    }

    const memberId = targetMemberId(req);
    await updateStore((store) => {
      requireActiveMember(store, memberId);
      store.bazarEntries.push({
        id: nowId("bazar"),
        memberId,
        date: requireText(req.body.date, today()),
        description: requireText(req.body.description, "Bazar"),
        amount,
        month: store.month
      });
      return store;
    });
    res.status(201).json(await getState(req.member));
  } catch (error) {
    next(error);
  }
});

// Members add their own bazar; the admin corrects (edits or removes) anyone's.
app.put("/api/bazar/:id", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const amount = parseAmount(req.body.amount);
    if (amount <= 0) {
      return res.status(400).json({ message: "Bazar amount must be greater than 0." });
    }

    await updateStore((store) => {
      const entry = requireOpenMonthEntry(store, store.bazarEntries, req.params.id, "Bazar entry");
      const memberId = requireText(req.body.memberId, entry.memberId);
      requireActiveMember(store, memberId);
      entry.memberId = memberId;
      entry.date = requireText(req.body.date, entry.date);
      entry.description = requireText(req.body.description, "Bazar");
      entry.amount = amount;
      return store;
    });
    res.json(await getState(req.member));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/bazar/:id", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await updateStore((store) => {
      requireOpenMonthEntry(store, store.bazarEntries, req.params.id, "Bazar entry");
      store.bazarEntries = store.bazarEntries.filter((item) => item.id !== req.params.id);
      return store;
    });
    res.json(await getState(req.member));
  } catch (error) {
    next(error);
  }
});

// Meal counts are kept by the admin only, so nobody can lower their own meal cost.
app.put("/api/meals/:memberId", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const count = parseAmount(req.body.count);
    if (count < 0) {
      return res.status(400).json({ message: "Meal count cannot be negative." });
    }

    await updateStore((store) => {
      requireActiveMember(store, req.params.memberId);
      store.meals[store.month] = { ...(store.meals[store.month] || {}), [req.params.memberId]: count };
      return store;
    });
    res.json(await getState(req.member));
  } catch (error) {
    next(error);
  }
});

// A member's monthly fixed cost stays the same every month until the admin changes it.
app.put("/api/members/:id/fixed-amount", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const amount = parseAmount(req.body.amount);
    if (amount < 0) {
      return res.status(400).json({ message: "Fixed amount cannot be negative." });
    }

    await updateStore((store) => {
      requireActiveMember(store, req.params.id).fixedAmount = amount;
      return store;
    });
    res.json(await getState(req.member));
  } catch (error) {
    next(error);
  }
});

app.post("/api/fixed-costs", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const label = requireText(req.body.label);
    const amount = parseAmount(req.body.amount);
    if (!label || amount <= 0) {
      return res.status(400).json({ message: "Fixed cost label and amount are required." });
    }

    await updateStore((store) => {
      store.fixedCosts.push({
        id: nowId("fixed"),
        label,
        amount
      });
      return store;
    });
    res.status(201).json(await getState(req.member));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/fixed-costs/:id", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await updateStore((store) => {
      store.fixedCosts = store.fixedCosts.filter((entry) => entry.id !== req.params.id);
      return store;
    });
    res.json(await getState(req.member));
  } catch (error) {
    next(error);
  }
});

// Each payment is its own entry, so paying twice adds up instead of overwriting.
// "fixed" payments count toward the monthly fixed cost (rent & utility); "meal" ones toward meal cost.
app.post("/api/payments", requireAuth, async (req, res, next) => {
  try {
    const amount = parseAmount(req.body.amount);
    if (amount <= 0) {
      return res.status(400).json({ message: "Payment amount must be greater than 0." });
    }
    const kind = req.body.kind === "meal" ? "meal" : "fixed";
    const memberId = targetMemberId(req);

    await updateStore((store) => {
      requireActiveMember(store, memberId);
      store.payments.push({
        id: nowId("payment"),
        memberId,
        date: requireText(req.body.date, today()),
        note: requireText(req.body.note, kind === "fixed" ? "Fixed cost payment" : "Meal cost payment"),
        amount,
        kind,
        month: store.month
      });
      return store;
    });
    res.status(201).json(await getState(req.member));
  } catch (error) {
    next(error);
  }
});

// Only the admin removes payments, so a recorded payment cannot quietly disappear.
app.delete("/api/payments/:id", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await updateStore((store) => {
      requireOpenMonthEntry(store, store.payments, req.params.id, "Payment");
      store.payments = store.payments.filter((entry) => entry.id !== req.params.id);
      return store;
    });
    res.json(await getState(req.member));
  } catch (error) {
    next(error);
  }
});

app.put("/api/settings", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const messName = requireText(req.body.messName);
    if (!messName) {
      return res.status(400).json({ message: "Mess name is required." });
    }
    await updateStore((store) => {
      store.settings = { ...store.settings, messName: messName.slice(0, 80) };
      return store;
    });
    res.json(await getState(req.member));
  } catch (error) {
    next(error);
  }
});

app.post("/api/month/close", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await updateStore(startNextMonth);
    res.json(await getState(req.member));
  } catch (error) {
    next(error);
  }
});

app.post("/api/reset", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const store = await resetStore();
    const viewer = findApprovedMemberByMobile(store, req.member.mobile);
    if (!viewer) {
      clearSessionCookie(res);
      return res.json({ viewer: null });
    }
    res.json(await getState(viewer));
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  const status = error.status || error.statusCode || 500;
  if (status >= 500) {
    console.error(error);
  }
  res.status(status).json({ message: status < 500 ? error.message : "Something went wrong." });
});

async function start() {
  await initStore();
  app.listen(PORT, () => {
    console.log(`Sweet Home Expense Manager running at http://localhost:${PORT} (storage: ${backend.name})`);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { app, initStore };
