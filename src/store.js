const { calculateReport, money } = require("./calculator");
const { hashPassword, isHashed } = require("./passwords");

const backend = process.env.DATABASE_URL ? require("./backends/postgres") : require("./backends/file");

function nowId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sampleStore() {
  return {
    month: "2026-05",
    members: [
      {
        id: "member_admin",
        name: "Ferdous",
        role: "admin",
        active: true,
        mobile: "01518910492",
        approved: true,
        password: "admin492",
        fixedAmount: 2225,
        openingBalance: 0
      },
      {
        id: "member_mahbub",
        name: "Mahbub",
        role: "member",
        active: true,
        mobile: "01700000001",
        approved: true,
        password: "mahbub123",
        fixedAmount: 2225,
        openingBalance: 0
      },
      {
        id: "member_bappy",
        name: "Bappy",
        role: "member",
        active: true,
        mobile: "01700000002",
        approved: true,
        password: "bappy123",
        fixedAmount: 2225,
        openingBalance: 0
      },
      {
        id: "member_taufiq",
        name: "Taufiq",
        role: "member",
        active: true,
        mobile: "01700000003",
        approved: true,
        password: "taufiq123",
        fixedAmount: 2225,
        openingBalance: 0
      },
      {
        id: "member_habib",
        name: "Habib",
        role: "member",
        active: true,
        mobile: "01700000004",
        approved: true,
        password: "habib123",
        fixedAmount: 2225,
        openingBalance: 0
      },
      {
        id: "member_miraj",
        name: "Miraj",
        role: "member",
        active: true,
        mobile: "01700000005",
        approved: true,
        password: "miraj123",
        fixedAmount: 2225,
        openingBalance: 0
      },
      {
        id: "member_alom",
        name: "Alom",
        role: "member",
        active: true,
        mobile: "01700000006",
        approved: true,
        password: "alom123",
        fixedAmount: 2225,
        openingBalance: 0
      },
      {
        id: "member_rakib",
        name: "Rakib",
        role: "member",
        active: true,
        mobile: "01700000007",
        approved: true,
        password: "rakib123",
        fixedAmount: 2225,
        openingBalance: 0
      }
    ],
    fixedCosts: [
      { id: "fixed_rent", label: "House rent", amount: 15000 },
      { id: "fixed_electricity", label: "Electricity bill", amount: 1800 },
      { id: "fixed_wifi", label: "WiFi bill", amount: 1000 }
    ],
    bazarEntries: [
      { id: "bazar_ferdous_1", memberId: "member_admin", date: "2026-05-01", description: "Rice, dal, oil", amount: 1000 },
      { id: "bazar_mahbub_1", memberId: "member_mahbub", date: "2026-05-02", description: "Vegetables", amount: 500 }
    ],
    mealCounts: {
      member_admin: 25,
      member_mahbub: 20,
      member_bappy: 18,
      member_taufiq: 15,
      member_habib: 10,
      member_miraj: 8,
      member_alom: 6,
      member_rakib: 0
    },
    payments: [
      { id: "payment_ferdous_1", memberId: "member_admin", date: "2026-05-03", note: "Cash deposit", amount: 4000 },
      { id: "payment_bappy_1", memberId: "member_bappy", date: "2026-05-03", note: "Advance", amount: 7000 }
    ]
  };
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function emptyStore() {
  return {
    month: currentMonth(),
    members: [],
    fixedCosts: [],
    bazarEntries: [],
    meals: {},
    payments: [],
    history: [],
    settings: { messName: "Sweet Home" }
  };
}

// Production starts with a single admin from ADMIN_MOBILE / ADMIN_PASSWORD.
// Local development falls back to the sample data.
function initialStore() {
  const mobile = String(process.env.ADMIN_MOBILE || "").replace(/\D/g, "");
  const password = process.env.ADMIN_PASSWORD;
  if (mobile && password) {
    return normalizeStore({
      ...emptyStore(),
      members: [
        {
          id: "member_admin",
          name: process.env.ADMIN_NAME || "Admin",
          role: "admin",
          active: true,
          mobile,
          approved: true,
          password: hashPassword(password),
          fixedAmount: 0,
          openingBalance: 0
        }
      ]
    });
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Set ADMIN_MOBILE and ADMIN_PASSWORD to create the first admin account.");
  }
  return normalizeStore(sampleStore());
}

function normalizeStore(store) {
  const normalized = {
    ...emptyStore(),
    ...store
  };

  normalized.members = Array.isArray(normalized.members) ? normalized.members : [];
  normalized.fixedCosts = Array.isArray(normalized.fixedCosts) ? normalized.fixedCosts : [];
  // Every bazar entry and payment belongs to an accounting month; older data without
  // one belongs to the open month.
  const month = normalized.month;
  normalized.bazarEntries = (Array.isArray(normalized.bazarEntries) ? normalized.bazarEntries : []).map((entry) => ({
    ...entry,
    month: entry.month || month
  }));
  normalized.payments = (Array.isArray(normalized.payments) ? normalized.payments : []).map((entry) => ({
    ...entry,
    kind: entry.kind === "fixed" ? "fixed" : "meal",
    month: entry.month || month
  }));
  normalized.meals = normalized.meals && typeof normalized.meals === "object" ? { ...normalized.meals } : {};
  if (normalized.mealCounts && !normalized.meals[month]) {
    normalized.meals[month] = { ...normalized.mealCounts };
  }
  delete normalized.mealCounts;
  normalized.history = Array.isArray(normalized.history) ? normalized.history : [];
  normalized.settings = { ...emptyStore().settings, ...(normalized.settings || {}) };

  // Individual costs are no longer part of the model; old "house-rent" ones were rent payments.
  const legacyHouseRentPaid = {};
  for (const entry of Array.isArray(normalized.individualCosts) ? normalized.individualCosts : []) {
    if (entry.category === "house-rent") {
      legacyHouseRentPaid[entry.memberId] = (legacyHouseRentPaid[entry.memberId] || 0) + Number(entry.amount || 0);
    }
  }
  delete normalized.individualCosts;

  normalized.members = normalized.members.map((member, index) => {
    const normalizedMember = { ...member };
    if (!member.role) {
      normalizedMember.role = "member";
    }
    if (member.active === undefined) {
      normalizedMember.active = true;
    }
    if (member.approved === undefined) {
      normalizedMember.approved = true;
    }
    if (!member.mobile) {
      if (member.role === "admin" || member.id === "member_admin") {
        normalizedMember.mobile = "01518910492";
      } else if (member.id === "member_mahbub") {
        normalizedMember.mobile = "01700000001";
      } else if (member.id === "member_bappy") {
        normalizedMember.mobile = "01700000002";
      } else {
        normalizedMember.mobile = `019${String(index + 1).padStart(8, "0")}`;
      }
    }
    if (typeof member.password !== "string" || !member.password) {
      normalizedMember.password =
        member.role === "admin" || member.id === "member_admin" ? "admin492" : `${normalizedMember.mobile.slice(-4)}`
    }
    if (!isHashed(normalizedMember.password)) {
      normalizedMember.password = hashPassword(normalizedMember.password);
    }
    // Older data kept one overwritable "rentAmount/rentPaid" pair per member.
    normalizedMember.fixedAmount = money(member.fixedAmount ?? member.rentAmount ?? 0);
    normalizedMember.openingBalance = money(member.openingBalance || 0);
    const legacyPaid = money(member.rentPaid || legacyHouseRentPaid[member.id] || 0);
    if (legacyPaid > 0) {
      normalized.payments.push({
        id: `payment_fixed_${member.id}_migrated`,
        memberId: member.id,
        date: new Date().toISOString().slice(0, 10),
        note: "Fixed cost payment",
        amount: legacyPaid,
        kind: "fixed",
        month
      });
    }
    delete normalizedMember.rentAmount;
    delete normalizedMember.rentPaid;
    return normalizedMember;
  });

  const hasAdmin = normalized.members.some((member) => member.role === "admin" && member.active !== false);
  if (!hasAdmin && normalized.members[0]) {
    normalized.members[0].role = "admin";
  }

  return normalized;
}

async function initStore() {
  await backend.init(initialStore);
  // Persist any normalization, e.g. hashing passwords left over from older data.
  await updateStore((store) => store);
}

async function readStore() {
  return normalizeStore(await backend.read());
}

async function updateStore(updater) {
  return backend.update(async (data) => normalizeStore(await updater(normalizeStore(data))));
}

function nextMonth(month) {
  const [year, monthNumber] = String(month).split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber, 1));
  return Number.isNaN(date.getTime()) ? currentMonth() : date.toISOString().slice(0, 7);
}

