const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mess-manager-"));
process.env.DATA_FILE = path.join(tempDir, "store.json");
delete process.env.DATABASE_URL;
delete process.env.ADMIN_MOBILE;

const { app, initStore } = require("../src/server");

// Sample data accounts (see sampleStore in src/store.js).
const ADMIN = ["01518910492", "admin492"];
const MAHBUB = ["01700000001", "mahbub123"];
const BAPPY = ["01700000002", "bappy123"];
const HABIB = ["01700000004", "habib123"];

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
  return { status: response.status, headers: response.headers, data: await response.json().catch(() => null) };
}

async function login([mobile, password]) {
  const response = await call("POST", "/api/session", { body: { mobile, password } });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}

async function status(method, url, options) {
  return (await call(method, url, options)).status;
}

test("anonymous requests are rejected", async () => {
  assert.equal(await status("GET", "/api/state"), 401);
  assert.equal(await status("POST", "/api/bazar", { body: { amount: 100 } }), 401);
  assert.equal(await status("POST", "/api/payments", { body: { amount: 100 } }), 401);
  assert.equal(await status("PUT", "/api/meals/member_mahbub", { body: { count: 1 } }), 401);
  assert.equal(await status("PUT", "/api/settings", { body: { messName: "x" } }), 401);
  assert.equal(await status("POST", "/api/month/close"), 401);
  assert.equal(await status("POST", "/api/members", { body: { name: "x", mobile: "1", password: "123456" } }), 401);
  assert.equal(await status("GET", "/api/public-state"), 404);
  assert.equal(await status("GET", "/api/session/options"), 404);
});

test("passwords are stored hashed and never returned", async () => {
  const stored = JSON.parse(fs.readFileSync(process.env.DATA_FILE, "utf8"));
  assert.ok(stored.members.every((member) => member.password.startsWith("scrypt$")));

  const admin = await call("POST", "/api/session", { body: { mobile: ADMIN[0], password: ADMIN[1] } });
  assert.ok(admin.data.store.members.every((member) => member.password === undefined));
  const member = await call("POST", "/api/session", { body: { mobile: MAHBUB[0], password: MAHBUB[1] } });
  assert.equal(member.data.viewer.password, undefined);
  assert.equal(await status("POST", "/api/session", { body: { mobile: ADMIN[0], password: "wrong" } }), 401);
});

test("member dashboard shows own figures and a mess overview without sensitive data", async () => {
  const cookie = await login(MAHBUB);
  const { status: code, data } = await call("GET", "/api/state", { cookie });
  assert.equal(code, 200);

  assert.equal(data.viewer.role, "member");
  assert.equal(data.me.memberId, "member_mahbub");
  assert.equal(typeof data.me.balance, "number");
  assert.equal(typeof data.me.fixedDue, "number");
  assert.equal(typeof data.summary.mealRate, "number");
  assert.ok(data.members.length > 1, "other members' balances are visible");
  assert.ok(data.members.every((row) => "bazarPaid" in row && "balance" in row));
  assert.ok(data.bazarEntries.some((entry) => entry.memberId !== "member_mahbub"), "all bazar is visible");

  // No admin data and no one else's mobile numbers or payments.
  assert.equal(data.store, undefined);
  assert.equal(data.report, undefined);
  assert.equal(data.history, undefined);
  assert.ok(data.payments.every((entry) => entry.memberId === "member_mahbub"));
  const json = JSON.stringify(data);
  for (const mobile of ["01518910492", "01700000002", "01700000003", "01700000005"]) {
    assert.ok(!json.includes(mobile), `member response leaks ${mobile}`);
  }
});

test("member can manage their own account", async () => {
  const cookie = await login(MAHBUB);
  assert.equal(await status("POST", "/api/bazar", { cookie, body: { amount: 250, description: "Eggs" } }), 201);
  assert.equal(
    await status("POST", "/api/bazar", { cookie, body: { amount: 50, memberId: "member_mahbub" } }),
    201
  );
  assert.equal(await status("POST", "/api/payments", { cookie, body: { amount: 700, kind: "fixed" } }), 201);
  assert.equal(await status("POST", "/api/payments", { cookie, body: { amount: 300, kind: "meal" } }), 201);

  const { data } = await call("GET", "/api/state", { cookie });
  assert.equal(data.me.fixedPaid, 700);
  assert.equal(data.me.mealPaid, 300);
  assert.equal(data.payments.length, 2);
});

