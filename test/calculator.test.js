const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateReport } = require("../src/calculator");

test("calculates dynamic meal rate and user balances", () => {
  const store = {
    members: [
      { id: "a", name: "Ferdous", role: "admin", active: true },
      { id: "b", name: "Rahim", role: "member", active: true }
    ],
    fixedCosts: [],
    bazarEntries: [
      { id: "b1", memberId: "a", amount: 1000 },
      { id: "b2", memberId: "b", amount: 500 }
    ],
    mealCounts: {
      a: 10,
      b: 20
    },
    payments: []
  };

  const report = calculateReport(store);

  assert.equal(report.summary.totalBazarCost, 1500);
  assert.equal(report.summary.totalMeals, 30);
  assert.equal(report.summary.mealRate, 50);
  assert.equal(report.rows.find((row) => row.memberId === "a").balance, -500);
  assert.equal(report.rows.find((row) => row.memberId === "b").balance, 500);
  assert.equal(report.settlement, undefined);
});

test("member with zero meals has zero meal cost", () => {
  const store = {
    members: [
      { id: "a", name: "A", role: "admin", active: true },
      { id: "b", name: "B", role: "member", active: true }
    ],
    fixedCosts: [],
    bazarEntries: [{ id: "b1", memberId: "a", amount: 900 }],
    mealCounts: {
      a: 9,
      b: 0
    },
    payments: []
  };

  const report = calculateReport(store);

  assert.equal(report.rows.find((row) => row.memberId === "b").mealCost, 0);
});

test("charges each member's own monthly fixed amount, not a split of the house bills", () => {
  const store = {
    members: [
      { id: "a", name: "A", role: "admin", active: true, fixedAmount: 3000 },
      { id: "b", name: "B", role: "member", active: true, fixedAmount: 2000, openingBalance: 150 }
    ],
    fixedCosts: [{ id: "rent", label: "House rent", amount: 5000 }],
    bazarEntries: [],
    mealCounts: { a: 0, b: 0 },
    payments: [
      { id: "p1", memberId: "b", amount: 600, kind: "fixed" },
      { id: "p2", memberId: "b", amount: 400, kind: "fixed" },
      { id: "p3", memberId: "b", amount: 100, kind: "meal" }
    ]
  };

  const report = calculateReport(store);
  const a = report.rows.find((row) => row.memberId === "a");
  const b = report.rows.find((row) => row.memberId === "b");

  assert.equal(a.fixedCost, 3000);
  assert.equal(b.fixedCost, 2000);
  assert.equal(b.fixedPaid, 1000);
  assert.equal(b.fixedDue, 1000);
  assert.equal(b.totalPayable, 2150);
  assert.equal(b.balance, 1050);
  assert.equal(report.summary.fixedCostTotal, 5000);
  assert.equal(report.summary.fixedAssignedTotal, 5000);
  assert.equal(report.summary.fixedRemaining, -4000);
});

// Eight people, hand-checked. Total bazar 20,000 / 400 meals = meal rate 50.
test("eight-member month: meal and fixed parts stay separate and add up to total due", () => {
  const people = [
    // id, fixed cost, bazar, meals, meal payment, fixed payment
    ["ferdous", 2000, 5000, 55, 0, 1500],
    ["rakib", 2000, 3000, 48, 0, 2000],
    ["hasan", 1500, 4000, 52, 0, 1000],
    ["m4", 2500, 2000, 50, 500, 2500],
    ["m5", 2000, 0, 45, 1000, 2000],
    ["m6", 2000, 3000, 55, 0, 2500],
    ["m7", 1800, 1500, 50, 0, 0],
    ["m8", 2200, 1500, 45, 0, 2200]
  ];
  const store = {
    members: people.map(([id, fixedAmount]) => ({ id, name: id, role: "member", active: true, fixedAmount })),
    fixedCosts: [{ id: "rent", label: "House rent", amount: 16000 }],
    bazarEntries: people.map(([id, , bazar]) => ({ id: `b_${id}`, memberId: id, amount: bazar })),
    mealCounts: Object.fromEntries(people.map(([id, , , meals]) => [id, meals])),
    payments: people.flatMap(([id, , , , mealPaid, fixedPaid]) => [
      { id: `pm_${id}`, memberId: id, amount: mealPaid, kind: "meal" },
      { id: `pf_${id}`, memberId: id, amount: fixedPaid, kind: "fixed" }
    ])
  };

  const report = calculateReport(store);
  const row = (id) => report.rows.find((item) => item.memberId === id);
  const pick = (id) => {
    const r = row(id);
    return [r.mealCost, r.mealBalance, r.fixedBalance, r.fixedDue, r.balance];
  };

  assert.equal(report.summary.totalBazarCost, 20000);
  assert.equal(report.summary.totalMeals, 400);
  assert.equal(report.summary.mealRate, 50);
  assert.equal(report.summary.totalMealCost, 20000);

  //                         meal cost, meal bal, fixed bal, fixed due, total
  assert.deepEqual(pick("ferdous"), [2750, -2250, 500, 500, -1750]); // fixed due, big meal credit
  assert.deepEqual(pick("rakib"), [2400, -600, 0, 0, -600]); // meal credit only
  assert.deepEqual(pick("hasan"), [2600, -1400, 500, 500, -900]); // credit outweighs fixed due
  assert.deepEqual(pick("m4"), [2500, 0, 0, 0, 0]); // nothing due
  assert.deepEqual(pick("m5"), [2250, 1250, 0, 0, 1250]); // meal due only
  assert.deepEqual(pick("m6"), [2750, -250, -500, 0, -750]); // paid more fixed cost than required
  assert.deepEqual(pick("m7"), [2500, 1000, 1800, 1800, 2800]); // both due
  assert.deepEqual(pick("m8"), [2250, 750, 0, 0, 750]); // meal due only

  assert.equal(report.summary.fixedAssignedTotal, 16000);
  assert.equal(report.summary.fixedDueTotal, 2800);
  assert.equal(report.summary.paymentsTotal, 15200);
  assert.equal(report.summary.dueTotal, 4800);
  assert.equal(report.summary.netBalance, 800);
  assert.equal(row("m5").mealTotalPaid, 1000); // no bazar, 1000 cash
  assert.equal(row("m4").mealTotalPaid, 2500); // 2000 bazar + 500 cash
  assert.equal(report.summary.mealTotalPaid, 21500);
  for (const r of report.rows) {
    assert.equal(r.mealTotalPaid, r.bazarPaid + r.mealPaid);
    assert.equal(r.mealBalance, r.mealCost - r.mealTotalPaid);
    assert.equal(r.balance, r.mealBalance + r.fixedBalance + r.previousBalance);
  }
});
