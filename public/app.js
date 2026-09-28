const elements = {
  adminShell: document.querySelector("#adminShell"),
  userShell: document.querySelector("#userShell"),
  loginPanel: document.querySelector("#loginPanel"),
  loginBtn: document.querySelector("#loginBtn"),
  closeLoginBtn: document.querySelector("#closeLoginBtn"),
  loginMobile: document.querySelector("#loginMobile"),
  passwordField: document.querySelector("#passwordField"),
  viewerBadge: document.querySelector("#viewerBadge"),
  logoutBtn: document.querySelector("#logoutBtn"),
  resetBtn: document.querySelector("#resetBtn"),
  currentMonthYear: document.querySelector("#currentMonthYear"),
  totalBazar: document.querySelector("#totalBazar"),
  totalMeals: document.querySelector("#totalMeals"),
  mealRate: document.querySelector("#mealRate"),
  remainingBalance: document.querySelector("#remainingBalance"),
  fixedCostTotal: document.querySelector("#fixedCostTotal"),
  otherPaidTotal: document.querySelector("#otherPaidTotal"),
  netBalance: document.querySelector("#netBalance"),
  reportRows: document.querySelector("#reportRows"),
  memberList: document.querySelector("#memberList"),
  bazarRows: document.querySelector("#bazarRows"),
  bazarMemberField: document.querySelector("#bazarMemberField"),
  bazarOwnerSummary: document.querySelector("#bazarOwnerSummary"),
  fixedCostRows: document.querySelector("#fixedCostRows"),
  fixedCostReadOnly: document.querySelector("#fixedCostReadOnly"),
  houseRentMemberField: document.querySelector("#houseRentMemberField"),
  houseRentMemberSelect: document.querySelector("#houseRentMemberSelect"),
  houseRentSetField: document.querySelector("#houseRentSetField"),
  houseRentSummary: document.querySelector("#houseRentSummary"),
  houseRentPendingList: document.querySelector("#houseRentPendingList"),
  userWelcome: document.querySelector("#userWelcome"),
  userRoleNote: document.querySelector("#userRoleNote"),
  userBalance: document.querySelector("#userBalance"),
  userPayable: document.querySelector("#userPayable"),
  userPaid: document.querySelector("#userPaid"),
  userMealCost: document.querySelector("#userMealCost"),
  userHouseRentSummary: document.querySelector("#userHouseRentSummary"),
  userBazarRows: document.querySelector("#userBazarRows"),
  userAccountSummary: document.querySelector("#userAccountSummary"),
  userSettlementSummary: document.querySelector("#userSettlementSummary"),
  allocationFields: document.querySelector("#allocationFields"),
  mandatoryAdminControls: document.querySelector("#mandatoryAdminControls"),
  mandatoryReadOnly: document.querySelector("#mandatoryReadOnly"),
  addFixedCostRow: document.querySelector("#addFixedCostRow"),
  toast: document.querySelector("#toast")
};

const forms = {
  login: document.querySelector("#loginForm"),
  member: document.querySelector("#memberForm"),
  bazar: document.querySelector("#bazarForm"),
  fixedCost: document.querySelector("#fixedCostForm"),
  houseRent: document.querySelector("#houseRentForm"),
  userHouseRent: document.querySelector("#userHouseRentForm"),
  userBazar: document.querySelector("#userBazarForm")
};

let state = null;
let loginMembers = [];
let toastTimer = null;
let fixedCostDraft = [];
let selectedHouseRentMemberId = "";

function money(value) {
  const amount = Number(value || 0);
  return `BDT: ${amount.toLocaleString("en-US", {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  })}`;
}

