// ใช้ฐานข้อมูลในหน่วยความจำ ไม่แตะ expenses.db จริง (ต้องตั้งก่อน require)
process.env.DB_PATH = ":memory:";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { app } = require("../server.js");

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve); // พอร์ต 0 = ให้ระบบเลือกพอร์ตว่างให้
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
    // ไม่ใช่ JSON (เช่นไฟล์ CSV)
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
  const username = "user_" + counter;
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

// ---------- บัญชีผู้ใช้ ----------
test("สมัครสมาชิกแล้วเข้าระบบได้ทันที", async () => {
  const user = await newUser();
  const me = await call("GET", "/api/me", { cookie: user.cookie });
  assert.equal(me.status, 200);
  assert.equal(me.json.username, user.username);
});

test("ชื่อผู้ใช้ซ้ำไม่ได้ (ไม่สนตัวพิมพ์เล็กใหญ่)", async () => {
  const first = await call("POST", "/api/register", {
    body: { username: "Somchai", password: "password123" },
  });
  assert.equal(first.status, 201);

  const again = await call("POST", "/api/register", {
    body: { username: "somchai", password: "password123" },
  });
  assert.equal(again.status, 409);
});

test("ชื่อผู้ใช้หรือรหัสผ่านที่ไม่ผ่านเกณฑ์ถูกปฏิเสธ", async () => {
  const badName = await call("POST", "/api/register", {
    body: { username: "a b", password: "password123" },
  });
  assert.equal(badName.status, 400);

  const shortPassword = await call("POST", "/api/register", {
    body: { username: "validname", password: "short" },
  });
  assert.equal(shortPassword.status, 400);
});

test("ล็อกอินผิดตอบข้อความเดียวกัน ไม่บอกว่าผิดที่ชื่อหรือรหัส", async () => {
  const user = await newUser();
  const wrongPassword = await call("POST", "/api/login", {
    body: { username: user.username, password: "wrong-password" },
  });
  const noSuchUser = await call("POST", "/api/login", {
    body: { username: "nobody_here", password: "password123" },
  });
  assert.equal(wrongPassword.status, 401);
  assert.equal(noSuchUser.status, 401);
  assert.equal(wrongPassword.json.error, noSuchUser.json.error);
});

test("ล็อกอินด้วยรหัสที่ถูกต้อง ได้ cookie แบบ HttpOnly", async () => {
  const user = await newUser();
  const res = await call("POST", "/api/login", {
    body: { username: user.username, password: "password123" },
  });
  assert.equal(res.status, 200);
  assert.ok(res.cookie.startsWith("sid="));
  assert.ok(res.headers.getSetCookie()[0].includes("HttpOnly"));
});

test("ออกจากระบบแล้วบัตรผ่านใช้ไม่ได้อีก", async () => {
  const user = await newUser();
  const out = await call("POST", "/api/logout", { cookie: user.cookie });
  assert.equal(out.status, 204);

  const me = await call("GET", "/api/me", { cookie: user.cookie });
  assert.equal(me.status, 401);
});

test("ไม่ล็อกอินเข้า API ข้อมูลไม่ได้", async () => {
  for (const path of ["/api/me", NOV, "/api/budgets", "/api/export?month=2026-11"]) {
    const res = await call("GET", path);
    assert.equal(res.status, 401, path);
  }
  const post = await call("POST", "/api/expenses", { body: sample });
  assert.equal(post.status, 401);
});

// ---------- รายการค่าใช้จ่าย ----------
test("เพิ่ม ดู แก้ไข และลบรายการ", async () => {
  const user = await newUser();
  const { cookie } = user;

  const created = await call("POST", "/api/expenses", { body: sample, cookie });
  assert.equal(created.status, 201);
  const id = created.json.id;

  let list = await call("GET", NOV, { cookie });
  assert.deepEqual(list.json, [{ id, ...sample }]);

  const updated = await call("PUT", `/api/expenses/${id}`, {
    body: { ...sample, amount: 75 },
    cookie,
  });
  assert.equal(updated.status, 200);

  list = await call("GET", NOV, { cookie });
  assert.equal(list.json[0].amount, 75);

  const removed = await call("DELETE", `/api/expenses/${id}`, { cookie });
  assert.equal(removed.status, 204);

  list = await call("GET", NOV, { cookie });
  assert.deepEqual(list.json, []);
});

