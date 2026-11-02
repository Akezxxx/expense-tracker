const express = require("express");
const { DatabaseSync } = require("node:sqlite");

// เปิด (หรือสร้างใหม่ถ้ายังไม่มี) ไฟล์ฐานข้อมูล
const db = new DatabaseSync("expenses.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL
  )
`);

const app = express();
app.use(express.json());      // ให้อ่านข้อมูล JSON ที่ส่งมาได้
app.use(express.static("public")); // ส่งไฟล์หน้าเว็บในโฟลเดอร์ public

// ตรวจว่าข้อมูลที่ส่งมาถูกต้องไหม
function isValid(body) {
  return (
    body &&
    typeof body.title === "string" && body.title.trim() !== "" &&
    typeof body.category === "string" && body.category.trim() !== "" &&
    typeof body.amount === "number" && Number.isFinite(body.amount)
  );
}

// ดูรายการทั้งหมด
app.get("/api/expenses", (req, res) => {
  const rows = db.prepare("SELECT * FROM expenses ORDER BY id").all();
  res.json(rows);
});

// เพิ่มรายการ
app.post("/api/expenses", (req, res) => {
  if (!isValid(req.body)) {
    return res.status(400).json({ error: "ข้อมูลไม่ถูกต้อง" });
  }
  const { title, category, amount } = req.body;
  const result = db
    .prepare("INSERT INTO expenses (title, category, amount) VALUES (?, ?, ?)")
    .run(title, category, amount);
  res.status(201).json({ id: Number(result.lastInsertRowid), title, category, amount });
});

// แก้ไขรายการ
app.put("/api/expenses/:id", (req, res) => {
  if (!isValid(req.body)) {
    return res.status(400).json({ error: "ข้อมูลไม่ถูกต้อง" });
  }
  const { title, category, amount } = req.body;
  const result = db
    .prepare("UPDATE expenses SET title = ?, category = ?, amount = ? WHERE id = ?")
    .run(title, category, amount, req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: "ไม่พบรายการ" });
  }
  res.json({ id: Number(req.params.id), title, category, amount });
});

// ลบรายการ
app.delete("/api/expenses/:id", (req, res) => {
  const result = db.prepare("DELETE FROM expenses WHERE id = ?").run(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: "ไม่พบรายการ" });
  }
  res.status(204).end();
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`เซิร์ฟเวอร์ทำงานที่ http://localhost:${PORT}`);
});