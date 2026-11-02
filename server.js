const express = require("express");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const db = new DatabaseSync("expenses.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL
  );
`);

// กันกรณีใช้ไฟล์ฐานข้อมูลเก่าที่ยังไม่มี user_id
const expenseColumns = db.prepare("PRAGMA table_info(expenses)").all();
if (!expenseColumns.some((column) => column.name === "user_id")) {
  console.error("พบฐานข้อมูลแบบเก่า ให้เปลี่ยนชื่อไฟล์ expenses.db แล้วรันใหม่");
  process.exit(1);
}
function pad(n) {
  return String(n).padStart(2, "0");
}

function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// เพิ่มคอลัมน์วันที่ให้ฐานข้อมูลเดิม (รายการเก่าได้วันนี้เป็นค่าเริ่มต้น)
if (!expenseColumns.some((column) => column.name === "spent_on")) {
  db.exec("ALTER TABLE expenses ADD COLUMN spent_on TEXT");
  db.prepare("UPDATE expenses SET spent_on = ? WHERE spent_on IS NULL").run(
    todayString()
  );
}

// ลบบัตรผ่านที่หมดอายุทิ้งตอนเริ่มเซิร์ฟเวอร์
db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());

// ---------- รหัสผ่าน ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return salt.toString("hex") + ":" + hash.toString("hex");
}

function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(":");
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  return crypto.timingSafeEqual(expected, actual);
}

// ใช้เทียบหลอกเมื่อไม่พบชื่อผู้ใช้ เพื่อให้เวลาตอบใกล้เคียงกัน
const DUMMY_HASH = hashPassword("dummy-password");

// ---------- บัตรผ่าน (session) ----------
const SESSION_COOKIE = "sid";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const isProduction = process.env.NODE_ENV === "production";

function parseCookies(header = "") {
  const cookies = {};
  header.split(";").forEach((part) => {
    const index = part.indexOf("=");
    if (index === -1) return;
    cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  });
  return cookies;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function cookieString(value, maxAge) {
  const parts = [
    `${SESSION_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (isProduction) parts.push("Secure");
  return parts.join("; ");
}

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_SECONDS * 1000;
  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)"
  ).run(hashToken(token), userId, expiresAt);
  res.setHeader("Set-Cookie", cookieString(token, SESSION_SECONDS));
}

function getUserFromRequest(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;

  const tokenHash = hashToken(token);
  const row = db
    .prepare(
      `SELECT users.id, users.username, sessions.expires_at
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ?`
    )
    .get(tokenHash);

  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    return null;
  }
  return { id: row.id, username: row.username };
}

// ด่านตรวจ: ต้องล็อกอินก่อนถึงจะเข้า route ที่ใช้ด่านนี้ได้
function requireLogin(req, res, next) {
  const user = getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  }
  req.user = user;
  next();
}

// ---------- แอป ----------
const app = express();
app.use(express.json());
app.use(express.static("public"));

const CREDENTIAL_ERROR =
  "ชื่อผู้ใช้ 3-20 ตัว ใช้ a-z, 0-9 และ _ ส่วนรหัสผ่านอย่างน้อย 8 ตัว";

function validCredentials(body) {
  return (
    body &&
    typeof body.username === "string" &&
    typeof body.password === "string" &&
    /^[A-Za-z0-9_]{3,20}$/.test(body.username) &&
    body.password.length >= 8 &&
    body.password.length <= 100
  );
}

app.post("/api/register", (req, res) => {
  if (!validCredentials(req.body)) {
    return res.status(400).json({ error: CREDENTIAL_ERROR });
  }
  const username = req.body.username.toLowerCase();
  try {
    const result = db
      .prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
      .run(username, hashPassword(req.body.password));
    createSession(res, Number(result.lastInsertRowid));
    res.status(201).json({ username });
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) {
      return res.status(409).json({ error: "ชื่อผู้ใช้นี้ถูกใช้แล้ว" });
    }
    console.error(error);
    res.status(500).json({ error: "เซิร์ฟเวอร์ขัดข้อง ลองอีกครั้ง" });
  }
});

app.post("/api/login", (req, res) => {
  const body = req.body || {};
  if (typeof body.username !== "string" || typeof body.password !== "string") {
    return res.status(400).json({ error: "กรอกชื่อผู้ใช้และรหัสผ่าน" });
  }
  const user = db
    .prepare("SELECT id, username, password_hash FROM users WHERE username = ?")
    .get(body.username.toLowerCase());

  const passwordOk = verifyPassword(
    body.password,
    user ? user.password_hash : DUMMY_HASH
  );

  if (!user || !passwordOk) {
    return res.status(401).json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
  }
  createSession(res, user.id);
  res.json({ username: user.username });
});

app.post("/api/logout", (req, res) => {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  }
  res.setHeader("Set-Cookie", cookieString("", 0));
  res.status(204).end();
});

app.get("/api/me", requireLogin, (req, res) => {
  res.json({ username: req.user.username });
});

// ---------- รายการค่าใช้จ่าย (เห็นเฉพาะของตัวเอง) ----------
function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return (
    date.getFullYear() === y &&
    date.getMonth() === m - 1 &&
    date.getDate() === d
  );
}

function isValid(body) {
  return (
    body &&
    typeof body.title === "string" && body.title.trim() !== "" &&
    typeof body.category === "string" && body.category.trim() !== "" &&
    typeof body.amount === "number" && Number.isFinite(body.amount) &&
    isValidDate(body.date)
  );
}

app.get("/api/expenses", requireLogin, (req, res) => {
  const month = req.query.month;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month))) {
    return res.status(400).json({ error: "เดือนไม่ถูกต้อง" });
  }
  const rows = db
    .prepare(
      `SELECT id, title, category, amount, spent_on AS date
       FROM expenses
       WHERE user_id = ? AND substr(spent_on, 1, 7) = ?
       ORDER BY spent_on, id`
    )
    .all(req.user.id, month);
  res.json(rows);
});

app.post("/api/expenses", requireLogin, (req, res) => {
  if (!isValid(req.body)) {
    return res.status(400).json({ error: "ข้อมูลไม่ถูกต้อง" });
  }
  const { title, category, amount, date } = req.body;
  const result = db
    .prepare(
      "INSERT INTO expenses (user_id, title, category, amount, spent_on) VALUES (?, ?, ?, ?, ?)"
    )
    .run(req.user.id, title, category, amount, date);
  res
    .status(201)
    .json({ id: Number(result.lastInsertRowid), title, category, amount, date });
});

app.put("/api/expenses/:id", requireLogin, (req, res) => {
  if (!isValid(req.body)) {
    return res.status(400).json({ error: "ข้อมูลไม่ถูกต้อง" });
  }
  const { title, category, amount, date } = req.body;
  const result = db
    .prepare(
      "UPDATE expenses SET title = ?, category = ?, amount = ?, spent_on = ? WHERE id = ? AND user_id = ?"
    )
    .run(title, category, amount, date, req.params.id, req.user.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: "ไม่พบรายการ" });
  }
  res.json({ id: Number(req.params.id), title, category, amount, date });
});

app.delete("/api/expenses/:id", requireLogin, (req, res) => {
  const result = db
    .prepare("DELETE FROM expenses WHERE id = ? AND user_id = ?")
    .run(req.params.id, req.user.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: "ไม่พบรายการ" });
  }
  res.status(204).end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`เซิร์ฟเวอร์ทำงานที่ http://localhost:${PORT}`);
});