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
    individualCosts: [],
    payments: []
  };

  const report = calculateReport(store);

  assert.equal(report.summary.totalBazarCost, 1500);
  assert.equal(report.summary.totalMeals, 30);
  assert.equal(report.summary.mealRate, 50);
  assert.equal(report.rows.find((row) => row.memberId === "a").balance, -500);
  assert.equal(report.rows.find((row) => row.memberId === "b").balance, 500);
  assert.deepEqual(report.settlement, [
    {
      fromMemberId: "b",
      from: "Rahim",
      toMemberId: "a",
      to: "Ferdous",
      amount: 500
    }
  ]);
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
    individualCosts: [],
    payments: []
  };

  const report = calculateReport(store);

  assert.equal(report.rows.find((row) => row.memberId === "b").mealCost, 0);
});

test("supports equal and custom mandatory fixed-cost splits", () => {
  const store = {
    members: [
      { id: "a", name: "A", role: "admin", active: true },
      { id: "b", name: "B", role: "member", active: true }
    ],
    fixedCosts: [
      { id: "rent", label: "House rent", amount: 1000, splitType: "equal", allocations: {} },
      { id: "wifi", label: "WiFi", amount: 300, splitType: "custom", allocations: { a: 100, b: 200 } }
    ],
    bazarEntries: [],
    mealCounts: {
      a: 0,
      b: 0
    },
    individualCosts: [],
    payments: []
  };

  const report = calculateReport(store);

  assert.equal(report.rows.find((row) => row.memberId === "a").fixedCost, 600);
  assert.equal(report.rows.find((row) => row.memberId === "b").fixedCost, 700);
});
