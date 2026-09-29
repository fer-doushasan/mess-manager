// Role-based UI. The server decides what each role may see and do; hiding things
// here is only for a cleaner experience, never for security. All numbers come from
// the server's calculator; nothing is recalculated here.
const $ = (selector) => document.querySelector(selector);

const elements = {
  adminShell: $("#adminShell"),
  memberShell: $("#memberShell"),
  loginPanel: $("#loginPanel"),
  loginBtn: $("#loginBtn"),
  closeLoginBtn: $("#closeLoginBtn"),
  loginMobile: $("#loginMobile"),
  viewerBadge: $("#viewerBadge"),
  logoutBtn: $("#logoutBtn"),
  messName: $("#messName"),
  currentMonthLabel: $("#currentMonthLabel"),
  toast: $("#toast"),

  // admin
  adminMembers: $("#adminMembers"),
  totalBazar: $("#totalBazar"),
  totalMeals: $("#totalMeals"),
  mealRate: $("#mealRate"),
  fixedAssignedTotal: $("#fixedAssignedTotal"),
  paymentsTotal: $("#paymentsTotal"),
  fixedDueTotal: $("#fixedDueTotal"),
  dueTotal: $("#dueTotal"),
  memberFormTitle: $("#memberFormTitle"),
  cancelMemberEdit: $("#cancelMemberEdit"),
  memberList: $("#memberList"),
  bazarFormTitle: $("#bazarFormTitle"),
  cancelBazarEdit: $("#cancelBazarEdit"),
  bazarRows: $("#bazarRows"),
  mealRows: $("#mealRows"),
  fixedRows: $("#fixedRows"),
  fixedFoot: $("#fixedFoot"),
  fixedCostCheck: $("#fixedCostCheck"),
  fixedCostRows: $("#fixedCostRows"),
  addFixedCostRow: $("#addFixedCostRow"),
  paymentRows: $("#paymentRows"),
  adminMealRateLabel: $("#adminMealRateLabel"),
  adminMealTable: $("#adminMealTable"),
  adminSettlementTable: $("#adminSettlementTable"),
  historyList: $("#historyList"),
  closeMonthBtn: $("#closeMonthBtn"),
  resetBtn: $("#resetBtn"),

  // member
  userBalance: $("#userBalance"),
  userBalanceNote: $("#userBalanceNote"),
  userFixedSummary: $("#userFixedSummary"),
  userMealSummary: $("#userMealSummary"),
  userBazarTotal: $("#userBazarTotal"),
  userBazarRows: $("#userBazarRows"),
  userPaymentTotal: $("#userPaymentTotal"),
  userPaymentRows: $("#userPaymentRows"),
  memberMealRateLabel: $("#memberMealRateLabel"),
  memberMealTable: $("#memberMealTable"),
  memberSettlementTable: $("#memberSettlementTable"),
  bazarSummaryRows: $("#bazarSummaryRows"),
  bazarSummaryFoot: $("#bazarSummaryFoot"),
  overviewBazarRows: $("#overviewBazarRows")
};

const forms = {
  login: $("#loginForm"),
  member: $("#memberForm"),
  bazar: $("#bazarForm"),
  fixedCost: $("#fixedCostForm"),
  adminPayment: $("#adminPaymentForm"),
  settings: $("#settingsForm"),
  userBazar: $("#userBazarForm"),
  userPayment: $("#userPaymentForm")
};

let state = null;
let toastTimer = null;
let fixedCostDraft = [];

// ---------- helpers ----------

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

