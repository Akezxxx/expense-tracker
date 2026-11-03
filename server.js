const express = require("express");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const db = new DatabaseSync(process.env.DB_PATH || "expenses.db");

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

// ลบบัตรผ่านที่หมดอายุ: ตอนเริ่มเซิร์ฟเวอร์ และทุกชั่วโมงระหว่างที่รันอยู่
function cleanupSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
}
cleanupSessions();
setInterval(cleanupSessions, 60 * 60 * 1000).unref();

// ---------- ค่ากำหนดของแอป ----------
const CATEGORIES = ["อาหาร", "เดินทาง", "ช้อปปิ้ง", "อื่นๆ"];
const MAX_TITLE_LENGTH = 80;
const MAX_AMOUNT = 100000000;
const MAX_EXPENSES = Number(process.env.MAX_EXPENSES) || 5000;

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
app.disable("x-powered-by");

// ถ้ารันหลัง proxy ของโฮสต์ ให้ตั้ง TRUST_PROXY=1 เพื่อให้ req.ip เป็น IP ของผู้ใช้จริง
const proxyHops = Number(process.env.TRUST_PROXY);
if (Number.isInteger(proxyHops) && proxyHops > 0) {
  app.set("trust proxy", proxyHops);
}

// header ความปลอดภัย
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; ")
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (isProduction) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000");
  }
  next();
});

// ข้อมูลของผู้ใช้ห้ามถูกแคช
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use(express.json({ limit: "10kb" }));
app.use(express.static("public"));

// ให้โฮสต์ใช้ตรวจว่าแอปยังทำงานอยู่
app.get("/healthz", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    db.prepare("SELECT 1").get();
    res.type("text/plain").send("ok");
  } catch (error) {
    console.error(error);
    res.status(503).type("text/plain").send("unavailable");
  }
});

// จำกัดจำนวนคำขอต่อ IP ในช่วงเวลาหนึ่ง (เก็บในหน่วยความจำ รีสตาร์ตแล้วเริ่มนับใหม่)
function rateLimit({ windowMs, max, message }) {
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    let entry = hits.get(req.ip);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(req.ip, entry);
    }
    entry.count += 1;

    if (entry.count > max) {
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.LOGIN_MAX) || 10,
  message: "ลองเข้าสู่ระบบบ่อยเกินไป รอสักครู่แล้วลองใหม่",
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.REGISTER_MAX) || 10,
  message: "สมัครสมาชิกบ่อยเกินไป รอสักครู่แล้วลองใหม่",
});

const accountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.ACCOUNT_MAX) || 10,
  message: "ลองบ่อยเกินไป รอสักครู่แล้วลองใหม่",
});

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