function number(value) {
  const amount = Number(value || 0);
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatMonthYear(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return String(value || "-");
  }

  const [, year, month] = match;
  const date = new Date(Number(year), Number(month) - 1, 1);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(date);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeMobile(value) {
  return String(value || "").replace(/\D/g, "");
}

function activeMembers() {
  return state.store.members.filter((member) => member.active !== false);
}

function currentViewer() {
  return state?.viewer || null;
}

function isAdmin() {
  return currentViewer()?.role === "admin";
}

function findLoginMemberByMobile(mobile) {
  const normalizedMobile = normalizeMobile(mobile);
  return loginMembers.find((member) => normalizeMobile(member.mobile) === normalizedMobile) || null;
}

function memberName(memberId) {
  return state.store.members.find((member) => member.id === memberId)?.name || "Unknown";
}

function currentHouseRentEntry() {
  if (!currentViewer()) {
    return null;
  }
  const memberId = isAdmin() ? selectedHouseRentMemberId || currentViewer().id : currentViewer().id;
  const member = activeMembers().find((item) => item.id === memberId) || null;
  return member
    ? {
        memberId,
        rentAmount: Number(member.rentAmount || 0),
        rentPaid: Number(member.rentPaid || 0)
      }
    : null;
}

function focusFixedCostRow(index) {
  const input = elements.fixedCostRows.querySelector(`[data-fixed-label="${index}"]`);
  if (!input) {
    return;
  }
  input.focus();
  input.select();
}

function currentReportRow() {
  if (!currentViewer()) {
    return null;
  }
  return state.report.rows.find((row) => row.memberId === currentViewer().id) || null;
}

function currentHouseRentMember() {
  if (!currentViewer()) {
    return null;
  }
  const memberId = isAdmin() ? selectedHouseRentMemberId || currentViewer().id : currentViewer().id;
  return activeMembers().find((member) => member.id === memberId) || null;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }

  if (!response.ok) {
    if (response.status === 401) {
      state = null;
      renderShell();
    }
    throw new Error(data?.message || "Request failed.");
  }

  return data;
}

async function api(path, options = {}) {
  const data = await request(path, options);
  if (data?.store && data?.report) {
    state = data;
    render();
  }
  return data;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 2400);
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function resetForm(form) {
  form.reset();
  form.querySelectorAll('input[type="date"]').forEach((input) => {
    input.value = today();
  });
  renderMemberSelects();
}

function setFixedCostDraftFromState() {
  fixedCostDraft = state.report.fixedCosts.map((entry) => ({
    id: entry.id,
    label: entry.label,
    amount: entry.amount
  }));
  fixedCostDraft.push({ id: "", label: "", amount: "" });
}

function renderShell() {
  const loggedIn = Boolean(state?.viewer);
  elements.loginBtn.classList.toggle("hidden", loggedIn);
  elements.viewerBadge.classList.toggle("hidden", !loggedIn);
  elements.logoutBtn.classList.toggle("hidden", !loggedIn);
  elements.resetBtn.classList.toggle("hidden", !loggedIn || !isAdmin());
  elements.adminShell.classList.remove("hidden");
  elements.userShell.classList.add("hidden");

  if (loggedIn) {
    elements.viewerBadge.textContent = `${currentViewer().name} (${currentViewer().role})`;
    elements.loginPanel.classList.add("hidden");
  } else {
    elements.viewerBadge.textContent = "";
  }
}

function render() {
  renderShell();
  if (!state) {
    return;
  }
  renderSummary();
  renderMemberSelects();
  renderReport();
  renderMembers();
  renderBazar();
  renderFixedCosts();
  renderHouseRent();
  renderUserDashboard();
}

function renderSummary() {
  const summary = state.report.summary;
  const remainingBalance = money(summary.rentPaidTotal - summary.fixedCostTotal);
  elements.currentMonthYear.textContent = formatMonthYear(state.store.month);
  elements.totalBazar.textContent = money(summary.totalBazarCost);
  elements.totalMeals.textContent = number(summary.totalMeals);
  elements.mealRate.textContent = money(summary.mealRate);
  elements.remainingBalance.textContent = remainingBalance;
  elements.fixedCostTotal.textContent = money(summary.fixedCostTotal);
  elements.otherPaidTotal.textContent = money(summary.rentPaidTotal);
  elements.netBalance.textContent = money(summary.dueTotal);
}