// Positive = due, negative = credit. Always shown with a word so the sign is never ambiguous.
function signed(value, { due = "due", credit = "credit" } = {}) {
  const amount = Number(value || 0);
  if (amount > 0) {
    return `<span class="due">${money(amount)} ${due}</span>`;
  }
  if (amount < 0) {
    return `<span class="credit">${money(-amount)} ${credit}</span>`;
  }
  return `<span class="muted">${money(0)}</span>`;
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

function paymentKindLabel(kind) {
  return kind === "fixed" ? "Fixed cost" : "Meal cost";
}

function emptyRow(columns, text) {
  return `<tr><td colspan="${columns}" class="muted">${escapeHtml(text)}</td></tr>`;
}

function summaryRows(rows) {
  return rows
    .map(
      ([label, value, style]) => `
        <div class="summary-row${style === "sub" ? " sub" : style ? " total" : ""}">
          <span>${escapeHtml(label)}</span>
          <strong>${value}</strong>
        </div>
      `
    )
    .join("");
}

function sumOf(rows, field) {
  return rows.reduce((total, row) => total + Number(row[field] || 0), 0);
}

function currentViewer() {
  return state?.viewer || null;
}

function isAdmin() {
  return currentViewer()?.role === "admin";
}

function activeMembers() {
  return isAdmin() ? state.store.members.filter((member) => member.active !== false) : [];
}

function memberName(memberId) {
  return state.store.members.find((member) => member.id === memberId)?.name || "Unknown";
}

function inOpenMonth(entries) {
  return entries.filter((entry) => entry.month === state.month);
}

// ---------- shared tables (admin and member see the same numbers) ----------

function nameCell(row, meId) {
  return `<strong>${escapeHtml(row.name)}</strong>${row.memberId === meId ? ' <span class="muted">(you)</span>' : ""}`;
}

function mealTable(rows, summary, meId) {
  if (!rows.length) {
    return '<div class="empty">No members yet.</div>';
  }
  const body = rows
    .map(
      (row) => `
        <tr class="${row.memberId === meId ? "is-me" : ""}">
          <td>${nameCell(row, meId)}</td>
          <td class="number">${number(row.mealCount)}</td>
          <td class="number">${money(row.mealCost)}</td>
          <td class="number">${money(row.bazarPaid)}</td>
          <td class="number">${money(row.mealPaid)}</td>
          <td class="number">${money(row.mealTotalPaid)}</td>
          <td class="number">${signed(row.mealBalance)}</td>
        </tr>
      `
    )
    .join("");
  return `
    <table>
      <thead>
        <tr>
          <th>Member</th><th class="number">Meals</th><th class="number">Meal cost</th>
          <th class="number">Bazar</th><th class="number">Cash</th><th class="number">Meal paid</th>
          <th class="number">Meal balance</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
      <tfoot>
        <tr>
          <th>Total</th>
          <th class="number">${number(summary.totalMeals)}</th>
          <th class="number">${money(summary.totalMealCost ?? sumOf(rows, "mealCost"))}</th>
          <th class="number">${money(summary.totalBazarCost)}</th>
          <th class="number">${money(sumOf(rows, "mealPaid"))}</th>
          <th class="number">${money(sumOf(rows, "mealTotalPaid"))}</th>
          <th class="number">${signed(sumOf(rows, "mealBalance"))}</th>
        </tr>
      </tfoot>
    </table>
    <p class="muted table-note">Meal paid = bazar + cash meal payments. Meal balance = meal cost − meal paid; credit means the person paid more than they ate.</p>
  `;
}

function settlementTable(rows, meId) {
  if (!rows.length) {
    return '<div class="empty">No members yet.</div>';
  }
  const hasPrevious = rows.some((row) => row.previousBalance);
  const body = rows
    .map(
      (row) => `
        <tr class="${row.memberId === meId ? "is-me" : ""}">
          <td>${nameCell(row, meId)}</td>
          <td class="number">${money(row.bazarPaid)}</td>
          <td class="number">${number(row.mealCount)}</td>
          <td class="number">${money(row.mealCost)}</td>
          <td class="number">${signed(row.mealBalance)}</td>
          <td class="number">${signed(row.fixedBalance, { credit: "advance" })}</td>
          ${hasPrevious ? `<td class="number">${signed(row.previousBalance)}</td>` : ""}
          <td class="number total-cell">${signed(row.balance, { credit: "to get back" })}</td>
        </tr>
      `
    )
    .join("");
  return `
    <table>
      <thead>
        <tr>
          <th>Member</th><th class="number">Bazar</th><th class="number">Meals</th><th class="number">Meal cost</th>
          <th class="number">Meal due</th><th class="number">Fixed due</th>
          ${hasPrevious ? '<th class="number">Last month</th>' : ""}
          <th class="number">Total due</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
      <tfoot>
        <tr>
          <th>Total</th>
          <th class="number">${money(sumOf(rows, "bazarPaid"))}</th>
          <th class="number">${number(sumOf(rows, "mealCount"))}</th>
          <th class="number">${money(sumOf(rows, "mealCost"))}</th>
          <th class="number">${signed(sumOf(rows, "mealBalance"))}</th>
          <th class="number">${signed(sumOf(rows, "fixedBalance"), { credit: "advance" })}</th>
          ${hasPrevious ? `<th class="number">${signed(sumOf(rows, "previousBalance"))}</th>` : ""}
          <th class="number">${signed(sumOf(rows, "balance"), { credit: "to get back" })}</th>
        </tr>
      </tfoot>
    </table>
    <p class="muted table-note">Total due = meal due + fixed due${hasPrevious ? " + last month" : ""}. A credit reduces what the person owes.</p>
  `;
}

// ---------- network ----------

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
    if (response.status === 401 && path !== "/api/session") {
      showLoggedOut();
    }
    throw new Error(data?.message || "Request failed.");
  }

  return data;
}