// Everything the calculator needs for one month. The open month uses the members'
// current fixed amounts and house bills; a closed month uses what was saved when it
// was closed, so later changes never rewrite history.
function monthData(store, month) {
  const inMonth = (entry) => entry.month === month;
  const base = {
    bazarEntries: store.bazarEntries.filter(inMonth),
    payments: store.payments.filter(inMonth),
    mealCounts: store.meals[month] || {}
  };
  if (month === store.month) {
    return { ...base, members: store.members, fixedCosts: store.fixedCosts };
  }
  const closed = store.history.find((entry) => entry.month === month);
  if (!closed) {
    return null;
  }
  const memberIds = new Set(closed.memberIds);
  return {
    ...base,
    fixedCosts: closed.houseBills || [],
    members: store.members
      .filter((member) => memberIds.has(member.id))
      .map((member) => ({
        ...member,
        active: true,
        fixedAmount: closed.fixedAmounts?.[member.id] || 0,
        openingBalance: closed.openingBalances?.[member.id] || 0
      }))
  };
}

function monthReport(store, month = store.month) {
  const data = monthData(store, month);
  return data ? calculateReport(data) : null;
}

// Closes the open month without deleting anything: its fixed amounts, opening balances
// and house bills are saved so the month can always be recalculated, and each member's
// balance carries over into the next month.
function startNextMonth(store) {
  const report = monthReport(store);

  store.history.unshift({
    month: store.month,
    closedAt: new Date().toISOString(),
    memberIds: report.rows.map((row) => row.memberId),
    fixedAmounts: Object.fromEntries(report.rows.map((row) => [row.memberId, row.fixedCost])),
    openingBalances: Object.fromEntries(report.rows.map((row) => [row.memberId, row.previousBalance])),
    houseBills: store.fixedCosts.map((entry) => ({ ...entry }))
  });
  const balances = new Map(report.rows.map((row) => [row.memberId, row.balance]));
  store.members = store.members.map((member) =>
    balances.has(member.id) ? { ...member, openingBalance: balances.get(member.id) } : member
  );
  store.month = nextMonth(store.month);
  return store;
}

// Clears the money side (all months' bazar, meals and payments, closed months and
// carried-over balances) but keeps members and their logins, monthly fixed amounts,
// house bills and settings, so a reset never locks anyone out.
function clearFinancialData(store) {
  store.month = currentMonth();
  store.bazarEntries = [];
  store.payments = [];
  store.meals = {};
  store.history = [];
  store.members = store.members.map((member) => ({ ...member, openingBalance: 0 }));
  return store;
}

async function resetStore() {
  return updateStore(clearFinancialData);
}

module.exports = {
  backend,
  clearFinancialData,
  initStore,
  initialStore,
  monthReport,
  normalizeStore,
  nowId,
  readStore,
  resetStore,
  sampleStore,
  startNextMonth,
  updateStore
};
