// เก็บรายการทั้งหมดไว้ใน array
const expenses = [];

// ดึง element จากหน้าเว็บมาเก็บในตัวแปร (ใช้ id ที่ตั้งไว้ใน HTML)
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
      expenses.splice(index, 1); // ลบรายการที่ตำแหน่งนี้ออกจาก array
      render();
    });
    actionCell.appendChild(deleteButton);

    row.append(titleCell, categoryCell, amountCell, actionCell);
    listBody.appendChild(row);

    total += item.amount;
  });

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