async function api(path, options = {}) {
  const data = await request(path, options);
  if (data && "viewer" in data) {
    if (!data.viewer) {
      showLoggedOut();
    } else {
      state = data;
      render();
    }
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

async function handleSubmit(form, path, buildPayload, successMessage, method = "POST") {
  try {
    await api(path, { method, body: JSON.stringify(buildPayload(formData(form))) });
    resetForm(form);
    showToast(successMessage);
    return true;
  } catch (error) {
    showToast(error.message);
    return false;
  }
}

// ---------- rendering ----------

function renderShell() {
  const loggedIn = Boolean(currentViewer());
  elements.loginBtn.classList.toggle("hidden", loggedIn);
  elements.viewerBadge.classList.toggle("hidden", !loggedIn);
  elements.logoutBtn.classList.toggle("hidden", !loggedIn);
  elements.adminShell.classList.toggle("hidden", !loggedIn || !isAdmin());
  elements.memberShell.classList.toggle("hidden", !loggedIn || isAdmin());

  if (loggedIn) {
    elements.viewerBadge.textContent = `${currentViewer().name} (${currentViewer().role})`;
    elements.loginPanel.classList.add("hidden");
  } else {
    elements.viewerBadge.textContent = "";
    elements.currentMonthLabel.textContent = "";
  }
}

function render() {
  renderShell();
  if (!state) {
    return;
  }
  const messName = state.settings?.messName || "Sweet Home";
  elements.messName.textContent = `${messName} Expense Manager`;
  document.title = `${messName} Expense Manager`;
  elements.currentMonthLabel.textContent = formatMonthYear(state.month);

  if (isAdmin()) {
    renderAdmin();
  } else {
    renderMember();
  }
}

// ---------- admin ----------

function renderAdmin() {
  const { summary, rows } = state.report;
  elements.adminMembers.textContent = number(summary.totalMembers);
  elements.totalBazar.textContent = money(summary.totalBazarCost);
  elements.totalMeals.textContent = number(summary.totalMeals);
  elements.mealRate.textContent = money(summary.mealRate);
  elements.fixedAssignedTotal.textContent = money(summary.fixedAssignedTotal);
  elements.paymentsTotal.textContent = money(summary.paymentsTotal);
  elements.fixedDueTotal.textContent = money(summary.fixedDueTotal);
  elements.dueTotal.textContent = money(summary.dueTotal);

  renderMemberSelects();
  renderMembers();
  renderBazar();
  renderMeals();
  renderFixedCosts();
  renderPayments();

  elements.adminMealRateLabel.textContent = `Meal rate: ${money(summary.mealRate)}`;
  elements.adminMealTable.innerHTML = mealTable(rows, summary);
  elements.adminSettlementTable.innerHTML = settlementTable(rows);
  renderHistory();
  renderSettings();
}

function renderMemberSelects() {
  if (!isAdmin()) {
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
}

function resetMemberForm() {
  forms.member.reset();
  forms.member.elements.id.value = "";
  forms.member.elements.password.placeholder = "At least 6 characters";
  elements.memberFormTitle.textContent = "Members";
  elements.cancelMemberEdit.classList.add("hidden");
}

function renderMembers() {
  elements.memberList.innerHTML = activeMembers()
    .map((member) => {
      const actions = [
        `<button class="ghost-button" type="button" data-edit-member="${escapeHtml(member.id)}">Edit</button>`
      ];
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

function resetBazarForm() {
  resetForm(forms.bazar);
  forms.bazar.elements.id.value = "";
  elements.bazarFormTitle.textContent = "Bazar";
  elements.cancelBazarEdit.classList.add("hidden");
}

function renderBazar() {
  const entries = inOpenMonth(state.store.bazarEntries);
  elements.bazarRows.innerHTML = entries.length
    ? entries
        .map(
          (entry) => `
            <tr>
              <td>${escapeHtml(entry.date || "")}</td>
              <td>${escapeHtml(memberName(entry.memberId))}</td>
              <td>${escapeHtml(entry.description || "Bazar")}</td>
              <td class="number">${money(entry.amount)}</td>
              <td class="row-actions">
                <button class="link-button" type="button" data-edit-bazar="${escapeHtml(entry.id)}">Edit</button>
                <button class="link-button danger" type="button" data-delete="bazar" data-id="${escapeHtml(entry.id)}">Delete</button>
              </td>
            </tr>
          `
        )
        .join("")
    : emptyRow(5, "No bazar yet this month.");
}

function renderMeals() {
  elements.mealRows.innerHTML = state.report.rows
    .map(
      (row) => `
        <tr>
          <td><strong>${escapeHtml(row.name)}</strong></td>
          <td class="number">
            <input class="meal-input" type="number" min="0" step="0.5" value="${escapeHtml(row.mealCount)}"
              data-meal-member="${escapeHtml(row.memberId)}" aria-label="Meals for ${escapeHtml(row.name)}">
          </td>
          <td class="number">${money(row.mealCost)}</td>
        </tr>
      `
    )
    .join("");
}

function setFixedCostDraftFromState() {
  fixedCostDraft = state.report.fixedCosts.map((entry) => ({
    id: entry.id,
    label: entry.label,
    amount: entry.amount
  }));
  fixedCostDraft.push({ id: "", label: "", amount: "" });
}

function focusFixedCostRow(index) {
  const input = elements.fixedCostRows.querySelector(`[data-fixed-label="${index}"]`);
  if (input) {
    input.focus();
    input.select();
  }
}

function renderFixedCosts() {
  const { rows, summary } = state.report;
  elements.fixedRows.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td><strong>${escapeHtml(row.name)}</strong></td>
          <td class="number">
            <input class="meal-input fixed-input" type="number" min="0" step="0.01" value="${escapeHtml(row.fixedCost)}"
              data-fixed-member="${escapeHtml(row.memberId)}" aria-label="Fixed cost for ${escapeHtml(row.name)}">
          </td>
          <td class="number">${money(row.fixedPaid)}</td>
          <td class="number">${signed(row.fixedBalance, { credit: "advance" })}</td>
        </tr>
      `
    )
    .join("");
  elements.fixedFoot.innerHTML = `
    <tr>
      <th>Total</th>
      <th class="number">${money(summary.fixedAssignedTotal)}</th>
      <th class="number">${money(summary.fixedPaidTotal)}</th>
      <th class="number">${money(summary.fixedDueTotal)} due</th>
    </tr>
  `;

  const difference = summary.fixedAssignedTotal - summary.fixedCostTotal;
  elements.fixedCostCheck.classList.toggle("warning", difference !== 0);
  elements.fixedCostCheck.textContent =
    `Bills total ${money(summary.fixedCostTotal)} | Everyone's fixed costs ${money(summary.fixedAssignedTotal)}` +
    (difference === 0 ? " | Matches" : difference > 0 ? ` | ${money(difference)} more than bills` : ` | ${money(-difference)} not assigned yet`);

  if (!fixedCostDraft.length) {
    setFixedCostDraftFromState();
  }
  elements.fixedCostRows.innerHTML = fixedCostDraft
    .map(
      (entry, index) => `
        <div class="mandatory-row">
          <input data-fixed-label="${index}" type="text" placeholder="House rent, Internet, Gas…" value="${escapeHtml(entry.label)}">
          <input data-fixed-amount="${index}" type="number" min="0" step="0.01" placeholder="Amount" value="${escapeHtml(entry.amount)}">
          <button class="mandatory-remove" type="button" data-remove-fixed-row="${index}" aria-label="Remove bill">x</button>
        </div>
      `
    )
    .join("");
}

function renderPayments() {
  const payments = inOpenMonth(state.store.payments);
  elements.paymentRows.innerHTML = payments.length
    ? payments
        .map(
          (payment) => `
            <tr>
              <td>${escapeHtml(payment.date || "")}</td>
              <td>${escapeHtml(memberName(payment.memberId))}</td>
              <td>${paymentKindLabel(payment.kind)}</td>
              <td>${escapeHtml(payment.note || "")}</td>
              <td class="number">${money(payment.amount)}</td>
              <td><button class="link-button danger" type="button" data-delete="payments" data-id="${escapeHtml(payment.id)}">Delete</button></td>
            </tr>
          `
        )
        .join("")
    : emptyRow(6, "No payments yet this month.");
}

function renderHistory() {
  const months = (state.previousMonths || []).filter((entry) => entry.report);
  elements.historyList.innerHTML = months.length
    ? months
        .map(
          ({ month, report }) => `
            <details class="history-item">
              <summary>
                ${escapeHtml(formatMonthYear(month))}: bazar ${money(report.summary.totalBazarCost)},
                meals ${number(report.summary.totalMeals)}, meal rate ${money(report.summary.mealRate)},
                outstanding ${money(report.summary.dueTotal)}
              </summary>
              <h3 class="subheading">Meal calculation</h3>
              <div class="table-wrap">${mealTable(report.rows, report.summary)}</div>
              <h3 class="subheading">Monthly settlement</h3>
              <div class="table-wrap">${settlementTable(report.rows)}</div>
            </details>
          `
        )
        .join("")
    : '<div class="empty">No closed months yet. Close a month from the Month panel below.</div>';
}

function renderSettings() {
  const input = forms.settings.elements.messName;
  if (document.activeElement !== input) {
    input.value = state.settings?.messName || "";
  }
  elements.closeMonthBtn.textContent = `Close ${formatMonthYear(state.month)} & start next month`;
}

async function syncMandatoryCosts() {
  const rows = fixedCostDraft
    .map((entry) => ({
      label: String(entry.label || "").trim(),
      amount: Number(entry.amount || 0)
    }))
    .filter((entry) => entry.label && entry.amount > 0);

  for (const entry of state.report.fixedCosts) {
    await api(`/api/fixed-costs/${encodeURIComponent(entry.id)}`, { method: "DELETE" });
  }
  for (const row of rows) {
    await api("/api/fixed-costs", { method: "POST", body: JSON.stringify(row) });
  }

  setFixedCostDraftFromState();
  renderFixedCosts();
}

// ---------- member ----------

function renderMember() {
  const me = state.me;
  if (!me) {
    return;
  }
  const { summary } = state;

  // My total due, always with its parts.
  elements.userBalance.innerHTML =
    me.balance > 0 ? money(me.balance) : me.balance < 0 ? `${money(-me.balance)} to get back` : "Nothing due";
  elements.userBalance.className = `status-amount ${me.status}`;
  const parts = [`Fixed cost ${signed(me.fixedBalance, { credit: "advance" })}`, `Meal ${signed(me.mealBalance)}`];
  if (me.previousBalance) {
    parts.push(`Last month ${signed(me.previousBalance)}`);
  }
  elements.userBalanceNote.innerHTML = parts.join(" + ");

  elements.userFixedSummary.innerHTML = summaryRows([
    ["Fixed cost this month", money(me.fixedCost)],
    ["Paid", money(me.fixedPaid)],
    ["Due", signed(me.fixedBalance, { credit: "advance" }), true]
  ]);
  elements.userMealSummary.innerHTML = summaryRows([
    ["Meals", number(me.mealCount)],
    ["Meal rate", money(summary.mealRate)],
    ["Meal cost", money(me.mealCost)],
    ["Meal paid", `− ${money(me.mealTotalPaid)}`],
    ["from my bazar", money(me.bazarPaid), "sub"],
    ["from cash payments", money(me.mealPaid), "sub"],
    ["Meal balance", signed(me.mealBalance), true]
  ]);

  // My bazar
  const myBazar = state.bazarEntries.filter((entry) => entry.memberId === me.memberId);
  elements.userBazarTotal.textContent = money(me.bazarPaid);
  elements.userBazarRows.innerHTML = myBazar.length
    ? myBazar
        .map(
          (entry) => `
            <tr>
              <td>${escapeHtml(entry.date || "")}</td>
              <td>${escapeHtml(entry.description || "Bazar")}</td>
              <td class="number">${money(entry.amount)}</td>
            </tr>
          `
        )
        .join("")
    : emptyRow(3, "You have not added any bazar this month.");

  // My payments
  elements.userPaymentTotal.textContent = money(me.fixedPaid + me.mealPaid);
  elements.userPaymentRows.innerHTML = state.payments.length
    ? state.payments
        .map(
          (payment) => `
            <tr>
              <td>${escapeHtml(payment.date || "")}</td>
              <td>${paymentKindLabel(payment.kind)}</td>
              <td>${escapeHtml(payment.note || "")}</td>
              <td class="number">${money(payment.amount)}</td>
            </tr>
          `
        )
        .join("")
    : emptyRow(4, "No payments this month.");

  // Shared tables
  elements.memberMealRateLabel.textContent = `Meal rate: ${money(summary.mealRate)}`;
  elements.memberMealTable.innerHTML = mealTable(state.members, summary, me.memberId);
  elements.memberSettlementTable.innerHTML = settlementTable(state.members, me.memberId);

  elements.bazarSummaryRows.innerHTML = state.members
    .map(
      (row) => `
        <tr class="${row.memberId === me.memberId ? "is-me" : ""}">
          <td>${nameCell(row, me.memberId)}</td>
          <td class="number">${money(row.bazarPaid)}</td>
        </tr>
      `
    )
    .join("");
  elements.bazarSummaryFoot.innerHTML = `<tr><th>Total</th><th class="number">${money(summary.totalBazarCost)}</th></tr>`;
  elements.overviewBazarRows.innerHTML = state.bazarEntries.length
    ? state.bazarEntries
        .map(
          (entry) => `
            <tr>
              <td>${escapeHtml(entry.date || "")}</td>
              <td>${escapeHtml(entry.memberName || "")}</td>
              <td>${escapeHtml(entry.description || "Bazar")}</td>
              <td class="number">${money(entry.amount)}</td>
            </tr>
          `
        )
        .join("")
    : emptyRow(4, "No bazar yet this month.");
}

// ---------- session ----------

function showLoggedOut() {
  state = null;
  fixedCostDraft = [];
  resetMemberForm();
  renderShell();
  elements.loginPanel.classList.remove("hidden");
  elements.loginMobile.focus();
}

forms.login.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    fixedCostDraft = [];
    await api("/api/session", {
      method: "POST",
      body: JSON.stringify(formData(forms.login))
    });
    forms.login.reset();
    showToast("Logged in.");
  } catch (error) {
    showToast(error.message);
  }
});

elements.loginBtn.addEventListener("click", () => {
  elements.loginPanel.classList.toggle("hidden");
  if (!elements.loginPanel.classList.contains("hidden")) {
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
  showLoggedOut();
  showToast("Logged out.");
});

// ---------- admin actions ----------

forms.member.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = formData(forms.member);
  const payload = { name: data.name, mobile: data.mobile, password: data.password, role: data.role };
  if (data.id) {
    handleSubmit(forms.member, `/api/members/${encodeURIComponent(data.id)}`, () => payload, "Member updated.", "PUT").then(
      (saved) => saved && resetMemberForm()
    );
    return;
  }
  if (!data.password) {
    showToast("Password is required for a new member.");
    return;
  }
  handleSubmit(forms.member, "/api/members", () => ({ ...payload, approved: false }), "Member added. Approve to allow login.");
});

elements.cancelMemberEdit.addEventListener("click", resetMemberForm);

forms.bazar.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = formData(forms.bazar);
  if (data.id) {
    handleSubmit(forms.bazar, `/api/bazar/${encodeURIComponent(data.id)}`, () => data, "Bazar updated.", "PUT").then(
      (saved) => saved && resetBazarForm()
    );
    return;
  }
  handleSubmit(forms.bazar, "/api/bazar", () => data, "Bazar entry added.");
});