test("member cannot touch other members' data", async () => {
  const cookie = await login(MAHBUB);
  assert.equal(await status("PUT", "/api/meals/member_bappy", { cookie, body: { count: 99 } }), 403);
  assert.equal(await status("PUT", "/api/meals/member_mahbub", { cookie, body: { count: 1 } }), 403, "meals are admin-only");
  assert.equal(
    await status("POST", "/api/bazar", { cookie, body: { amount: 100, memberId: "member_bappy" } }),
    403
  );
  assert.equal(
    await status("POST", "/api/payments", { cookie, body: { amount: 5000, memberId: "member_bappy" } }),
    403
  );
  assert.equal(await status("DELETE", "/api/payments/payment_bappy_1", { cookie }), 403);
  assert.equal(await status("DELETE", "/api/bazar/bazar_ferdous_1", { cookie }), 403);
  assert.equal(await status("DELETE", "/api/bazar/bazar_mahbub_1", { cookie }), 403);
});

test("member cannot call admin-only APIs directly", async () => {
  const cookie = await login(MAHBUB);
  const adminOnly = [
    ["PUT", "/api/settings", { messName: "Hacked" }],
    ["POST", "/api/members", { name: "X", mobile: "01999999999", password: "123456" }],
    ["PUT", "/api/members/member_bappy", { name: "X", mobile: "01700000002", role: "admin" }],
    ["PUT", "/api/members/member_mahbub", { name: "Mahbub", mobile: "01700000001", role: "admin" }],
    ["PUT", "/api/members/member_bappy/approval", { approved: false }],
    ["DELETE", "/api/members/member_bappy"],
    ["PUT", "/api/members/member_mahbub/fixed-amount", { amount: 0 }],
    ["POST", "/api/fixed-costs", { label: "X", amount: 1 }],
    ["DELETE", "/api/fixed-costs/fixed_rent"],
    ["PUT", "/api/bazar/bazar_mahbub_1", { amount: 1 }],
    ["POST", "/api/month/close"],
    ["POST", "/api/reset"]
  ];
  for (const [method, url, body] of adminOnly) {
    const response = await call(method, url, { cookie, body });
    assert.equal(response.status, 403, `${method} ${url}`);
    assert.equal(response.data.message, "Admin access required.");
  }

  const { data } = await call("GET", "/api/state", { cookie });
  assert.equal(data.viewer.role, "member");
  assert.equal(data.settings.messName, "Sweet Home");
});

