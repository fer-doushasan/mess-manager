// End-to-end: one month of an 8-person house, driven only through the API.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mess-flow-"));
process.env.DATA_FILE = path.join(tempDir, "store.json");
process.env.ADMIN_NAME = "Ferdous";
process.env.ADMIN_MOBILE = "01710000001";
process.env.ADMIN_PASSWORD = "admin-pass";
delete process.env.DATABASE_URL;

const { app, initStore } = require("../src/server");

// name, mobile, fixed cost, bazar, meals, meal payment, fixed payment
const PEOPLE = [
  ["Ferdous", "01710000001", 2000, 5000, 55, 0, 1500],
  ["Rakib", "01710000002", 2000, 3000, 48, 0, 2000],
  ["Hasan", "01710000003", 1500, 4000, 52, 0, 1000],
  ["Member 4", "01710000004", 2500, 2000, 50, 500, 2500],
  ["Member 5", "01710000005", 2000, 0, 45, 1000, 2000],
  ["Member 6", "01710000006", 2000, 3000, 55, 0, 2500],
  ["Member 7", "01710000007", 1800, 1500, 50, 0, 0],
  ["Member 8", "01710000008", 2200, 1500, 45, 0, 2200]
];
// name -> [meal cost, meal balance, fixed due, total due], hand-calculated at meal rate 50
const EXPECTED = {
  Ferdous: [2750, -2250, 500, -1750],
  Rakib: [2400, -600, 0, -600],
  Hasan: [2600, -1400, 500, -900],
  "Member 4": [2500, 0, 0, 0],
  "Member 5": [2250, 1250, 0, 1250],
  "Member 6": [2750, -250, 0, -750],
  "Member 7": [2500, 1000, 1800, 2800],
  "Member 8": [2250, 750, 0, 750]
};

let baseUrl;
let server;

test.before(async () => {
  await initStore();
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function call(method, url, { body, cookie } = {}) {
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => null);
  assert.ok(response.ok, `${method} ${url} -> ${response.status} ${data?.message}`);
  return { data, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

async function login(mobile, password) {
  return (await call("POST", "/api/session", { body: { mobile, password } })).cookie;
}

test("an 8-person month from start to close", async () => {
  const admin = await login("01710000001", "admin-pass");

  // Admin adds the other 7 people and sets everyone's fixed cost.
  for (const [name, mobile] of PEOPLE.slice(1)) {
    await call("POST", "/api/members", { cookie: admin, body: { name, mobile, password: "pass1234" } });
  }
  const { data: adminState } = await call("GET", "/api/state", { cookie: admin });
  const idOf = Object.fromEntries(adminState.store.members.map((member) => [member.name, member.id]));
  for (const [name, , fixed] of PEOPLE) {
    await call("PUT", `/api/members/${idOf[name]}/fixed-amount`, { cookie: admin, body: { amount: fixed } });
  }

  // Everyone adds their own bazar and payments, except Hasan, who forgot his bazar,
  // and Member 8, whose rent the admin records.
  for (const [name, mobile, , bazar, , mealPaid, fixedPaid] of PEOPLE) {
    const cookie = name === "Ferdous" ? admin : await login(mobile, "pass1234");
    if (bazar && name !== "Hasan") {
      await call("POST", "/api/bazar", { cookie, body: { amount: bazar, description: "Bazar" } });
    }
    if (mealPaid) {
      await call("POST", "/api/payments", { cookie, body: { amount: mealPaid, kind: "meal" } });
    }
    if (fixedPaid && name !== "Member 8") {
      await call("POST", "/api/payments", { cookie, body: { amount: fixedPaid, kind: "fixed" } });
    }
  }
  await call("POST", "/api/bazar", { cookie: admin, body: { memberId: idOf.Hasan, amount: 4000, description: "Added by admin" } });
  await call("POST", "/api/payments", { cookie: admin, body: { memberId: idOf["Member 8"], amount: 2200, kind: "fixed" } });

  // Admin enters everyone's meals.
  for (const [name, , , , meals] of PEOPLE) {
    await call("PUT", `/api/meals/${idOf[name]}`, { cookie: admin, body: { count: meals } });
  }

  // A member sees the shared tables with everyone's numbers, and their own breakdown.
  const member7 = await login("01710000007", "pass1234");
  const { data: view } = await call("GET", "/api/state", { cookie: member7 });
  assert.equal(view.summary.totalBazarCost, 20000);
  assert.equal(view.summary.totalMeals, 400);
  assert.equal(view.summary.mealRate, 50);
  assert.equal(view.members.length, 8);
  for (const row of view.members) {
    assert.deepEqual([row.mealCost, row.mealBalance, row.fixedDue, row.balance], EXPECTED[row.name], row.name);
    assert.equal(row.balance, row.mealBalance + row.fixedBalance + row.previousBalance);
  }
  assert.equal(view.bazarEntries.length, 7, "everyone's bazar is visible");
  assert.ok(view.bazarEntries.some((entry) => entry.memberName === "Hasan" && entry.amount === 4000));
  assert.deepEqual([view.me.fixedCost, view.me.fixedPaid, view.me.fixedDue], [1800, 0, 1800]);
  assert.deepEqual([view.me.mealCost, view.me.bazarPaid, view.me.mealBalance, view.me.balance], [2500, 1500, 1000, 2800]);
  assert.ok(!JSON.stringify(view).includes("01710000002"), "no other member's mobile number");

  // Close the month: it stays viewable with the same numbers, and balances carry over.
  const { data: closed } = await call("POST", "/api/month/close", { cookie: admin });
  const previous = closed.previousMonths[0];
  assert.equal(previous.report.summary.mealRate, 50);
  for (const row of previous.report.rows) {
    assert.equal(row.balance, EXPECTED[row.name][3], row.name);
  }
  assert.equal(closed.report.summary.totalBazarCost, 0);
  const { data: nextMonth } = await call("GET", "/api/state", { cookie: member7 });
  assert.notEqual(nextMonth.month, view.month);
  assert.equal(nextMonth.me.previousBalance, 2800);
  assert.equal(nextMonth.me.balance, 2800 + 1800, "carried balance + this month's fixed cost");
});
