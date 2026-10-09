import { describe, expect, it, vi } from "vitest";
import { appendLedgerEntry, reconcileAdvanceBalance, getOrCreateAdvanceAccount, lockAdvanceAccountRow } from "./advance-ledger";

function createFakeTx(initialBalance = 0) {
  const ledger: any[] = [];
  let balance = initialBalance;

  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "acct-1", buyerId: "buyer-1", availableBalance: balance, status: "ACTIVE" }]),
    customerAdvanceAccount: {
      update: vi.fn(async ({ data }: any) => {
        balance = Number(data.availableBalance);
        return { availableBalance: balance };
      }),
    },
    customerAdvanceTransaction: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `tx-${ledger.length + 1}`, ...data };
        ledger.push(row);
        return row;
      }),
      findMany: vi.fn(async () => ledger.map((row) => ({ type: row.type, amount: row.amount }))),
    },
  };

  return { tx, ledger, getBalance: () => balance };
}

describe("appendLedgerEntry", () => {
  it("credits increase the balance and create a CREDIT ledger row", async () => {
    const { tx } = createFakeTx(0);

    const result = await appendLedgerEntry(tx as any, {
      accountId: "acct-1",
      type: "CREDIT",
      amount: 50000,
      currentBalance: 0,
      createdBy: "admin-1",
    });

    expect(result.balanceAfter).toBe(50000);
    expect(tx.customerAdvanceTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "CREDIT", amount: 50000, balanceAfter: 50000 }) })
    );
    expect(tx.customerAdvanceAccount.update).toHaveBeenCalledWith({
      where: { id: "acct-1" },
      data: { availableBalance: 50000 },
    });
  });

  it("ORDER_PAYMENT debits decrease the balance", async () => {
    const { tx } = createFakeTx(75000);

    const result = await appendLedgerEntry(tx as any, {
      accountId: "acct-1",
      type: "ORDER_PAYMENT",
      amount: 20000,
      currentBalance: 75000,
      orderId: "order-1",
      createdBy: "buyer-1",
    });

    expect(result.balanceAfter).toBe(55000);
  });

  it("refuses to drive the balance negative", async () => {
    const { tx } = createFakeTx(10000);

    await expect(
      appendLedgerEntry(tx as any, {
        accountId: "acct-1",
        type: "ORDER_PAYMENT",
        amount: 20000,
        currentBalance: 10000,
        createdBy: "buyer-1",
      })
    ).rejects.toThrow(/negative/);
  });
});

describe("reconcileAdvanceBalance", () => {
  it("recomputes the balance purely from the ledger", async () => {
    const { tx } = createFakeTx(0);

    await appendLedgerEntry(tx as any, { accountId: "acct-1", type: "CREDIT", amount: 100000, currentBalance: 0, createdBy: "admin-1" });
    await appendLedgerEntry(tx as any, { accountId: "acct-1", type: "ORDER_PAYMENT", amount: 35000, currentBalance: 100000, createdBy: "buyer-1" });
    await appendLedgerEntry(tx as any, { accountId: "acct-1", type: "ORDER_PAYMENT", amount: 20000, currentBalance: 65000, createdBy: "buyer-1" });
    await appendLedgerEntry(tx as any, { accountId: "acct-1", type: "REFUND", amount: 5000, currentBalance: 45000, createdBy: "admin-1" });

    const reconciled = await reconcileAdvanceBalance(tx as any, "acct-1");
    expect(reconciled).toBe(50000);
  });
});

describe("getOrCreateAdvanceAccount", () => {
  it("returns the existing account when one already exists", async () => {
    const prisma = {
      customerAdvanceAccount: {
        findUnique: vi.fn().mockResolvedValue({ id: "acct-1", buyerId: "buyer-1", status: "ACTIVE" }),
        create: vi.fn(),
      },
    };

    const account = await getOrCreateAdvanceAccount(prisma as any, "buyer-1");
    expect(account.id).toBe("acct-1");
    expect(prisma.customerAdvanceAccount.create).not.toHaveBeenCalled();
  });

  it("lazily creates an account on first use", async () => {
    const prisma = {
      customerAdvanceAccount: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "acct-new", buyerId: "buyer-2", status: "ACTIVE" }),
      },
    };

    const account = await getOrCreateAdvanceAccount(prisma as any, "buyer-2");
    expect(account.id).toBe("acct-new");
    expect(prisma.customerAdvanceAccount.create).toHaveBeenCalledWith({ data: { buyerId: "buyer-2" } });
  });
});

describe("lockAdvanceAccountRow", () => {
  it("throws when the account does not exist", async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([]) };
    await expect(lockAdvanceAccountRow(tx as any, "missing")).rejects.toThrow(/not found/);
  });
});
