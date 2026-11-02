const STORAGE_KEY = "expenses";

function loadExpenses() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch (error) {
    return [];
  }
}

function saveExpenses() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(expenses));
  } catch (error) {
    console.error("บันทึกข้อมูลไม่สำเร็จ", error);
  }
}

const expenses = loadExpenses();

const form = document.getElementById("expense-form");
const titleInput = document.getElementById("title");
const amountInput = document.getElementById("amount");
const categorySelect = document.getElementById("category");
const listBody = document.getElementById("expense-list");
const totalSpan = document.getElementById("total");
const submitButton = form.querySelector('button[type="submit"]');

// เก็บลำดับของรายการที่กำลังแก้ไข (null = ไม่ได้แก้ไขอะไรอยู่)
let editingIndex = null;

// เอาค่าของรายการนั้นใส่กลับในฟอร์ม แล้วเปลี่ยนปุ่มเป็น "บันทึก"
function startEdit(index) {
  const item = expenses[index];
  titleInput.value = item.title;
  amountInput.value = item.amount;
  categorySelect.value = item.category;
  editingIndex = index;
  submitButton.textContent = "บันทึก";
  titleInput.focus();
}

// กลับไปโหมดเพิ่มรายการปกติ
function resetEditing() {
  editingIndex = null;
  submitButton.textContent = "เพิ่ม";
  form.reset();
}

function render() {
  listBody.innerHTML = "";
  let total = 0;

  expenses.forEach(function (item, index) {
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
      startEdit(index);
    });

    const deleteButton = document.createElement("button");
    deleteButton.textContent = "ลบ";
    deleteButton.addEventListener("click", function () {
      expenses.splice(index, 1);
      saveExpenses();
      resetEditing(); // กันลำดับเลื่อนระหว่างที่กำลังแก้ไขอยู่
      render();
    });

    actionCell.append(editButton, deleteButton);

    row.append(titleCell, categoryCell, amountCell, actionCell);
    listBody.appendChild(row);

    total += item.amount;
  });

  totalSpan.textContent = total.toLocaleString("th-TH");
}

form.addEventListener("submit", function (event) {
  event.preventDefault();

  const data = {
    title: titleInput.value,
    category: categorySelect.value,
    amount: Number(amountInput.value),
  };

  if (editingIndex === null) {
    expenses.push(data); // โหมดเพิ่ม
  } else {
    expenses[editingIndex] = data; // โหมดแก้ไข: ทับรายการเดิม
  }

  saveExpenses();
  render();
  resetEditing();
});

render();