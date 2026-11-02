const API_URL = "/api/expenses";

const form = document.getElementById("expense-form");
const formTitle = document.getElementById("form-title");
const titleInput = document.getElementById("title");
const amountInput = document.getElementById("amount");
const submitButton = document.getElementById("submit-button");
const cancelButton = document.getElementById("cancel-button");
const listEl = document.getElementById("expense-list");
const totalEl = document.getElementById("total");
const countEl = document.getElementById("count");
const emptyEl = document.getElementById("empty");
const breakdownEl = document.getElementById("breakdown");
const shareEl = document.getElementById("share");
const legendEl = document.getElementById("legend");
const toastEl = document.getElementById("toast");
const dateInput = document.getElementById("date");
const monthInput = document.getElementById("month");

function pad(n) {
  return String(n).padStart(2, "0");
}

function todayString() {
  const d = new Date();
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function formatDate(value) {
  if (!value) return "";
  const parts = value.split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
  });
}

dateInput.value = todayString();
monthInput.value = todayString().slice(0, 7);

let expenses = [];
let editingId = null;   // id ของรายการที่กำลังแก้ไข (null = ไม่ได้แก้)
let highlightId = null; // id ของรายการที่เพิ่งเพิ่ม/แก้ (ไว้ทำแอนิเมชัน)
let toastTimer = null;

function formatBaht(value) {
  return value.toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

function showToast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.classList.toggle("is-error", isError);
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    toastEl.classList.remove("show");
  }, isError ? 4000 : 2000);
}

function showError(message, error) {
  if (error && error.message === "unauthorized") return; // กลับไปหน้าล็อกอินอยู่แล้ว
  console.error(message, error);
  showToast(message, true);
}

async function loadExpenses() {
  try {
    if (!monthInput.value) monthInput.value = todayString().slice(0, 7);
    const response = await apiFetch(
      API_URL + "?month=" + encodeURIComponent(monthInput.value)
    );
    if (!response.ok) throw new Error("สถานะ " + response.status);
    expenses = await response.json();
    render();
    if (window.onExpensesLoaded) window.onExpensesLoaded(expenses);
  } catch (error) {
    showError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจว่ารัน node server.js อยู่", error);
  }
}

function startEdit(id) {
  const item = expenses.find(function (e) { return e.id === id; });
  if (!item) return;

  titleInput.value = item.title;
  amountInput.value = item.amount;
  dateInput.value = item.date;
  form.elements.category.value = item.category;

  editingId = id;
  formTitle.textContent = "แก้ไขรายการ";
  submitButton.textContent = "บันทึกการแก้ไข";
  cancelButton.hidden = false;

  render();
  form.scrollIntoView({ block: "center" });
  titleInput.focus();
}

function resetEditing() {
  editingId = null;
  formTitle.textContent = "จดรายการใหม่";
  submitButton.textContent = "เพิ่มรายการ";
  cancelButton.hidden = true;
  form.reset();
  dateInput.value = todayString();
}

async function deleteExpense(id) {
  try {
    const response = await apiFetch(API_URL + "/" + id, { method: "DELETE" });
    if (!response.ok) throw new Error("สถานะ " + response.status);
    if (editingId === id) resetEditing();
    await loadExpenses();
    showToast("ลบรายการแล้ว");
  } catch (error) {
    showError("ลบรายการไม่สำเร็จ ลองอีกครั้ง", error);
  }
}