function renderMemberSelects() {
  if (!state) {
    return;
  }
  const members = activeMembers().filter((member) => member.approved !== false);
  const options = members
    .map((member) => `<option value="${escapeHtml(member.id)}">${escapeHtml(member.name)}</option>`)
    .join("");

  document.querySelectorAll("[data-member-select]").forEach((select) => {
    const previous = select.value;
    select.innerHTML = options;
    if (members.some((member) => member.id === previous)) {
      select.value = previous;
    }
  });

  if (currentViewer() && !isAdmin()) {
    const select = forms.bazar.querySelector("[name='memberId']");
    if (select) {
      select.value = currentViewer().id;
    }
  }

  if (isAdmin()) {
    if (!selectedHouseRentMemberId || !members.some((member) => member.id === selectedHouseRentMemberId)) {
      selectedHouseRentMemberId = currentViewer()?.id || members[0]?.id || "";
    }
    if (elements.houseRentMemberSelect) {
      elements.houseRentMemberSelect.value = selectedHouseRentMemberId;
    }
  }
}

function renderReport() {
  elements.reportRows.innerHTML = state.report.rows
    .map((row) => {
      const balanceLabel =
        row.balance > 0 ? `Owes ${money(row.balance)}` : row.balance < 0 ? `Will get ${money(Math.abs(row.balance))}` : "Settled";
      return `
        <tr>
          <td>
            <strong>${escapeHtml(row.name)}</strong>
            <div class="role">${escapeHtml(row.role)}</div>
          </td>
          <td class="number">${number(row.mealCount)}</td>
          <td class="number">${money(row.mealCost)}</td>
          <td class="number">${money(row.fixedCost)}</td>
          <td class="number">${money(row.individualCost)}</td>
          <td class="number">${money(row.totalPayable)}</td>
          <td class="number">${money(row.totalPaid)}</td>
          <td><span class="pill ${row.status}">${balanceLabel}</span></td>
        </tr>
      `;
    })
    .join("");
}

function renderMembers() {
  forms.member.classList.toggle("hidden", !isAdmin());
  const members = activeMembers();
  elements.memberList.innerHTML = members
    .map((member) => {
      const actions = [];
      if (isAdmin()) {
        if (member.id !== currentViewer().id) {
          if (member.approved === false) {
            actions.push(
              `<button class="ghost-button" type="button" data-approve-member="${escapeHtml(member.id)}">Approve</button>`
            );
          }
          actions.push(
            `<button class="link-button danger" type="button" data-delete="members" data-id="${escapeHtml(member.id)}">Remove</button>`
          );
        }
      }

      return `
        <div class="member-item">
          <div>
            <div class="member-name">${escapeHtml(member.name)}</div>
            <div class="role">${escapeHtml(member.role)} | ${escapeHtml(member.mobile || "")}</div>
            <div class="muted">${member.approved === false ? "Pending approval" : "Approved"}</div>
          </div>
          <div class="row-actions">${actions.join("")}</div>
        </div>
      `;
    })
    .join("");
}

function renderBazar() {
  const loggedIn = Boolean(currentViewer());
  const memberSelect = forms.bazar.querySelector("[name='memberId']");
  elements.bazarMemberField.classList.toggle("hidden", loggedIn && !isAdmin());
  elements.bazarOwnerSummary.classList.toggle("hidden", !(loggedIn && !isAdmin()));
  if (loggedIn && !isAdmin()) {
    elements.bazarOwnerSummary.textContent = `Adding bazar for ${currentViewer().name}`;
    memberSelect.value = currentViewer().id;
  }

  elements.bazarRows.innerHTML = state.store.bazarEntries
    .map(
      (entry) => `
        <tr>
          <td>${escapeHtml(entry.date || "")}</td>
          <td>${escapeHtml(memberName(entry.memberId))}</td>
          <td>${escapeHtml(entry.description || "Bazar")}</td>
          <td class="number">${money(entry.amount)}</td>
          <td>${
            currentViewer() && (isAdmin() || entry.memberId === currentViewer().id)
              ? `<button class="link-button danger" type="button" data-delete="bazar" data-id="${escapeHtml(entry.id)}">Delete</button>`
              : ""
          }</td>
        </tr>
      `
    )
    .join("");
}

