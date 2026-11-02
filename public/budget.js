(function () {
  const CATEGORIES = ["อาหาร", "เดินทาง", "ช้อปปิ้ง", "อื่นๆ"];

  const authView = document.getElementById("auth-view");
  const sectionEl = document.getElementById("budget");
  const listEl = document.getElementById("budget-list");
  const formEl = document.getElementById("budget-form");
  const inputs = Array.from(formEl.querySelectorAll("input[data-cat]"));

  let lastExpenses = [];
  let budgets = {};
  let loaded = false;
  let requestId = 0;

  function money(value) {
    return value.toLocaleString("th-TH", { maximumFractionDigits: 2 });
  }

  function notify(message, isError) {
    if (typeof showToast === "function") showToast(message, isError);
  }

  function spentByCategory(expenses) {
    const spent = {};
    expenses.forEach(function (item) {
      spent[item.category] = (spent[item.category] || 0) + item.amount;
    });
    return spent;
  }

  // วาดแถบงบของหมวดที่ตั้งงบไว้
  function renderList() {
    listEl.innerHTML = "";
    const spent = spentByCategory(lastExpenses);

    CATEGORIES.forEach(function (category) {
      const limit = budgets[category];
      if (!limit) return;

      const used = spent[category] || 0;
      const ratio = used / limit;
      const state = ratio >= 1 ? "over" : ratio >= 0.8 ? "warn" : "ok";

      const li = document.createElement("li");
      li.className = "budget-item is-" + state;
      li.dataset.cat = category;

      const head = document.createElement("div");
      head.className = "budget-head";
      const name = document.createElement("span");
      name.textContent = category;
      const figures = document.createElement("span");
      figures.textContent = "฿" + money(used) + " / ฿" + money(limit);
      head.append(name, figures);

      const bar = document.createElement("div");
      bar.className = "budget-bar";
      bar.setAttribute("aria-hidden", "true");
      const fill = document.createElement("span");
      fill.style.width = Math.min(ratio, 1) * 100 + "%";
      bar.appendChild(fill);

      const note = document.createElement("p");
      note.className = "budget-note";
      if (state === "over") {
        note.textContent = "เกินงบ ฿" + money(used - limit);
      } else if (state === "warn") {
        note.textContent = "ใกล้เต็มงบ เหลือ ฿" + money(limit - used);
      } else {
        note.textContent = "เหลือ ฿" + money(limit - used);
      }

      li.append(head, bar, note);
      listEl.appendChild(li);
    });
  }

  // ดึงงบจากเซิร์ฟเวอร์ แล้วเติมค่าลงช่องกรอก
  async function refresh() {
    const myId = ++requestId;
    try {
      const response = await window.fetch("/api/budgets");
      if (!response.ok) throw new Error("สถานะ " + response.status);
      const rows = await response.json();
      if (myId !== requestId) return;

      budgets = {};
      rows.forEach(function (row) {
        budgets[row.category] = row.amount;
      });
      loaded = true;

      inputs.forEach(function (input) {
        const value = budgets[input.dataset.cat];
        input.value = value ? value : "";
      });
      sectionEl.hidden = false;
      renderList();
    } catch (error) {
      console.error("โหลดงบประมาณไม่สำเร็จ", error);
    }
  }

  // script.js เรียกฟังก์ชันนี้ทุกครั้งที่โหลดรายการเสร็จ
  window.onExpensesLoaded = function (expenses) {
    lastExpenses = expenses;
    if (loaded) renderList();
    else refresh();
  };

  formEl.addEventListener("submit", async function (event) {
    event.preventDefault();

    const body = {};
    inputs.forEach(function (input) {
      body[input.dataset.cat] = input.value === "" ? 0 : Number(input.value);
    });

    try {
      const response = await window.fetch("/api/budgets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budgets: body }),
      });
      if (!response.ok) throw new Error("สถานะ " + response.status);
      await refresh();
      notify("บันทึกงบประมาณแล้ว", false);
    } catch (error) {
      console.error(error);
      notify("บันทึกงบประมาณไม่สำเร็จ ตรวจตัวเลขแล้วลองอีกครั้ง", true);
    }
  });

  // เมื่อกลับไปหน้าล็อกอิน (ออกจากระบบ/หมดอายุ) ล้างข้อมูลงบของผู้ใช้เดิมทิ้ง
  new MutationObserver(function () {
    if (!authView.hidden) {
      budgets = {};
      loaded = false;
      requestId++;
      listEl.innerHTML = "";
      sectionEl.hidden = true;
      inputs.forEach(function (input) {
        input.value = "";
      });
    }
  }).observe(authView, { attributes: true, attributeFilter: ["hidden"] });
})();