function buildItem(item) {
  const li = document.createElement("li");
  li.className = "item";
  li.dataset.cat = item.category;
  if (item.id === highlightId) li.classList.add("is-new");
  if (item.id === editingId) li.classList.add("is-editing");

  const dot = document.createElement("span");
  dot.className = "dot";
  dot.setAttribute("aria-hidden", "true");

  const main = document.createElement("div");
  main.className = "main";
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = item.title;
  const meta = document.createElement("div");
  meta.className = "meta";
  const cat = document.createElement("span");
  cat.className = "cat";
  cat.textContent = item.category;
  const when = document.createElement("span");
  when.textContent = formatDate(item.date);
  meta.append(cat, when);
  main.append(name, meta);

  const side = document.createElement("div");
  side.className = "side";
  const price = document.createElement("span");
  price.className = "price";
  price.textContent = "฿" + formatBaht(item.amount);

  const actions = document.createElement("div");
  actions.className = "actions";

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "link-btn";
  editButton.textContent = "แก้ไข";
  editButton.setAttribute("aria-label", "แก้ไข " + item.title);
  editButton.addEventListener("click", function () { startEdit(item.id); });

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "link-btn danger";
  deleteButton.textContent = "ลบ";
  deleteButton.setAttribute("aria-label", "ลบ " + item.title);
  deleteButton.addEventListener("click", function () { deleteExpense(item.id); });

  actions.append(editButton, deleteButton);
  side.append(price, actions);
  li.append(dot, main, side);
  return li;
}

// แถบสัดส่วนรายจ่ายตามหมวด
function renderBreakdown(byCategory, total) {
  shareEl.innerHTML = "";
  legendEl.innerHTML = "";
  breakdownEl.hidden = total <= 0;
  if (total <= 0) return;

  const entries = [...byCategory.entries()]
    .filter(function (entry) { return entry[1] > 0; })
    .sort(function (a, b) { return b[1] - a[1]; });

  entries.forEach(function (entry) {
    const category = entry[0];
    const value = entry[1];

    const segment = document.createElement("span");
    segment.className = "seg";
    segment.dataset.cat = category;
    segment.style.flex = value + " 1 0";
    shareEl.appendChild(segment);

    const legendItem = document.createElement("li");
    legendItem.dataset.cat = category;
    legendItem.textContent = category + " " + Math.round((value / total) * 100) + "%";
    legendEl.appendChild(legendItem);
  });
}

function render() {
  listEl.innerHTML = "";
  let total = 0;
  const byCategory = new Map();

  expenses.forEach(function (item) {
    total += item.amount;
    byCategory.set(item.category, (byCategory.get(item.category) || 0) + item.amount);
    listEl.appendChild(buildItem(item));
  });

  totalEl.textContent = formatBaht(total);
  countEl.textContent = expenses.length === 0 ? "ยังไม่มีรายการ" : expenses.length + " รายการ";
  emptyEl.hidden = expenses.length > 0;
  renderBreakdown(byCategory, total);
  highlightId = null;
}

