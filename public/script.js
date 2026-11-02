const API_URL = "/api/expenses";

const form = document.getElementById("expense-form");
const titleInput = document.getElementById("title");
const amountInput = document.getElementById("amount");
const categorySelect = document.getElementById("category");
const listBody = document.getElementById("expense-list");
const totalSpan = document.getElementById("total");
const submitButton = form.querySelector('button[type="submit"]');

// รายการที่โหลดมาจากเซิร์ฟเวอร์ (แต่ละรายการมี id จากฐานข้อมูล)
let expenses = [];

// id ของรายการที่กำลังแก้ไข (null = ไม่ได้แก้ไขอะไรอยู่)
let editingId = null;

function showError(message, error) {
  console.error(message, error);
  alert(message);
}

// ขอรายการทั้งหมดจากเซิร์ฟเวอร์ แล้ววาดตาราง
async function loadExpenses() {
  try {
    const response = await fetch(API_URL);
    if (!response.ok) throw new Error("สถานะ " + response.status);
    expenses = await response.json();
    render();
  } catch (error) {
    showError("โหลดข้อมูลไม่สำเร็จ ตรวจสอบว่ารัน node server.js อยู่", error);
  }
}

function startEdit(id) {
  const item = expenses.find(function (e) {
    return e.id === id;
  });
  if (!item) return;
  titleInput.value = item.title;
  amountInput.value = item.amount;
  categorySelect.value = item.category;
  editingId = id;
  submitButton.textContent = "บันทึก";
  titleInput.focus();
}

function resetEditing() {
  editingId = null;
  submitButton.textContent = "เพิ่ม";
  form.reset();
}

async function deleteExpense(id) {
  try {
    const response = await fetch(API_URL + "/" + id, { method: "DELETE" });
    if (!response.ok) throw new Error("สถานะ " + response.status);
    if (editingId === id) resetEditing();
    await loadExpenses();
  } catch (error) {
    showError("ลบรายการไม่สำเร็จ", error);
  }
}

function render() {
  listBody.innerHTML = "";
  let total = 0;

  expenses.forEach(function (item) {
    const row = document.createElement("tr");

    const titleCell = document.createElement("td");
    titleCell.textContent = item.title;

    const categoryCell = document.createElement("td");
    categoryCell.textContent = item.category;

    const amountCell = document.createElement("td");
    amountCell.textContent = item.amount.toLocaleString("th-TH");

    const actionCell = document.createElement("td");

    const editButton = document.createElement("button");
    editButton.textContent = "แก้ไข";
    editButton.className = "edit";
    editButton.addEventListener("click", function () {
      startEdit(item.id);
    });

    const deleteButton = document.createElement("button");
    deleteButton.textContent = "ลบ";
    deleteButton.addEventListener("click", function () {
      deleteExpense(item.id);
    });

    actionCell.append(editButton, deleteButton);

    row.append(titleCell, categoryCell, amountCell, actionCell);
    listBody.appendChild(row);

    total += item.amount;
  });

  totalSpan.textContent = total.toLocaleString("th-TH");
}

form.addEventListener("submit", async function (event) {
  event.preventDefault();

  const data = {
    title: titleInput.value,
    category: categorySelect.value,
    amount: Number(amountInput.value),
  };

  const isEditing = editingId !== null;
  const url = isEditing ? API_URL + "/" + editingId : API_URL;
  const method = isEditing ? "PUT" : "POST";

  try {
    const response = await fetch(url, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error("สถานะ " + response.status);
    resetEditing();
    await loadExpenses();
  } catch (error) {
    showError("บันทึกรายการไม่สำเร็จ", error);
  }
});

// โหลดรายการตอนเปิดหน้าเว็บ
loadExpenses();