function renderFixedCosts() {
  elements.mandatoryAdminControls.classList.toggle("hidden", !isAdmin());
  elements.mandatoryReadOnly.classList.toggle("hidden", isAdmin());

  if (isAdmin()) {
    if (!fixedCostDraft.length) {
      setFixedCostDraftFromState();
    }
    elements.fixedCostRows.innerHTML = fixedCostDraft
      .map(
        (entry, index) => `
          <div class="mandatory-row">
            <input data-fixed-label="${index}" type="text" placeholder="Title" value="${escapeHtml(entry.label)}">
            <input data-fixed-amount="${index}" type="number" min="0" step="0.01" placeholder="Amount" value="${escapeHtml(entry.amount)}">
            <button class="mandatory-remove" type="button" data-remove-fixed-row="${index}" aria-label="Remove cost">x</button>
          </div>
        `
      )
      .join("");
    return;
  }

  elements.fixedCostReadOnly.innerHTML = state.report.fixedCosts
    .map(
      (entry) => `
        <div class="mandatory-readonly-row">
          <div>
            <strong>${escapeHtml(entry.label)}</strong>
          </div>
          <div class="number">${money(entry.amount)}</div>
        </div>
      `
    )
    .join("");
}

function renderHouseRent() {
  const viewer = currentViewer();
  const targetMember = currentHouseRentMember();
  const entry = currentHouseRentEntry();
  const setInput = forms.houseRent.querySelector("[name='rentAmount']");
  const paidInput = forms.houseRent.querySelector("[name='paidAmount']");
  forms.houseRent.classList.toggle("hidden", !viewer);
  elements.houseRentMemberField.classList.toggle("hidden", !isAdmin());
  elements.houseRentSetField.classList.toggle("hidden", !viewer);

  if (!viewer) {
    elements.houseRentSummary.textContent = "Log in to set your house rent.";
    return;
  }

  setInput.disabled = !isAdmin();
  setInput.readOnly = !isAdmin();
  setInput.value = entry ? entry.rentAmount : "";
  paidInput.value = entry ? entry.rentPaid : "";
  const dueAmount = Math.max(0, Number(entry?.rentAmount || 0) - Number(entry?.rentPaid || 0));
  elements.houseRentSummary.textContent =
    `${targetMember?.name || viewer.name} | Paid: ${money(entry?.rentPaid || 0)} | Due: ${money(dueAmount)}`;

  const rentStatusMembers = activeMembers();
  if (!rentStatusMembers.length) {
    elements.houseRentPendingList.innerHTML = '<div class="empty">No members found.</div>';
    return;
  }

  elements.houseRentPendingList.innerHTML = rentStatusMembers
    .map(
      (member) => {
        const rentAmount = Number(member.rentAmount || 0);
        const rentPaid = Number(member.rentPaid || 0);
        const dueAmount = Math.max(0, rentAmount - rentPaid);
        let statusLabel = "Not set";

        if (rentAmount > 0 && dueAmount > 0) {
          statusLabel = `Due: ${money(dueAmount)}`;
        } else if (rentAmount > 0) {
          statusLabel = "Paid";
        }

        return `
        <div class="member-item compact-item">
          <div>
            <div class="member-name">${escapeHtml(member.name)}</div>
            <div class="role">${escapeHtml(member.mobile || "")}</div>
          </div>
          <div class="muted">${statusLabel}</div>
        </div>
      `;
      }
    )
    .join("");
}