form.addEventListener("submit", async function (event) {
  event.preventDefault();

  const data = {
    title: titleInput.value.trim(),
    category: form.elements.category.value,
    amount: Number(amountInput.value),
    date: dateInput.value,
  };

  const isEditing = editingId !== null;
  const url = isEditing ? API_URL + "/" + editingId : API_URL;

  try {
    const response = await apiFetch(url, {
      method: isEditing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error("สถานะ " + response.status);
    const saved = await response.json();

    highlightId = saved.id;
    monthInput.value = data.date.slice(0, 7);
    resetEditing();
    await loadExpenses();
    showToast(isEditing ? "บันทึกการแก้ไขแล้ว" : "เพิ่มรายการแล้ว");
  } catch (error) {
    showError("บันทึกไม่สำเร็จ ตรวจข้อมูลแล้วลองอีกครั้ง", error);
  }
});

cancelButton.addEventListener("click", function () {
  resetEditing();
  render();
});

// ---------- ล็อกอิน / สมัครสมาชิก ----------
monthInput.addEventListener("change", loadExpenses);
// ---------- ส่งออก CSV ----------
async function exportCsv() {
  if (expenses.length === 0) {
    showToast("เดือนนี้ยังไม่มีรายการให้ส่งออก");
    return;
  }
  try {
    const response = await apiFetch(
      "/api/export?month=" + encodeURIComponent(monthInput.value)
    );
    if (!response.ok) throw new Error("สถานะ " + response.status);

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "expenses-" + monthInput.value + ".csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    showToast("ส่งออกไฟล์แล้ว");
  } catch (error) {
    showError("ส่งออกไฟล์ไม่สำเร็จ ลองอีกครั้ง", error);
  }
}

document.getElementById("export-button").addEventListener("click", exportCsv);

const authView = document.getElementById("auth-view");
const appView = document.getElementById("app-view");
const authForm = document.getElementById("auth-form");
const authTitle = document.getElementById("auth-title");
const authHint = document.getElementById("auth-hint");
const authError = document.getElementById("auth-error");
const authSubmit = document.getElementById("auth-submit");
const authSwitch = document.getElementById("auth-switch");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const userNameEl = document.getElementById("user-name");
const logoutButton = document.getElementById("logout-button");

let authMode = "login"; // "login" หรือ "register"

// เรียก API แล้วถ้าเซิร์ฟเวอร์บอกว่ายังไม่ได้ล็อกอิน ให้กลับไปหน้าล็อกอิน
async function apiFetch(url, options) {
  const response = await window.fetch(url, options);
  if (response.status === 401) {
    showAuth();
    throw new Error("unauthorized");
  }
  return response;
}

function setAuthMode(mode) {
  authMode = mode;
  const isLogin = mode === "login";
  authTitle.textContent = isLogin ? "เข้าสู่ระบบ" : "สมัครสมาชิก";
  authSubmit.textContent = isLogin ? "เข้าสู่ระบบ" : "สมัครสมาชิก";
  authSwitch.textContent = isLogin
    ? "ยังไม่มีบัญชี? สมัครสมาชิก"
    : "มีบัญชีแล้ว? เข้าสู่ระบบ";
  passwordInput.autocomplete = isLogin ? "current-password" : "new-password";
  authHint.hidden = isLogin;
  authError.textContent = "";
}

function showAuth() {
  expenses = [];
  resetEditing();
  appView.hidden = true;
  authView.hidden = false;
  usernameInput.focus();
}

function showApp(username) {
  authView.hidden = true;
  appView.hidden = false;
  userNameEl.textContent = username;
  loadExpenses();
}

authSwitch.addEventListener("click", function () {
  setAuthMode(authMode === "login" ? "register" : "login");
});

authForm.addEventListener("submit", async function (event) {
  event.preventDefault();
  authError.textContent = "";

  const url = authMode === "login" ? "/api/login" : "/api/register";
  try {
    const response = await window.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: usernameInput.value.trim(),
        password: passwordInput.value,
      }),
    });
    const result = await response.json().catch(function () { return {}; });

    if (!response.ok) {
      authError.textContent = result.error || "เข้าสู่ระบบไม่สำเร็จ";
      return;
    }

    const wasRegister = authMode === "register";
    authForm.reset();
    setAuthMode("login");
    showApp(result.username);
    showToast(wasRegister ? "สมัครสมาชิกแล้ว" : "เข้าสู่ระบบแล้ว");
  } catch (error) {
    authError.textContent = "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจว่ารัน node server.js อยู่";
  }
});

logoutButton.addEventListener("click", async function () {
  try {
    await window.fetch("/api/logout", { method: "POST" });
  } catch (error) {
    console.error(error);
  }
  showAuth();
  showToast("ออกจากระบบแล้ว");
});

// ตอนเปิดหน้า เช็กว่าเคยล็อกอินค้างไว้ไหม
async function checkSession() {
  try {
    const response = await window.fetch("/api/me");
    if (response.ok) {
      const me = await response.json();
      showApp(me.username);
    } else {
      showAuth();
    }
  } catch (error) {
    showAuth();
    authError.textContent = "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจว่ารัน node server.js อยู่";
  }
}

checkSession();