test("ข้อมูลที่ไม่ถูกต้องถูกปฏิเสธและไม่ถูกบันทึก", async () => {
  const { cookie } = await newUser();
  const badBodies = [
    { ...sample, title: "   " },
    { ...sample, category: "" },
    { ...sample, amount: "50" },
    { ...sample, amount: null },
    { ...sample, date: "2026-02-31" },
    { ...sample, date: "03/11/2026" },
  ];
  for (const body of badBodies) {
    const res = await call("POST", "/api/expenses", { body, cookie });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  const list = await call("GET", NOV, { cookie });
  assert.deepEqual(list.json, []);
});

test("ดูรายการแยกตามเดือน", async () => {
  const { cookie } = await newUser();
  await call("POST", "/api/expenses", {
    body: { ...sample, date: "2026-10-31", title: "ปลายเดือนก่อน" },
    cookie,
  });
  await call("POST", "/api/expenses", {
    body: { ...sample, date: "2026-11-01", title: "ต้นเดือนนี้" },
    cookie,
  });

  const oct = await call("GET", "/api/expenses?month=2026-10", { cookie });
  assert.deepEqual(oct.json.map((r) => r.title), ["ปลายเดือนก่อน"]);

  const nov = await call("GET", NOV, { cookie });
  assert.deepEqual(nov.json.map((r) => r.title), ["ต้นเดือนนี้"]);

  const badMonth = await call("GET", "/api/expenses?month=2026-13", { cookie });
  assert.equal(badMonth.status, 400);

  const noMonth = await call("GET", "/api/expenses", { cookie });
  assert.equal(noMonth.status, 400);
});

test("แต่ละคนเห็นและแก้ได้เฉพาะรายการของตัวเอง", async () => {
  const alice = await newUser();
  const bob = await newUser();

  const created = await call("POST", "/api/expenses", {
    body: sample,
    cookie: alice.cookie,
  });
  const id = created.json.id;

  const bobList = await call("GET", NOV, { cookie: bob.cookie });
  assert.deepEqual(bobList.json, []);

  const edit = await call("PUT", `/api/expenses/${id}`, {
    body: { ...sample, title: "ของบ๊อบ" },
    cookie: bob.cookie,
  });
  assert.equal(edit.status, 404);

  const remove = await call("DELETE", `/api/expenses/${id}`, { cookie: bob.cookie });
  assert.equal(remove.status, 404);

  const aliceList = await call("GET", NOV, { cookie: alice.cookie });
  assert.equal(aliceList.json.length, 1);
  assert.equal(aliceList.json[0].title, sample.title);
});

// ---------- ส่งออก CSV ----------
test("ส่งออก CSV: ภาษาไทยอ่านได้ ตัวอักษรพิเศษถูกหนี และกันสูตรอันตราย", async () => {
  const { cookie } = await newUser();
  await call("POST", "/api/expenses", {
    body: { ...sample, title: "=1+1" },
    cookie,
  });
  await call("POST", "/api/expenses", {
    body: { ...sample, title: 'ข้าว, "พิเศษ"', amount: 12.5 },
    cookie,
  });

  const res = await call("GET", "/api/export?month=2026-11", { cookie });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/csv/);
  assert.match(res.headers.get("content-disposition"), /expenses-2026-11\.csv/);
  assert.ok(res.text.startsWith("\uFEFF"), "ต้องมี BOM ให้ Excel อ่านภาษาไทยถูก");
  assert.ok(res.text.includes(`"'=1+1"`), "ข้อความที่ขึ้นต้นด้วย = ต้องถูกนำหน้าด้วย '");
  assert.ok(!res.text.includes(`"=1+1"`));
  assert.ok(res.text.includes(`"ข้าว, ""พิเศษ"""`));
  assert.ok(res.text.includes(",12.5"));

  const badMonth = await call("GET", "/api/export?month=abc", { cookie });
  assert.equal(badMonth.status, 400);
});

// ---------- งบประมาณ ----------
test("ตั้งงบประมาณรายหมวด: บันทึก ลบด้วย 0 และไม่ปนกันระหว่างผู้ใช้", async () => {
  const user = await newUser();
  const other = await newUser();
  const toMap = (rows) => Object.fromEntries(rows.map((r) => [r.category, r.amount]));

  const set = await call("PUT", "/api/budgets", {
    body: { budgets: { อาหาร: 100, เดินทาง: 200 } },
    cookie: user.cookie,
  });
  assert.equal(set.status, 204);

  let list = await call("GET", "/api/budgets", { cookie: user.cookie });
  assert.deepEqual(toMap(list.json), { อาหาร: 100, เดินทาง: 200 });

  await call("PUT", "/api/budgets", {
    body: { budgets: { เดินทาง: 0 } },
    cookie: user.cookie,
  });
  list = await call("GET", "/api/budgets", { cookie: user.cookie });
  assert.deepEqual(toMap(list.json), { อาหาร: 100 });

  const otherList = await call("GET", "/api/budgets", { cookie: other.cookie });
  assert.deepEqual(otherList.json, []);
});

test("งบประมาณที่ไม่ถูกต้องถูกปฏิเสธ และค่าเดิมไม่เปลี่ยน", async () => {
  const { cookie } = await newUser();
  await call("PUT", "/api/budgets", {
    body: { budgets: { อาหาร: 100 } },
    cookie,
  });

  for (const budgets of [{ อาหาร: -5 }, { อาหาร: "100" }]) {
    const res = await call("PUT", "/api/budgets", { body: { budgets }, cookie });
    assert.equal(res.status, 400, JSON.stringify(budgets));
  }

  const list = await call("GET", "/api/budgets", { cookie });
  assert.deepEqual(list.json, [{ category: "อาหาร", amount: 100 }]);
});