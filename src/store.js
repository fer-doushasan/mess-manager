const fs = require("node:fs/promises");
const path = require("node:path");

const DATA_FILE = path.join(__dirname, "..", "data", "store.json");

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
        rentAmount: 0,
        rentPaid: 0
      },
      {
        id: "member_mahbub",
        name: "Mahbub",
        role: "member",
        active: true,
        mobile: "01700000001",
        approved: true,
        password: "mahbub123",
        rentAmount: 0,
        rentPaid: 0
      },
      {
        id: "member_bappy",
        name: "Bappy",
        role: "member",
        active: true,
        mobile: "01700000002",
        approved: true,
        password: "bappy123",
        rentAmount: 0,
        rentPaid: 0
      },
      {
        id: "member_taufiq",
        name: "Taufiq",
        role: "member",
        active: true,
        mobile: "01700000003",
        approved: true,
        password: "taufiq123",
        rentAmount: 0,
        rentPaid: 0
      },
      {
        id: "member_habib",
        name: "Habib",
        role: "member",
        active: true,
        mobile: "01700000004",
        approved: true,
        password: "habib123",
        rentAmount: 0,
        rentPaid: 0
      },
      {
        id: "member_miraj",
        name: "Miraj",
        role: "member",
        active: true,
        mobile: "01700000005",
        approved: true,
        password: "miraj123",
        rentAmount: 0,
        rentPaid: 0
      },
      {
        id: "member_alom",
        name: "Alom",
        role: "member",
        active: true,
        mobile: "01700000006",
        approved: true,
        password: "alom123",
        rentAmount: 0,
        rentPaid: 0
      },
      {
        id: "member_rakib",
        name: "Rakib",
        role: "member",
        active: true,
        mobile: "01700000007",
        approved: true,
        password: "rakib123",
        rentAmount: 0,
        rentPaid: 0
      }
    ],
    fixedCosts: [
      { id: "fixed_rent", label: "House rent", amount: 15000, splitType: "equal", allocations: {} },
      { id: "fixed_electricity", label: "Electricity bill", amount: 1800, splitType: "equal", allocations: {} },
      { id: "fixed_wifi", label: "WiFi bill", amount: 1000, splitType: "equal", allocations: {} }
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
    individualCosts: [
      { id: "individual_rakib_room", memberId: "member_rakib", label: "Personal room charge", amount: 1500 }
    ],
    payments: [
      { id: "payment_ferdous_1", memberId: "member_admin", date: "2026-05-03", note: "Cash deposit", amount: 4000 },
      { id: "payment_bappy_1", memberId: "member_bappy", date: "2026-05-03", note: "Advance", amount: 7000 }
    ]
  };
}

function normalizeStore(store) {
  const normalized = {
    ...sampleStore(),
    ...store
  };

  normalized.members = Array.isArray(normalized.members) ? normalized.members : [];
  normalized.fixedCosts = Array.isArray(normalized.fixedCosts) ? normalized.fixedCosts : [];
  normalized.bazarEntries = Array.isArray(normalized.bazarEntries) ? normalized.bazarEntries : [];
  normalized.mealCounts = normalized.mealCounts && typeof normalized.mealCounts === "object" ? normalized.mealCounts : {};
  normalized.individualCosts = Array.isArray(normalized.individualCosts) ? normalized.individualCosts : [];
  normalized.payments = Array.isArray(normalized.payments) ? normalized.payments : [];

  const legacyHouseRentPaid = {};
  normalized.individualCosts = normalized.individualCosts.filter((entry) => {
    if (entry.category !== "house-rent") {
      return true;
    }
    legacyHouseRentPaid[entry.memberId] = (legacyHouseRentPaid[entry.memberId] || 0) + Number(entry.amount || 0);
    return false;
  });

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
    normalizedMember.rentAmount = Number(member.rentAmount || 0);
    normalizedMember.rentPaid = Number(member.rentPaid || legacyHouseRentPaid[member.id] || 0);
    if (normalized.mealCounts[normalizedMember.id] === undefined) {
      normalized.mealCounts[normalizedMember.id] = 0;
    }
    return normalizedMember;
  });

  const hasAdmin = normalized.members.some((member) => member.role === "admin" && member.active !== false);
  if (!hasAdmin && normalized.members[0]) {
    normalized.members[0].role = "admin";
  }

  return normalized;
}

async function readStore() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    return normalizeStore(JSON.parse(raw));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    const fresh = sampleStore();
    await writeStore(fresh);
    return fresh;
  }
}

async function writeStore(store) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, `${JSON.stringify(normalizeStore(store), null, 2)}\n`, "utf8");
}

async function updateStore(updater) {
  const store = await readStore();
  const updated = normalizeStore(await updater(store));
  await writeStore(updated);
  return updated;
}

module.exports = {
  nowId,
  readStore,
  sampleStore,
  updateStore,
  writeStore
};