function renderUserDashboard() {
  const viewer = currentViewer();
  const row = currentReportRow();
  const rentEntry = currentHouseRentEntry();

  if (!viewer || !row || isAdmin()) {
    return;
  }

  elements.userWelcome.textContent = `${viewer.name}'s dashboard`;
  elements.userRoleNote.textContent = viewer.mobile;
  elements.userBalance.textContent =
    row.balance > 0 ? money(row.balance) : row.balance < 0 ? `Advance ${money(Math.abs(row.balance))}` : "Settled";
  elements.userPayable.textContent = money(row.totalPayable);
  elements.userPaid.textContent = money(row.totalPaid);
  elements.userMealCost.textContent = money(row.mealCost);

  const userHouseRentInput = forms.userHouseRent.querySelector("[name='amount']");
  userHouseRentInput.value = rentEntry ? rentEntry.rentPaid : "";
  const userRentDue = Math.max(0, Number(rentEntry?.rentAmount || 0) - Number(rentEntry?.rentPaid || 0));
  elements.userHouseRentSummary.textContent = rentEntry
    ? `Paid: ${money(rentEntry.rentPaid)} | Due: ${money(userRentDue)}`
    : "No house rent saved yet.";

  const myBazarEntries = state.store.bazarEntries.filter((entry) => entry.memberId === viewer.id);
  elements.userBazarRows.innerHTML = myBazarEntries
    .map(
      (entry) => `
        <tr>
          <td>${escapeHtml(entry.date || "")}</td>
          <td>${escapeHtml(entry.description || "Bazar")}</td>
          <td class="number">${money(entry.amount)}</td>
          <td><button class="link-button danger" type="button" data-delete="bazar" data-id="${escapeHtml(entry.id)}">Delete</button></td>
        </tr>
      `
    )
    .join("");

  elements.userAccountSummary.innerHTML = [
    ["Meals", number(row.mealCount)],
    ["Fixed cost share", money(row.fixedCost)],
    ["Other individual costs", money(row.individualCost)],
    ["Bazar paid", money(row.bazarPaid)],
    ["Other paid", money(row.otherPaid)]
  ]
    .map(
      ([label, value]) => `
        <div class="summary-row">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
      `
    )
    .join("");

  elements.userSettlementSummary.textContent =
    row.balance > 0
      ? `You still need to pay ${money(row.balance)}.`
      : row.balance < 0
        ? `You have an advance of ${money(Math.abs(row.balance))}.`
        : "Your account is settled.";
}

async function refreshLoginOptions() {
  const data = await request("/api/session/options");
  loginMembers = data.members || [];
}

async function loadPublicState() {
  state = await request("/api/public-state");
  render();
}