test("admin manages members, settings and payments", async () => {
  const cookie = await login(ADMIN);

  assert.equal(await status("PUT", "/api/settings", { cookie, body: { messName: "Green Villa" } }), 200);
  const memberState = (await call("GET", "/api/state", { cookie: await login(BAPPY) })).data;
  assert.equal(memberState.settings.messName, "Green Villa");

  const created = await call("POST", "/api/members", {
    cookie,
    body: { name: "Sami", mobile: "01711111111", password: "sami1234", role: "member" }
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.viewer.role, "admin", "adding a member no longer demotes the admin");
  const sami = created.data.store.members.find((member) => member.name === "Sami");

  const edited = await call("PUT", `/api/members/${sami.id}`, {
    cookie,
    body: { name: "Sami Khan", mobile: "01711111112", role: "member", password: "newpass1" }
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.store.members.find((member) => member.id === sami.id).name, "Sami Khan");
  assert.equal(await status("POST", "/api/session", { body: { mobile: "01711111112", password: "newpass1" } }), 200);

  assert.equal(
    await status("PUT", "/api/members/member_admin", {
      cookie,
      body: { name: "Ferdous", mobile: ADMIN[0], role: "member" }
    }),
    400,
    "the last admin cannot demote themselves"
  );

  const paid = await call("POST", "/api/payments", { cookie, body: { memberId: "member_bappy", amount: 500 } });
  assert.equal(paid.status, 201);
  const payment = paid.data.store.payments.find((entry) => entry.memberId === "member_bappy" && entry.amount === 500);
  assert.equal(await status("DELETE", `/api/payments/${payment.id}`, { cookie }), 200);
  assert.equal(await status("PUT", "/api/meals/member_bappy", { cookie, body: { count: 12 } }), 200);
  assert.equal(await status("DELETE", "/api/bazar/bazar_mahbub_1", { cookie }), 200);
});

test("logout ends the session", async () => {
  const cookie = await login(BAPPY);
  assert.equal(await status("GET", "/api/state", { cookie }), 200);
  await call("DELETE", "/api/session", { cookie });
  assert.equal(await status("GET", "/api/state", { cookie }), 401);
});

test("repeated wrong passwords are blocked", async () => {
  const body = { mobile: "01700000003", password: "wrong" };
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal(await status("POST", "/api/session", { body }), 401);
  }
  assert.equal(await status("POST", "/api/session", { body }), 429);
});

test("monthly fixed amounts: admin sets them, payments add up", async () => {
  const admin = await login(ADMIN);
  await call("PUT", "/api/members/member_habib/fixed-amount", { cookie: admin, body: { amount: 2000 } });

  const member = await login(HABIB);
  await call("POST", "/api/payments", { cookie: member, body: { amount: 600 } });
  const response = await call("POST", "/api/payments", { cookie: member, body: { amount: 400 } });
  assert.deepEqual([response.data.me.fixedCost, response.data.me.fixedPaid, response.data.me.fixedDue], [2000, 1000, 1000]);
});

test("closing a month preserves it and carries balances over", async () => {
  const admin = await login(ADMIN);
  const before = (await call("GET", "/api/state", { cookie: admin })).data;
  const habibBefore = before.report.rows.find((row) => row.memberId === "member_habib");
  const mayBazar = before.store.bazarEntries.filter((entry) => entry.month === "2026-05");

  const { status: code, data } = await call("POST", "/api/month/close", { cookie: admin });
  assert.equal(code, 200);
  assert.equal(data.month, "2026-06");

  // May is kept in full and recalculates to the same numbers.
  const may = data.previousMonths.find((entry) => entry.month === "2026-05");
  assert.deepEqual(may.report.rows, before.report.rows);
  assert.equal(data.store.bazarEntries.filter((entry) => entry.month === "2026-05").length, mayBazar.length);

  // June starts empty, keeps the fixed amounts and carries May's balance.
  const habib = data.report.rows.find((row) => row.memberId === "member_habib");
  assert.equal(data.report.summary.totalBazarCost, 0);
  assert.equal(habib.fixedCost, 2000);
  assert.equal(habib.previousBalance, habibBefore.balance);
  assert.equal(habib.balance, habibBefore.balance + 2000);

  // A closed month can no longer be edited.
  assert.equal(await status("DELETE", `/api/bazar/${mayBazar[0].id}`, { cookie: admin }), 400);
  assert.equal(await status("PUT", `/api/bazar/${mayBazar[0].id}`, { cookie: admin, body: { amount: 1 } }), 400);

  // Changing a fixed amount now does not rewrite May.
  const changed = await call("PUT", "/api/members/member_habib/fixed-amount", { cookie: admin, body: { amount: 9999 } });
  assert.equal(changed.data.previousMonths[0].report.rows.find((row) => row.memberId === "member_habib").fixedCost, 2000);
});

test("reset clears money data but keeps every login", async () => {
  const admin = await login(ADMIN);
  const { status: code, data } = await call("POST", "/api/reset", { cookie: admin });
  assert.equal(code, 200);
  assert.equal(data.viewer.role, "admin", "admin stays logged in");
  assert.equal(data.store.bazarEntries.length, 0);
  assert.equal(data.store.payments.length, 0);
  assert.equal(data.store.history.length, 0);
  assert.ok(data.report.rows.every((row) => row.balance === row.fixedCost));
  assert.equal(data.store.members.find((member) => member.id === "member_habib").fixedAmount, 9999, "fixed amounts are kept");
  assert.equal(data.settings.messName, "Green Villa");

  assert.equal(await status("GET", "/api/state", { cookie: admin }), 200);
  assert.equal(await status("POST", "/api/session", { body: { mobile: MAHBUB[0], password: MAHBUB[1] } }), 200);
  assert.equal(await status("POST", "/api/session", { body: { mobile: "01711111112", password: "newpass1" } }), 200);
});
