process.env.DB_PATH = ":memory:";
process.env.REGISTER_MAX = "1000";
process.env.LOGIN_MAX = "1000";
process.env.ACCOUNT_MAX = "1000";
process.env.MAX_EXPENSES = "5"; // ตั้งต่ำเพื่อทดสอบเพดานได้เร็ว

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { app, db, cleanupSessions } = require("../server.js");

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  server.closeAllConnections();
});

// ---------- ตัวช่วย ----------
async function call(method, path, { body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;

  const response = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = Buffer.from(await response.arrayBuffer()).toString("utf8");
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ไม่ใช่ JSON
  }

  const sid = response.headers.getSetCookie().find((c) => c.startsWith("sid="));
  return {
    status: response.status,
    headers: response.headers,
    text,
    json,
    cookie: sid ? sid.split(";")[0] : null,
  };
}

let counter = 0;
async function newUser() {
  counter += 1;
  const username = "hard_" + counter;
  const res = await call("POST", "/api/register", {
    body: { username, password: "password123" },
  });
  assert.equal(res.status, 201);
  return { username, cookie: res.cookie };
}

const sample = {
  title: "ข้าวมันไก่",
  category: "อาหาร",
  amount: 50,
  date: "2026-11-03",
};
const NOV = "/api/expenses?month=2026-11";

// ---------- health check ----------
test("healthz ตอบ ok โดยไม่ต้องล็อกอิน", async () => {
  const res = await call("GET", "/healthz");
  assert.equal(res.status, 200);
  assert.equal(res.text, "ok");
});

// ---------- ตรวจข้อมูลเข้มขึ้น ----------
test("ปฏิเสธจำนวนเงิน ชื่อ หมวด และวันที่ที่ผิดปกติ", async () => {
  const { cookie } = await newUser();
  const badBodies = [
    { ...sample, amount: 0 },
    { ...sample, amount: -5 },
    { ...sample, amount: 0.001 },
    { ...sample, amount: 1e12 },
    { ...sample, title: "ก".repeat(81) },
    { ...sample, category: "ไม่มีหมวดนี้" },
    { ...sample, date: "1999-12-31" },
    { ...sample, date: "2101-01-01" },
  ];
  for (const body of badBodies) {
    const res = await call("POST", "/api/expenses", { body, cookie });
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
  }

  const created = await call("POST", "/api/expenses", { body: sample, cookie });
  assert.equal(created.status, 201);

  const put = await call("PUT", `/api/expenses/${created.json.id}`, {
    body: { ...sample, category: "ไม่มีหมวดนี้" },
    cookie,
  });
  assert.equal(put.status, 400);

  const list = await call("GET", NOV, { cookie });
  assert.equal(list.json.length, 1);
});

test("ตัดช่องว่างชื่อรายการ และปัดเงินเป็นทศนิยม 2 ตำแหน่ง", async () => {
  const { cookie } = await newUser();
  const res = await call("POST", "/api/expenses", {
    body: { ...sample, title: "  ข้าว  ", amount: 7.126 },
    cookie,
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.title, "ข้าว");
  assert.equal(res.json.amount, 7.13);

  const list = await call("GET", NOV, { cookie });
  assert.equal(list.json[0].title, "ข้าว");
  assert.equal(list.json[0].amount, 7.13);
});

test("จำกัดจำนวนรายการต่อผู้ใช้", async () => {
  const alice = await newUser();
  const bob = await newUser();

  for (let i = 0; i < 5; i += 1) {
    const res = await call("POST", "/api/expenses", {
      body: { ...sample, title: "รายการ " + i },
      cookie: alice.cookie,
    });
    assert.equal(res.status, 201);
  }
  const over = await call("POST", "/api/expenses", {
    body: sample,
    cookie: alice.cookie,
  });
  assert.equal(over.status, 409);

  // ผู้ใช้อื่นไม่ได้รับผลกระทบ
  const other = await call("POST", "/api/expenses", {
    body: sample,
    cookie: bob.cookie,
  });
  assert.equal(other.status, 201);

  // ลบแล้วเพิ่มได้อีก
  const list = await call("GET", NOV, { cookie: alice.cookie });
  await call("DELETE", `/api/expenses/${list.json[0].id}`, { cookie: alice.cookie });
  const again = await call("POST", "/api/expenses", {
    body: sample,
    cookie: alice.cookie,
  });
  assert.equal(again.status, 201);
});

// ---------- ล้างบัตรผ่านหมดอายุ ----------
test("ล้างบัตรผ่านที่หมดอายุ แต่ไม่แตะบัตรที่ยังใช้ได้", async () => {
  const user = await newUser();
  const row = db
    .prepare("SELECT id FROM users WHERE username = ?")
    .get(user.username);
  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)"
  ).run("expired-test-hash", row.id, Date.now() - 1000);

  cleanupSessions();

  const expired = db
    .prepare("SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?")
    .get("expired-test-hash");
  assert.equal(expired.n, 0);

  const me = await call("GET", "/api/me", { cookie: user.cookie });
  assert.equal(me.status, 200);
});