async function syncMandatoryCosts() {
  const rows = fixedCostDraft
    .map((entry) => ({
      id: entry.id,
      label: String(entry.label || "").trim(),
      amount: Number(entry.amount || 0)
    }))
    .filter((entry) => entry.label && entry.amount > 0);

  const existingIds = state.report.fixedCosts.map((entry) => entry.id);
  for (const id of existingIds) {
    await api(`/api/fixed-costs/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  for (const row of rows) {
    await api("/api/fixed-costs", {
      method: "POST",
      body: JSON.stringify({
        label: row.label,
        amount: row.amount,
        splitType: "equal",
        allocations: {}
      })
    });
  }

  setFixedCostDraftFromState();
}

async function handleSubmit(form, path, buildPayload, successMessage) {
  try {
    const payload = buildPayload(formData(form));
    await api(path, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    resetForm(form);
    showToast(successMessage);
  } catch (error) {
    showToast(error.message);
  }
}

forms.login.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/session", {
      method: "POST",
      body: JSON.stringify(formData(forms.login))
    });
    if (isAdmin()) {
      setFixedCostDraftFromState();
    }
    forms.login.reset();
    elements.loginPanel.classList.add("hidden");
    showToast("Logged in.");
  } catch (error) {
    showToast(error.message);
  }
});

forms.member.addEventListener("submit", (event) => {
  event.preventDefault();
  handleSubmit(
    forms.member,
    "/api/members",
    (data) => ({ ...data, role: "member", approved: false }),
    "Member added. Waiting for approval."
  );
});

forms.bazar.addEventListener("submit", (event) => {
  event.preventDefault();
  handleSubmit(
    forms.bazar,
    "/api/bazar",
    (data) => ({ ...data, memberId: isAdmin() ? data.memberId : currentViewer()?.id }),
    "Bazar entry added."
  );
});

forms.fixedCost.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await syncMandatoryCosts();
    showToast("Mandatory costs updated.");
  } catch (error) {
    showToast(error.message);
  }
});

forms.houseRent.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/my-house-rent", {
      method: "PUT",
      body: JSON.stringify({
        ...formData(forms.houseRent),
        memberId: isAdmin() ? selectedHouseRentMemberId : currentViewer()?.id
      })
    });
    showToast("House rent updated.");
  } catch (error) {
    showToast(error.message);
  }
});

forms.userHouseRent.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/my-house-rent", {
      method: "PUT",
      body: JSON.stringify({
        paidAmount: formData(forms.userHouseRent).amount,
        memberId: currentViewer()?.id
      })
    });
    showToast("House rent updated.");
  } catch (error) {
    showToast(error.message);
  }
});

elements.houseRentMemberSelect?.addEventListener("change", () => {
  selectedHouseRentMemberId = elements.houseRentMemberSelect.value;
  renderHouseRent();
});

forms.userBazar.addEventListener("submit", (event) => {
  event.preventDefault();
  handleSubmit(
    forms.userBazar,
    "/api/bazar",
    (data) => ({ ...data, memberId: currentViewer()?.id }),
    "Bazar entry added."
  );
});

elements.addFixedCostRow.addEventListener("click", () => {
  fixedCostDraft.push({ id: "", label: "", amount: "" });
  renderFixedCosts();
  focusFixedCostRow(fixedCostDraft.length - 1);
});

elements.loginBtn.addEventListener("click", async () => {
  elements.loginPanel.classList.toggle("hidden");
  if (!elements.loginPanel.classList.contains("hidden")) {
    await refreshLoginOptions();
    elements.loginMobile.focus();
  }
});

elements.closeLoginBtn.addEventListener("click", () => {
  elements.loginPanel.classList.add("hidden");
});

elements.logoutBtn.addEventListener("click", async () => {
  try {
    await request("/api/session", { method: "DELETE" });
  } catch (error) {
    showToast(error.message);
  }
  await loadPublicState();
  fixedCostDraft = [];
  renderShell();
  showToast("Logged out.");
});

elements.resetBtn.addEventListener("click", async () => {
  try {
    await api("/api/reset", { method: "POST", body: "{}" });
    if (isAdmin()) {
      setFixedCostDraftFromState();
    }
    await refreshLoginOptions();
    showToast("Sample data restored.");
  } catch (error) {
    showToast(error.message);
  }
});

document.addEventListener("input", (event) => {
  const labelInput = event.target.closest("[data-fixed-label]");
  if (labelInput) {
    fixedCostDraft[Number(labelInput.dataset.fixedLabel)].label = labelInput.value;
  }

  const amountInput = event.target.closest("[data-fixed-amount]");
  if (amountInput) {
    fixedCostDraft[Number(amountInput.dataset.fixedAmount)].amount = amountInput.value;
  }
});

document.addEventListener("click", async (event) => {
  if (event.target === elements.loginPanel) {
    elements.loginPanel.classList.add("hidden");
    return;
  }

  const removeFixedRowButton = event.target.closest("[data-remove-fixed-row]");
  if (removeFixedRowButton) {
    const index = Number(removeFixedRowButton.dataset.removeFixedRow);
    fixedCostDraft.splice(index, 1);
    if (!fixedCostDraft.length) {
      fixedCostDraft.push({ id: "", label: "", amount: "" });
    }
    renderFixedCosts();
    return;
  }

  const approveButton = event.target.closest("[data-approve-member]");
  if (approveButton) {
    try {
      await api(`/api/members/${encodeURIComponent(approveButton.dataset.approveMember)}/approval`, {
        method: "PUT",
        body: JSON.stringify({ approved: true })
      });
      await refreshLoginOptions();
      showToast("Member approved.");
    } catch (error) {
      showToast(error.message);
    }
    return;
  }

  const button = event.target.closest("[data-delete]");
  if (!button) {
    return;
  }
  try {
    await api(`/api/${button.dataset.delete}/${encodeURIComponent(button.dataset.id)}`, {
      method: "DELETE"
    });
    await refreshLoginOptions();
    if (button.dataset.delete === "fixed-costs" && isAdmin()) {
      setFixedCostDraftFromState();
    }
    showToast("Deleted.");
  } catch (error) {
    showToast(error.message);
  }
});

async function init() {
  document.querySelectorAll('input[type="date"]').forEach((input) => {
    input.value = today();
  });

  try {
    await refreshLoginOptions();
    await api("/api/state");
    if (isAdmin()) {
      setFixedCostDraftFromState();
    }
  } catch (error) {
    await loadPublicState();
  }
}

renderShell();
init();
