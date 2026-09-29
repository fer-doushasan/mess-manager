function money(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.round(parsed * 100) / 100;
}

function sum(items, selector) {
  return money(items.reduce((total, item) => total + money(selector(item)), 0));
}

function getActiveMembers(store) {
  return store.members.filter((member) => member.active !== false);
}

// Calculates one month. The input holds only that month's members, bazar, meals and
// payments (see monthData in store.js).
//
// The two parts of the accounting stay separate:
//   Meal:  Meal Rate = Total Bazar / Total Meals; Meal Cost = Meals x Meal Rate;
//          Meal Paid = own Bazar + meal cash payments (bazar money counts as meal payment)
//          Meal Balance = Meal Cost - Meal Paid
//   Fixed: Fixed Balance = the member's monthly fixed cost - fixed-cost payments
// A negative balance is a credit. Total Due = Meal Balance + Fixed Balance + balance
// carried over from last month, so a meal credit reduces what the member owes.
// store.fixedCosts is only the house's bill list; it is not split among members.
function calculateReport(store) {
  const members = getActiveMembers(store);
  const memberIds = new Set(members.map((member) => member.id));
  const bazarEntries = store.bazarEntries.filter((entry) => memberIds.has(entry.memberId));
  const payments = store.payments.filter((entry) => memberIds.has(entry.memberId));

  const totalBazarCost = sum(bazarEntries, (entry) => entry.amount);
  const totalMeals = sum(members, (member) => store.mealCounts[member.id] || 0);
  const mealRate = totalMeals > 0 ? money(totalBazarCost / totalMeals) : 0;

  const rows = members.map((member) => {
    const memberPayments = payments.filter((entry) => entry.memberId === member.id);
    const mealCount = money(store.mealCounts[member.id] || 0);
    const bazarPaid = sum(bazarEntries.filter((entry) => entry.memberId === member.id), (entry) => entry.amount);
    const mealCost = money(mealCount * mealRate);
    const mealPaid = sum(memberPayments.filter((entry) => entry.kind !== "fixed"), (entry) => entry.amount);
    const mealTotalPaid = money(bazarPaid + mealPaid);
    const mealBalance = money(mealCost - mealTotalPaid);

    const fixedCost = money(member.fixedAmount || 0);
    const fixedPaid = sum(memberPayments.filter((entry) => entry.kind === "fixed"), (entry) => entry.amount);
    const fixedBalance = money(fixedCost - fixedPaid);

    const previousBalance = money(member.openingBalance || 0);
    const balance = money(mealBalance + fixedBalance + previousBalance);

    return {
      memberId: member.id,
      name: member.name,
      role: member.role,
      bazarPaid,
      mealCount,
      mealCost,
      mealPaid,
      mealTotalPaid,
      mealBalance,
      mealDue: money(Math.max(0, mealBalance)),
      fixedCost,
      fixedPaid,
      fixedBalance,
      fixedDue: money(Math.max(0, fixedBalance)),
      previousBalance,
      totalPayable: money(mealCost + fixedCost + previousBalance),
      totalPaid: money(bazarPaid + mealPaid + fixedPaid),
      balance,
      status: balance > 0 ? "owes" : balance < 0 ? "advance" : "settled"
    };
  });

  const fixedCostTotal = sum(store.fixedCosts, (entry) => entry.amount);
  const fixedPaidTotal = sum(rows, (row) => row.fixedPaid);

  return {
    summary: {
      totalMembers: members.length,
      totalBazarCost,
      totalMeals,
      mealRate,
      totalMealCost: sum(rows, (row) => row.mealCost),
      mealPaidTotal: sum(rows, (row) => row.mealPaid),
      mealTotalPaid: sum(rows, (row) => row.mealTotalPaid),
      mealBalanceTotal: sum(rows, (row) => row.mealBalance),
      fixedCostTotal,
      fixedAssignedTotal: sum(rows, (row) => row.fixedCost),
      fixedPaidTotal,
      fixedDueTotal: sum(rows, (row) => row.fixedDue),
      fixedRemaining: money(fixedPaidTotal - fixedCostTotal),
      previousBalanceTotal: sum(rows, (row) => row.previousBalance),
      paymentsTotal: money(fixedPaidTotal + sum(rows, (row) => row.mealPaid)),
      dueTotal: sum(rows.filter((row) => row.balance > 0), (row) => row.balance),
      netBalance: sum(rows, (row) => row.balance)
    },
    rows,
    fixedCosts: store.fixedCosts
  };
}

module.exports = {
  calculateReport,
  money
};