elements.cancelBazarEdit.addEventListener("click", resetBazarForm);

forms.adminPayment.addEventListener("submit", (event) => {
  event.preventDefault();
  handleSubmit(forms.adminPayment, "/api/payments", (data) => data, "Payment added.");
});

forms.fixedCost.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await syncMandatoryCosts();
    showToast("House bills updated.");
  } catch (error) {
    showToast(error.message);
  }
});

elements.addFixedCostRow.addEventListener("click", () => {
  fixedCostDraft.push({ id: "", label: "", amount: "" });
  renderFixedCosts();
  focusFixedCostRow(fixedCostDraft.length - 1);
});

forms.settings.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/settings", { method: "PUT", body: JSON.stringify(formData(forms.settings)) });
    showToast("Settings saved.");
  } catch (error) {
    showToast(error.message);
  }
});

elements.closeMonthBtn.addEventListener("click", async () => {
  const month = formatMonthYear(state.month);
  if (
    !window.confirm(
      `Close ${month}? It stays under Previous months; each person's total due or credit carries over to next month.`
    )
  ) {
    return;
  }
  try {
    await api("/api/month/close", { method: "POST", body: "{}" });
    showToast(`${month} closed.`);
  } catch (error) {
    showToast(error.message);
  }
});

elements.resetBtn.addEventListener("click", async () => {
  if (
    !window.confirm(
      "Reset deletes all bazar, meals, payments and previous months. Members, logins, house bills and fixed costs are kept. Continue?"
    )
  ) {
    return;
  }
  try {
    fixedCostDraft = [];
    await api("/api/reset", { method: "POST", body: "{}" });
    showToast("Data reset.");
  } catch (error) {
    showToast(error.message);
  }
});

