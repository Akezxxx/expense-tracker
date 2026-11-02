const STORAGE_KEY = "expenses";

// อ่านรายการที่เคยบันทึกไว้ในเบราว์เซอร์ ถ้าไม่มีให้เริ่มจากว่าง
function loadExpenses() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch (error) {
    return [];
  }
}

// บันทึกรายการทั้งหมดลงเบราว์เซอร์
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
    const deleteButton = document.createElement("button");
    deleteButton.textContent = "ลบ";
    deleteButton.addEventListener("click", function () {
      expenses.splice(index, 1);
      saveExpenses();
      render();
    });
    actionCell.appendChild(deleteButton);

    row.append(titleCell, categoryCell, amountCell, actionCell);
    listBody.appendChild(row);

    total += item.amount;
  });

  totalSpan.textContent = total.toLocaleString("th-TH");
}

form.addEventListener("submit", function (event) {
  event.preventDefault();

  expenses.push({
    title: titleInput.value,
    category: categorySelect.value,
    amount: Number(amountInput.value),
  });

  saveExpenses();
  render();
  form.reset();
});

// วาดตารางครั้งแรกตอนเปิดหน้า (แสดงรายการที่เคยบันทึกไว้)
render();