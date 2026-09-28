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

function getFixedAllocation(cost, members) {
  const allocation = {};
  const activeMembers = members.filter((member) => member.active !== false);

  for (const member of activeMembers) {
    allocation[member.id] = 0;
  }

  if (!activeMembers.length) {
    return allocation;
  }

  if (cost.splitType === "custom") {
    for (const member of activeMembers) {
      allocation[member.id] = money(cost.allocations?.[member.id] || 0);
    }
    return allocation;
  }

  const share = money(cost.amount / activeMembers.length);
  for (const member of activeMembers) {
    allocation[member.id] = share;
  }

  const assigned = sum(Object.values(allocation), (amount) => amount);
  const remainder = money(cost.amount - assigned);
  if (remainder !== 0) {
    allocation[activeMembers[0].id] = money(allocation[activeMembers[0].id] + remainder);
  }

  return allocation;
}

function calculateReport(store) {
  const members = getActiveMembers(store);
  const memberIds = new Set(members.map((member) => member.id));
  const bazarEntries = store.bazarEntries.filter((entry) => memberIds.has(entry.memberId));
  const individualCosts = store.individualCosts.filter((entry) => memberIds.has(entry.memberId) && entry.category !== "house-rent");
  const payments = store.payments.filter((entry) => memberIds.has(entry.memberId));

  const totalBazarCost = sum(bazarEntries, (entry) => entry.amount);
  const totalMeals = sum(members, (member) => store.mealCounts[member.id] || 0);
  const mealRate = totalMeals > 0 ? money(totalBazarCost / totalMeals) : 0;

  const fixedAllocations = {};
  const fixedCostRows = store.fixedCosts.map((cost) => {
    const allocations = getFixedAllocation(cost, members);
    for (const [memberId, amount] of Object.entries(allocations)) {
      fixedAllocations[memberId] = money((fixedAllocations[memberId] || 0) + amount);
    }
    return {
      ...cost,
      allocations
    };
  });

  const rows = members.map((member) => {
    const mealCount = money(store.mealCounts[member.id] || 0);
    const bazarPaid = sum(bazarEntries.filter((entry) => entry.memberId === member.id), (entry) => entry.amount);
    const rentCost = money(member.rentAmount || 0);
    const rentPaid = money(member.rentPaid || 0);
    const otherPaid = money(sum(payments.filter((entry) => entry.memberId === member.id), (entry) => entry.amount) + rentPaid);
    const fixedCost = money(fixedAllocations[member.id] || 0);
    const individualCost = money(sum(individualCosts.filter((entry) => entry.memberId === member.id), (entry) => entry.amount) + rentCost);
    const mealCost = money(mealCount * mealRate);
    const totalPayable = money(mealCost + fixedCost + individualCost);
    const totalPaid = money(bazarPaid + otherPaid);
    const balance = money(totalPayable - totalPaid);

    return {
      memberId: member.id,
      name: member.name,
      role: member.role,
      mealCount,
      mealCost,
      fixedCost,
      individualCost,
      totalPayable,
      bazarPaid,
      otherPaid,
      totalPaid,
      balance,
      status: balance > 0 ? "owes" : balance < 0 ? "advance" : "settled"
    };
  });

  return {
    summary: {
      totalMembers: members.length,
      totalBazarCost,
      totalMeals,
      mealRate,
      fixedCostTotal: sum(store.fixedCosts, (entry) => entry.amount),
      individualCostTotal: money(sum(individualCosts, (entry) => entry.amount) + sum(members, (member) => member.rentAmount || 0)),
      rentPaidTotal: sum(members, (member) => member.rentPaid || 0),
      otherPaidTotal: money(sum(payments, (entry) => entry.amount) + sum(members, (member) => member.rentPaid || 0)),
      payableTotal: sum(rows, (row) => row.totalPayable),
      paidTotal: sum(rows, (row) => row.totalPaid),
      dueTotal: sum(rows.filter((row) => row.balance > 0), (row) => row.balance),
      netBalance: sum(rows, (row) => row.balance)
    },
    rows,
    fixedCosts: fixedCostRows,
    settlement: calculateSettlement(rows)
  };
}

function calculateSettlement(rows) {
  const debtors = rows
    .filter((row) => row.balance > 0)
    .map((row) => ({ memberId: row.memberId, name: row.name, amount: money(row.balance) }))
    .sort((a, b) => b.amount - a.amount);
  const creditors = rows
    .filter((row) => row.balance < 0)
    .map((row) => ({ memberId: row.memberId, name: row.name, amount: money(Math.abs(row.balance)) }))
    .sort((a, b) => b.amount - a.amount);

  const settlements = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount = money(Math.min(debtor.amount, creditor.amount));

    if (amount > 0) {
      settlements.push({
        fromMemberId: debtor.memberId,
        from: debtor.name,
        toMemberId: creditor.memberId,
        to: creditor.name,
        amount
      });
    }

    debtor.amount = money(debtor.amount - amount);
    creditor.amount = money(creditor.amount - amount);

    if (debtor.amount <= 0) {
      debtorIndex += 1;
    }
    if (creditor.amount <= 0) {
      creditorIndex += 1;
    }
  }

  return settlements;
}

module.exports = {
  calculateReport,
  money
};