app.post("/api/register", registerLimiter, (req, res) => {
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

app.post("/api/login", loginLimiter, (req, res) => {
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

// เปลี่ยนรหัสผ่าน: บัตรผ่านเก่าทุกใบใช้ไม่ได้ แล้วออกบัตรใหม่ให้เครื่องนี้
app.post("/api/change-password", requireLogin, accountLimiter, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    return res.status(400).json({ error: "กรอกรหัสผ่านปัจจุบันและรหัสผ่านใหม่" });
  }
  if (newPassword.length < 8 || newPassword.length > 100) {
    return res.status(400).json({ error: "รหัสผ่านใหม่ต้องยาว 8-100 ตัวอักษร" });
  }

  const row = db
    .prepare("SELECT password_hash FROM users WHERE id = ?")
    .get(req.user.id);
  if (!row || !verifyPassword(currentPassword, row.password_hash)) {
    return res.status(400).json({ error: "รหัสผ่านปัจจุบันไม่ถูกต้อง" });
  }

  db.exec("BEGIN");
  try {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
      hashPassword(newPassword),
      req.user.id
    );
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(req.user.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    console.error(error);
    return res.status(500).json({ error: "เซิร์ฟเวอร์ขัดข้อง ลองอีกครั้ง" });
  }

  createSession(res, req.user.id);
  res.status(204).end();
});

// ลบบัญชีและข้อมูลทั้งหมดของผู้ใช้ (ต้องยืนยันด้วยรหัสผ่าน)
app.delete("/api/account", requireLogin, accountLimiter, (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== "string") {
    return res.status(400).json({ error: "กรอกรหัสผ่านเพื่อยืนยัน" });
  }

  const row = db
    .prepare("SELECT password_hash FROM users WHERE id = ?")
    .get(req.user.id);
  if (!row || !verifyPassword(password, row.password_hash)) {
    return res.status(400).json({ error: "รหัสผ่านไม่ถูกต้อง" });
  }

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM expenses WHERE user_id = ?").run(req.user.id);
    db.prepare("DELETE FROM budgets WHERE user_id = ?").run(req.user.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(req.user.id);
    db.prepare("DELETE FROM users WHERE id = ?").run(req.user.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    console.error(error);
    return res.status(500).json({ error: "เซิร์ฟเวอร์ขัดข้อง ลองอีกครั้ง" });
  }

  res.setHeader("Set-Cookie", cookieString("", 0));
  res.status(204).end();
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

// ตรวจและทำความสะอาดข้อมูลรายการ ก่อนเข้า route เพิ่ม/แก้ไข
function cleanExpense(req, res, next) {
  const body = req.body || {};
  const reject = (message) => res.status(400).json({ error: message });

  if (typeof body.title !== "string") return reject("ข้อมูลไม่ถูกต้อง");
  const title = body.title.trim();
  if (title === "" || title.length > MAX_TITLE_LENGTH) {
    return reject(`ชื่อรายการต้องยาว 1-${MAX_TITLE_LENGTH} ตัวอักษร`);
  }

  if (!CATEGORIES.includes(body.category)) return reject("หมวดหมู่ไม่ถูกต้อง");

  if (
    typeof body.amount !== "number" ||
    !Number.isFinite(body.amount) ||
    body.amount <= 0 ||
    body.amount > MAX_AMOUNT
  ) {
    return reject("จำนวนเงินต้องมากกว่า 0 และไม่เกิน 100,000,000");
  }
  const amount = Math.round(body.amount * 100) / 100; // เก็บทศนิยมไม่เกิน 2 ตำแหน่ง
  if (amount <= 0) return reject("จำนวนเงินน้อยเกินไป");

  if (!isValidDate(body.date)) return reject("วันที่ไม่ถูกต้อง");
  const year = Number(body.date.slice(0, 4));
  if (year < 2000 || year > 2100) return reject("วันที่ต้องอยู่ระหว่างปี 2000-2100");

  req.body = { title, category: body.category, amount, date: body.date };
  next();
}

// จำกัดจำนวนรายการต่อผู้ใช้
function expenseLimit(req, res, next) {
  const { n } = db
    .prepare("SELECT COUNT(*) AS n FROM expenses WHERE user_id = ?")
    .get(req.user.id);
  if (n >= MAX_EXPENSES) {
    return res
      .status(409)
      .json({ error: `เก็บรายการได้สูงสุด ${MAX_EXPENSES} รายการ` });
  }
  next();
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

app.post("/api/expenses", requireLogin, cleanExpense, expenseLimit, (req, res) => {
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

app.put("/api/expenses/:id", requireLogin, cleanExpense, (req, res) => {
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

// ---------- งบประมาณรายหมวด (ต่อเดือน) ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS budgets (
    user_id INTEGER NOT NULL REFERENCES users(id),
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    PRIMARY KEY (user_id, category)
  )
`);

const BUDGET_CATEGORIES = CATEGORIES;

app.get("/api/budgets", requireLogin, (req, res) => {
  const rows = db
    .prepare("SELECT category, amount FROM budgets WHERE user_id = ?")
    .all(req.user.id);
  res.json(rows);
});

app.put("/api/budgets", requireLogin, (req, res) => {
  const incoming = req.body && req.body.budgets;
  if (!incoming || typeof incoming !== "object") {
    return res.status(400).json({ error: "ข้อมูลไม่ถูกต้อง" });
  }

  // ตรวจทุกค่าก่อนบันทึก
  for (const category of BUDGET_CATEGORIES) {
    if (!Object.hasOwn(incoming, category)) continue;
    const value = incoming[category];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 100000000
    ) {
      return res.status(400).json({ error: "งบประมาณต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป" });
    }
  }

  db.exec("BEGIN");
  try {
    for (const category of BUDGET_CATEGORIES) {
      if (!Object.hasOwn(incoming, category)) continue;
      const value = incoming[category];
      if (value === 0) {
        // 0 แปลว่าไม่จำกัดงบ ลบทิ้ง
        db.prepare("DELETE FROM budgets WHERE user_id = ? AND category = ?").run(
          req.user.id,
          category
        );
      } else {
        db.prepare(
          `INSERT INTO budgets (user_id, category, amount) VALUES (?, ?, ?)
           ON CONFLICT(user_id, category) DO UPDATE SET amount = excluded.amount`
        ).run(req.user.id, category, value);
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    console.error(error);
    return res.status(500).json({ error: "เซิร์ฟเวอร์ขัดข้อง ลองอีกครั้ง" });
  }
  res.status(204).end();
});
// ---------- ส่งออกเป็น CSV ----------
function csvText(value) {
  let text = String(value ?? "");
  // กัน CSV injection: ข้อความที่ขึ้นต้นด้วยตัวที่ Excel/Sheets ตีเป็นสูตร ให้นำหน้าด้วย '
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

app.get("/api/export", requireLogin, (req, res) => {
  const month = String(req.query.month);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return res.status(400).json({ error: "เดือนไม่ถูกต้อง" });
  }

  const rows = db
    .prepare(
      `SELECT title, category, amount, spent_on AS date
       FROM expenses
       WHERE user_id = ? AND substr(spent_on, 1, 7) = ?
       ORDER BY spent_on, id`
    )
    .all(req.user.id, month);

  const lines = [
    ["วันที่", "รายการ", "หมวดหมู่", "จำนวนเงิน (บาท)"].map(csvText).join(","),
  ];
  rows.forEach((row) => {
    lines.push(
      [csvText(row.date), csvText(row.title), csvText(row.category), String(row.amount)].join(",")
    );
  });

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="expenses-${month}.csv"`);
  // \uFEFF คือ BOM ทำให้ Excel อ่านภาษาไทยถูก
  res.send("\uFEFF" + lines.join("\r\n") + "\r\n");
});

// ตัวจัดการข้อผิดพลาดสุดท้าย: ไม่โชว์รายละเอียดภายในระบบให้ผู้ใช้เห็น
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "รูปแบบข้อมูลไม่ถูกต้อง" });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "ข้อมูลใหญ่เกินไป" });
  }
  console.error(err);
  res.status(500).json({ error: "เซิร์ฟเวอร์ขัดข้อง ลองอีกครั้ง" });
});

module.exports = { app, db, cleanupSessions };

// เปิดเซิร์ฟเวอร์เฉพาะตอนสั่ง node server.js ตรงๆ (ตอนเทสต์จะไม่เปิด)
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`เซิร์ฟเวอร์ทำงานที่ http://localhost:${PORT}`);
  });
}