// ---------- เปลี่ยนรหัสผ่าน ----------
test("เปลี่ยนรหัสผ่าน: บัตรเก่าใช้ไม่ได้ ได้บัตรใหม่ รหัสเก่าล็อกอินไม่ได้", async () => {
  const user = await newUser();

  const otherDevice = await call("POST", "/api/login", {
    body: { username: user.username, password: "password123" },
  });
  assert.equal(otherDevice.status, 200);

  const unauth = await call("POST", "/api/change-password", {
    body: { currentPassword: "password123", newPassword: "new-password-456" },
  });
  assert.equal(unauth.status, 401);

  const missing = await call("POST", "/api/change-password", {
    body: {},
    cookie: user.cookie,
  });
  assert.equal(missing.status, 400);

  const wrong = await call("POST", "/api/change-password", {
    body: { currentPassword: "not-the-password", newPassword: "new-password-456" },
    cookie: user.cookie,
  });
  assert.equal(wrong.status, 400);

  const tooShort = await call("POST", "/api/change-password", {
    body: { currentPassword: "password123", newPassword: "short" },
    cookie: user.cookie,
  });
  assert.equal(tooShort.status, 400);

  const changed = await call("POST", "/api/change-password", {
    body: { currentPassword: "password123", newPassword: "new-password-456" },
    cookie: user.cookie,
  });
  assert.equal(changed.status, 204);
  assert.ok(changed.cookie.startsWith("sid="));

  assert.equal((await call("GET", "/api/me", { cookie: user.cookie })).status, 401);
  assert.equal((await call("GET", "/api/me", { cookie: otherDevice.cookie })).status, 401);
  assert.equal((await call("GET", "/api/me", { cookie: changed.cookie })).status, 200);

  const oldLogin = await call("POST", "/api/login", {
    body: { username: user.username, password: "password123" },
  });
  assert.equal(oldLogin.status, 401);

  const newLogin = await call("POST", "/api/login", {
    body: { username: user.username, password: "new-password-456" },
  });
  assert.equal(newLogin.status, 200);
});

// ---------- ลบบัญชี ----------
test("ลบบัญชี: ต้องยืนยันรหัส ข้อมูลหายหมด แต่ผู้ใช้อื่นไม่กระทบ", async () => {
  const user = await newUser();
  const other = await newUser();
  const userId = db
    .prepare("SELECT id FROM users WHERE username = ?")
    .get(user.username).id;

  await call("POST", "/api/expenses", { body: sample, cookie: user.cookie });
  await call("PUT", "/api/budgets", {
    body: { budgets: { อาหาร: 100 } },
    cookie: user.cookie,
  });
  await call("POST", "/api/expenses", { body: sample, cookie: other.cookie });

  const wrong = await call("DELETE", "/api/account", {
    body: { password: "wrong-password" },
    cookie: user.cookie,
  });
  assert.equal(wrong.status, 400);
  assert.equal((await call("GET", "/api/me", { cookie: user.cookie })).status, 200);

  const noBody = await call("DELETE", "/api/account", { cookie: user.cookie });
  assert.equal(noBody.status, 400);

  const removed = await call("DELETE", "/api/account", {
    body: { password: "password123" },
    cookie: user.cookie,
  });
  assert.equal(removed.status, 204);

  assert.equal((await call("GET", "/api/me", { cookie: user.cookie })).status, 401);
  const login = await call("POST", "/api/login", {
    body: { username: user.username, password: "password123" },
  });
  assert.equal(login.status, 401);

  const count = (table) =>
    db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(userId).n;
  assert.equal(count("expenses"), 0);
  assert.equal(count("budgets"), 0);
  assert.equal(count("sessions"), 0);

  const otherList = await call("GET", NOV, { cookie: other.cookie });
  assert.equal(otherList.json.length, 1);
});