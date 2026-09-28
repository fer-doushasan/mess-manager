const express = require("express");
const crypto = require("node:crypto");
const path = require("node:path");
const { calculateReport, money } = require("./calculator");
const { nowId, readStore, sampleStore, updateStore, writeStore } = require("./store");

const app = express();
const PORT = process.env.PORT || 3000;
const sessions = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

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

function setSessionCookie(res, sessionId) {
  res.setHeader("Set-Cookie", `sessionId=${encodeURIComponent(sessionId)}; HttpOnly; Path=/; SameSite=Lax`);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "sessionId=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0");
}

function createSession(memberId) {
  const sessionId = crypto.randomBytes(24).toString("hex");
  sessions.set(sessionId, { memberId, createdAt: Date.now() });
  return sessionId;
}

function clearSession(sessionId) {
  if (sessionId) {
    sessions.delete(sessionId);
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

function canManageMemberData(requestMember, memberId) {
  return requestMember.role === "admin" || requestMember.id === memberId;
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

async function getRequestMember(req) {
  const sessionId = parseCookies(req.headers.cookie).sessionId;
  const session = sessionId ? sessions.get(sessionId) : null;
  if (!session) {
    return null;
  }

  const store = await readStore();
  const member = findActiveMember(store, session.memberId);
  if (!member || member.approved === false) {
    clearSession(sessionId);
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

async function getState(member) {
  const store = await readStore();
  return {
    viewer: member ? sanitizeMember(member) : null,
    store: sanitizeStore(store),
    report: calculateReport(store)
  };
}

app.get("/api/public-state", async (req, res, next) => {
  try {
    res.json(await getState(null));
  } catch (error) {
    next(error);
  }
});

app.get("/api/session/options", async (req, res, next) => {
  try {
    const store = await readStore();
    res.json({
      members: sanitizeStore(store).members.filter((member) => member.active !== false)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/session", async (req, res, next) => {
  try {
    const store = await readStore();
    const mobile = normalizeMobile(req.body.mobile);
    const password = requireText(req.body.password);

    if (!mobile) {
      return res.status(400).json({ message: "Mobile number is required." });
    }

    const member = findApprovedMemberByMobile(store, mobile);
    if (!member) {
      return res.status(403).json({ message: "Access is not approved for this mobile number." });
    }

    if (!password || member.password !== password) {
      return res.status(401).json({ message: "Mobile number or password is incorrect." });
    }

    const sessionId = createSession(member.id);
    setSessionCookie(res, sessionId);
    res.json(await getState(member));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/session", (req, res) => {
  const sessionId = parseCookies(req.headers.cookie).sessionId;
  clearSession(sessionId);
  clearSessionCookie(res);
  res.json({ ok: true });
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

    const role = req.body.role === "admin" ? "admin" : "member";
    await updateStore((store) => {
      const existingMember = store.members.find(
        (member) => member.active !== false && normalizeMobile(member.mobile) === mobile
      );
      if (existingMember) {
        throw new Error("Mobile number already exists.");
      }
      if (role === "admin") {
        store.members = store.members.map((member) => ({ ...member, role: "member" }));
      }
      const member = {
        id: nowId("member"),
        name,
        role,
        active: true,
        mobile,
        approved: req.body.approved === false ? false : true,
        password
      };
      store.members.push(member);
      store.mealCounts[member.id] = 0;
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
        throw new Error("Member not found.");
      }
      member.approved = req.body.approved !== false;
      return store;
    });
    res.json(await getState(req.member));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/members/:id", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    if (req.params.id === req.member.id) {
      return res.status(400).json({ message: "You cannot remove the current admin account." });
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

    await updateStore((store) => {
      const memberId = req.member.role === "admin" ? req.body.memberId : req.member.id;
      if (!findActiveMember(store, memberId)) {
        throw new Error("Valid member is required.");
      }
      store.bazarEntries.push({
        id: nowId("bazar"),
        memberId,
        date: requireText(req.body.date, today()),
        description: requireText(req.body.description, "Bazar"),
        amount
      });
      return store;
    });
    res.status(201).json(await getState(req.member));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/bazar/:id", requireAuth, async (req, res, next) => {
  try {
    await updateStore((store) => {
      const entry = store.bazarEntries.find((item) => item.id === req.params.id);
      if (!entry) {
        throw new Error("Bazar entry not found.");
      }
      if (!canManageMemberData(req.member, entry.memberId)) {
        throw new Error("You can update only your own bazar list.");
      }
      store.bazarEntries = store.bazarEntries.filter((item) => item.id !== req.params.id);
      return store;
    });
    res.json(await getState(req.member));
  } catch (error) {
    next(error);
  }
});

app.put("/api/meals/:memberId", requireAuth, async (req, res, next) => {
  try {
    const count = parseAmount(req.body.count);
    if (count < 0) {
      return res.status(400).json({ message: "Meal count cannot be negative." });
    }

    await updateStore((store) => {
      if (!findActiveMember(store, req.params.memberId)) {
        throw new Error("Valid member is required.");
      }
      store.mealCounts[req.params.memberId] = count;
      return store;
    });
    res.json(await getState(req.member));
  } catch (error) {
    next(error);
  }
});

app.put("/api/my-house-rent", requireAuth, async (req, res, next) => {
  try {
    const paidAmount = parseAmount(req.body.paidAmount);
    const rentAmount = parseAmount(req.body.rentAmount);
    const targetMemberId = req.member.role === "admin" ? requireText(req.body.memberId, req.member.id) : req.member.id;
    if (paidAmount < 0 || rentAmount < 0) {
      return res.status(400).json({ message: "House rent amounts cannot be negative." });
    }

    await updateStore((store) => {
      const member = findActiveMember(store, targetMemberId);
      if (!member) {
        throw new Error("Valid member is required.");
      }

      if (req.member.role === "admin") {
        member.rentAmount = rentAmount;
      }
      member.rentPaid = paidAmount;

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

    const splitType = req.body.splitType === "custom" ? "custom" : "equal";
    const allocations = splitType === "custom" && req.body.allocations ? req.body.allocations : {};

    await updateStore((store) => {
      store.fixedCosts.push({
        id: nowId("fixed"),
        label,
        amount,
        splitType,
        allocations
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

app.post("/api/individual-costs", requireAuth, async (req, res, next) => {
  try {
    const label = requireText(req.body.label);
    const amount = parseAmount(req.body.amount);
    if (!label || amount <= 0) {
      return res.status(400).json({ message: "Individual cost label and amount are required." });
    }

    await updateStore((store) => {
      const memberId = req.member.role === "admin" ? req.body.memberId : req.member.id;
      if (!findActiveMember(store, memberId)) {
        throw new Error("Valid member is required.");
      }
      store.individualCosts.push({
        id: nowId("individual"),
        memberId,
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

app.delete("/api/individual-costs/:id", requireAuth, async (req, res, next) => {
  try {
    await updateStore((store) => {
      const entry = store.individualCosts.find((item) => item.id === req.params.id);
      if (!entry) {
        throw new Error("Individual cost not found.");
      }
      if (!canManageMemberData(req.member, entry.memberId)) {
        throw new Error("You can update only your own individual costs.");
      }
      store.individualCosts = store.individualCosts.filter((item) => item.id !== req.params.id);
      return store;
    });
    res.json(await getState(req.member));
  } catch (error) {
    next(error);
  }
});

app.post("/api/payments", requireAuth, async (req, res, next) => {
  try {
    const amount = parseAmount(req.body.amount);
    if (amount <= 0) {
      return res.status(400).json({ message: "Payment amount must be greater than 0." });
    }

    await updateStore((store) => {
      if (!findActiveMember(store, req.body.memberId)) {
        throw new Error("Valid member is required.");
      }
      store.payments.push({
        id: nowId("payment"),
        memberId: req.body.memberId,
        date: requireText(req.body.date, today()),
        note: requireText(req.body.note, "Payment"),
        amount
      });
      return store;
    });
    res.status(201).json(await getState(req.member));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/payments/:id", requireAuth, async (req, res, next) => {
  try {
    await updateStore((store) => {
      store.payments = store.payments.filter((entry) => entry.id !== req.params.id);
      return store;
    });
    res.json(await getState(req.member));
  } catch (error) {
    next(error);
  }
});

app.post("/api/reset", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await writeStore(sampleStore());
    res.json(await getState(findApprovedMemberByMobile(await readStore(), req.member.mobile)));
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ message: "Something went wrong.", detail: error.message });
});

app.listen(PORT, () => {
  console.log(`Sweet Home Expense Manager running at http://localhost:${PORT}`);
});
