// เก็บรายการทั้งหมดไว้ใน array
const expenses = [];

// ดึง element จากหน้าเว็บมาเก็บในตัวแปร (ใช้ id ที่ตั้งไว้ใน HTML)
const form = document.getElementById("expense-form");
const titleInput = document.getElementById("title");
const amountInput = document.getElementById("amount");
const categorySelect = document.getElementById("category");
const listBody = document.getElementById("expense-list");
const totalSpan = document.getElementById("total");

// วาดตารางและยอดรวมใหม่จากข้อมูลใน array
function render() {
  listBody.innerHTML = "";
  let total = 0;

  for (const item of expenses) {
    const row = document.createElement("tr");

    const titleCell = document.createElement("td");
    titleCell.textContent = item.title;

    const categoryCell = document.createElement("td");
    categoryCell.textContent = item.category;

    const amountCell = document.createElement("td");
    amountCell.textContent = item.amount.toLocaleString("th-TH");

    row.append(titleCell, categoryCell, amountCell);
    listBody.appendChild(row);

    total += item.amount;
  }

  totalSpan.textContent = total.toLocaleString("th-TH");
}

// ทำงานเมื่อกดปุ่ม "เพิ่ม"
form.addEventListener("submit", function (event) {
  event.preventDefault(); // กันไม่ให้หน้าเว็บรีโหลด

  expenses.push({
    title: titleInput.value,
    category: categorySelect.value,
    amount: Number(amountInput.value),
  });

  render();
  form.reset(); // ล้างช่องกรอก
});