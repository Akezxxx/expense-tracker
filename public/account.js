(function () {
  const authView = document.getElementById("auth-view");
  const detailsEl = document.getElementById("account");
  const passwordForm = document.getElementById("password-form");
  const deleteForm = document.getElementById("delete-form");
  const errorEl = document.getElementById("account-error");
  const currentInput = document.getElementById("current-password");
  const newInput = document.getElementById("new-password");
  const deletePasswordInput = document.getElementById("delete-password");

  // ส่งคำขอ ถ้าไม่สำเร็จให้โยน error พร้อมข้อความจากเซิร์ฟเวอร์
  async function send(method, url, body) {
    const response = await window.fetch(url, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status === 401) {
      showAuth(); // บัตรผ่านหมดอายุ กลับไปหน้าล็อกอิน
      throw new Error("unauthorized");
    }
    if (!response.ok) {
      const result = await response.json().catch(function () { return {}; });
      throw new Error(result.error || "ไม่สำเร็จ ลองอีกครั้ง");
    }
  }

  function showFailure(error) {
    if (error.message === "unauthorized") return;
    errorEl.textContent =
      error.name === "TypeError"
        ? "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจว่ารัน node server.js อยู่"
        : error.message;
  }

  passwordForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    errorEl.textContent = "";
    try {
      await send("POST", "/api/change-password", {
        currentPassword: currentInput.value,
        newPassword: newInput.value,
      });
      passwordForm.reset();
      detailsEl.open = false;
      showToast("เปลี่ยนรหัสผ่านแล้ว");
    } catch (error) {
      showFailure(error);
    }
  });

  deleteForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    errorEl.textContent = "";
    if (!window.confirm("ลบบัญชีและรายการทั้งหมดถาวร ยืนยันไหม")) return;

    try {
      await send("DELETE", "/api/account", { password: deletePasswordInput.value });
      deleteForm.reset();
      detailsEl.open = false;
      showAuth();
      showToast("ลบบัญชีแล้ว");
    } catch (error) {
      showFailure(error);
    }
  });

  // เมื่อกลับไปหน้าล็อกอิน ล้างรหัสผ่านที่ค้างอยู่ในช่องทิ้ง
  new MutationObserver(function () {
    if (!authView.hidden) {
      passwordForm.reset();
      deleteForm.reset();
      errorEl.textContent = "";
      detailsEl.open = false;
    }
  }).observe(authView, { attributes: true, attributeFilter: ["hidden"] });
})();