// ---------- member actions ----------

forms.userBazar.addEventListener("submit", (event) => {
  event.preventDefault();
  handleSubmit(forms.userBazar, "/api/bazar", (data) => data, "Bazar entry added.");
});

forms.userPayment.addEventListener("submit", (event) => {
  event.preventDefault();
  handleSubmit(forms.userPayment, "/api/payments", (data) => data, "Payment added.");
});

// ---------- delegated events ----------

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

document.addEventListener("change", async (event) => {
  const mealInput = event.target.closest("[data-meal-member]");
  const fixedInput = event.target.closest("[data-fixed-member]");
  try {
    if (mealInput) {
      await api(`/api/meals/${encodeURIComponent(mealInput.dataset.mealMember)}`, {
        method: "PUT",
        body: JSON.stringify({ count: mealInput.value })
      });
      showToast("Meal count saved.");
    } else if (fixedInput) {
      await api(`/api/members/${encodeURIComponent(fixedInput.dataset.fixedMember)}/fixed-amount`, {
        method: "PUT",
        body: JSON.stringify({ amount: fixedInput.value })
      });
      showToast("Fixed cost saved.");
    }
  } catch (error) {
    showToast(error.message);
  }
});

document.addEventListener("click", async (event) => {
  if (event.target === elements.loginPanel) {
    elements.loginPanel.classList.add("hidden");
    return;
  }

  const quickAction = event.target.closest("[data-focus]");
  if (quickAction) {
    setTimeout(() => document.getElementById(quickAction.dataset.focus)?.querySelector("input, select")?.focus());
    return;
  }

  const removeFixedRowButton = event.target.closest("[data-remove-fixed-row]");
  if (removeFixedRowButton) {
    fixedCostDraft.splice(Number(removeFixedRowButton.dataset.removeFixedRow), 1);
    if (!fixedCostDraft.length) {
      fixedCostDraft.push({ id: "", label: "", amount: "" });
    }
    renderFixedCosts();
    return;
  }

  const editMember = event.target.closest("[data-edit-member]");
  if (editMember) {
    const member = state.store.members.find((item) => item.id === editMember.dataset.editMember);
    const fields = forms.member.elements;
    fields.id.value = member.id;
    fields.name.value = member.name;
    fields.mobile.value = member.mobile || "";
    fields.role.value = member.role;
    fields.password.value = "";
    fields.password.placeholder = "Leave empty to keep current password";
    elements.memberFormTitle.textContent = `Edit ${member.name}`;
    elements.cancelMemberEdit.classList.remove("hidden");
    fields.name.focus();
    return;
  }

  const editBazar = event.target.closest("[data-edit-bazar]");
  if (editBazar) {
    const entry = state.store.bazarEntries.find((item) => item.id === editBazar.dataset.editBazar);
    const fields = forms.bazar.elements;
    fields.id.value = entry.id;
    fields.memberId.value = entry.memberId;
    fields.date.value = entry.date || today();
    fields.amount.value = entry.amount;
    fields.description.value = entry.description || "";
    elements.bazarFormTitle.textContent = `Edit bazar of ${memberName(entry.memberId)}`;
    elements.cancelBazarEdit.classList.remove("hidden");
    fields.amount.focus();
    return;
  }

  const approveButton = event.target.closest("[data-approve-member]");
  if (approveButton) {
    try {
      await api(`/api/members/${encodeURIComponent(approveButton.dataset.approveMember)}/approval`, {
        method: "PUT",
        body: JSON.stringify({ approved: true })
      });
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
  if (button.dataset.delete === "members" && !window.confirm("Remove this member?")) {
    return;
  }
  try {
    await api(`/api/${button.dataset.delete}/${encodeURIComponent(button.dataset.id)}`, { method: "DELETE" });
    showToast("Deleted.");
  } catch (error) {
    showToast(error.message);
  }
});

// ---------- start ----------

async function init() {
  document.querySelectorAll('input[type="date"]').forEach((input) => {
    input.value = today();
  });

  try {
    await api("/api/state");
  } catch (error) {
    showLoggedOut();
  }
}

renderShell();
init();
