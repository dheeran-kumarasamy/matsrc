import { describe, expect, it, vi } from "vitest";
import {
  appendLedgerEntry,
  reconcileAdvanceBalance,
  getOrCreateAdvanceAccount,
  lockAdvanceAccountRow,
  upsertAdvanceReservation,
  consumeAdvanceReservation,
  releaseAdvanceReservation,
  AdvanceReservationError,
} from "./advance-ledger";

function createFakeTx(initialAvailable = 0, initialReserved = 0) {
  const ledger: any[] = [];
  const reservations = new Map<string, any>();
  let available = initialAvailable;
  let reserved = initialReserved;
  let reservationSeq = 0;

  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([
      { id: "acct-1", buyerId: "buyer-1", availableBalance: available, reservedBalance: reserved, status: "ACTIVE" },
    ]),
    customerAdvanceAccount: {
      update: vi.fn(async ({ data }: any) => {
        available = Number(data.availableBalance);
        reserved = Number(data.reservedBalance);
        return { availableBalance: available, reservedBalance: reserved };
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
    advanceReservation: {
      findUnique: vi.fn(async ({ where }: any) => reservations.get(where.orderId) ?? null),
      create: vi.fn(async ({ data }: any) => {
        reservationSeq += 1;
        const row = { id: `res-${reservationSeq}`, consumedAt: null, releasedAt: null, ...data };
        reservations.set(data.orderId, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const existing = reservations.get(where.orderId);
        const updated = { ...existing, ...data };
        reservations.set(where.orderId, updated);
        return updated;
      }),
    },
  };

  return { tx, ledger, reservations, getAvailable: () => available, getReserved: () => reserved };
}

describe("appendLedgerEntry", () => {
  it("credits increase the available balance and create a CREDIT ledger row", async () => {
    const { tx } = createFakeTx(0);

    const result = await appendLedgerEntry(tx as any, {
      accountId: "acct-1",
      type: "CREDIT",
      amount: 50000,
      currentAvailable: 0,
      createdBy: "admin-1",
    });

    expect(result.availableAfter).toBe(50000);
    expect(result.reservedAfter).toBe(0);
    expect(tx.customerAdvanceTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "CREDIT", amount: 50000, balanceAfter: 50000 }) })
    );
    expect(tx.customerAdvanceAccount.update).toHaveBeenCalledWith({
      where: { id: "acct-1" },
      data: { availableBalance: 50000, reservedBalance: 0 },
    });
  });

  it("ADVANCE_RESERVATION moves money from available to reserved without changing the total", async () => {
    const { tx } = createFakeTx(75000, 0);

    const result = await appendLedgerEntry(tx as any, {
      accountId: "acct-1",
      type: "ADVANCE_RESERVATION",
      amount: 20000,
      currentAvailable: 75000,
      currentReserved: 0,
      orderId: "order-1",
      createdBy: "buyer-1",
    });

    expect(result.availableAfter).toBe(55000);
    expect(result.reservedAfter).toBe(20000);
    expect(result.availableAfter + result.reservedAfter).toBe(75000);
  });

  it("ORDER_PAYMENT consumption reduces reserved only — never touches available again", async () => {
    const { tx } = createFakeTx(55000, 20000);

    const result = await appendLedgerEntry(tx as any, {
      accountId: "acct-1",
      type: "ORDER_PAYMENT",
      amount: 20000,
      currentAvailable: 55000,
      currentReserved: 20000,
      orderId: "order-1",
      createdBy: "buyer-1",
    });

    expect(result.availableAfter).toBe(55000);
    expect(result.reservedAfter).toBe(0);
  });

  it("ADVANCE_RELEASE moves money from reserved back to available", async () => {
    const { tx } = createFakeTx(55000, 20000);

    const result = await appendLedgerEntry(tx as any, {
      accountId: "acct-1",
      type: "ADVANCE_RELEASE",
      amount: 20000,
      currentAvailable: 55000,
      currentReserved: 20000,
      orderId: "order-1",
      createdBy: "buyer-1",
    });

    expect(result.availableAfter).toBe(75000);
    expect(result.reservedAfter).toBe(0);
  });

  it("refuses to drive the available balance negative", async () => {
    const { tx } = createFakeTx(10000);

    await expect(
      appendLedgerEntry(tx as any, {
        accountId: "acct-1",
        type: "ADVANCE_RESERVATION",
        amount: 20000,
        currentAvailable: 10000,
        currentReserved: 0,
        createdBy: "buyer-1",
      })
    ).rejects.toThrow(/available balance.*negative/);
  });

  it("refuses to drive the reserved balance negative", async () => {
    const { tx } = createFakeTx(10000, 5000);

    await expect(
      appendLedgerEntry(tx as any, {
        accountId: "acct-1",
        type: "ORDER_PAYMENT",
        amount: 20000,
        currentAvailable: 10000,
        currentReserved: 5000,
        createdBy: "buyer-1",
      })
    ).rejects.toThrow(/reserved balance.*negative/);
  });
});

describe("reconcileAdvanceBalance", () => {
  it("recomputes available and reserved purely from the ledger", async () => {
    const { tx } = createFakeTx(0, 0);

    await appendLedgerEntry(tx as any, { accountId: "acct-1", type: "CREDIT", amount: 100000, currentAvailable: 0, createdBy: "admin-1" });
    await appendLedgerEntry(tx as any, {
      accountId: "acct-1",
      type: "ADVANCE_RESERVATION",
      amount: 35000,
      currentAvailable: 100000,
      currentReserved: 0,
      createdBy: "buyer-1",
    });
    await appendLedgerEntry(tx as any, {
      accountId: "acct-1",
      type: "ORDER_PAYMENT",
      amount: 35000,
      currentAvailable: 65000,
      currentReserved: 35000,
      createdBy: "buyer-1",
    });
    await appendLedgerEntry(tx as any, { accountId: "acct-1", type: "REFUND", amount: 5000, currentAvailable: 65000, createdBy: "admin-1" });

    const reconciled = await reconcileAdvanceBalance(tx as any, "acct-1");
    expect(reconciled.availableBalance).toBe(70000);
    expect(reconciled.reservedBalance).toBe(0);
  });
});
describe("upsertAdvanceReservation", () => {
  it("creates a new ACTIVE reservation, moving available -> reserved", async () => {
    const { tx, getAvailable, getReserved } = createFakeTx(100000, 0);

    const result = await upsertAdvanceReservation(tx as any, {
      accountId: "acct-1",
      buyerId: "buyer-1",
      orderId: "order-1",
      targetAmount: 40000,
      maxReservable: 120000,
      currentAvailable: 100000,
      currentReserved: 0,
      createdBy: "buyer-1",
    });

    expect(result.reservation.status).toBe("ACTIVE");
    expect(result.reservation.amount).toBe(40000);
    expect(getAvailable()).toBe(60000);
    expect(getReserved()).toBe(40000);
    // Total advance value is unchanged by a reservation.
    expect(getAvailable() + getReserved()).toBe(100000);
  });

  it("is idempotent — retrying the exact same amount does not create a duplicate reservation or move money twice", async () => {
    const { tx, getAvailable, getReserved } = createFakeTx(100000, 0);

    await upsertAdvanceReservation(tx as any, {
      accountId: "acct-1",
      buyerId: "buyer-1",
      orderId: "order-1",
      targetAmount: 50000,
      maxReservable: 120000,
      currentAvailable: 100000,
      currentReserved: 0,
      createdBy: "buyer-1",
    });

    const second = await upsertAdvanceReservation(tx as any, {
      accountId: "acct-1",
      buyerId: "buyer-1",
      orderId: "order-1",
      targetAmount: 50000,
      maxReservable: 120000,
      currentAvailable: getAvailable(),
      currentReserved: getReserved(),
      createdBy: "buyer-1",
    });

    expect(second.delta).toBe(0);
    expect(tx.advanceReservation.create).toHaveBeenCalledTimes(1);
    expect(getAvailable()).toBe(50000);
    expect(getReserved()).toBe(50000);
  });

  it("increasing the amount reserves only the additional delta", async () => {
    const { tx, getAvailable, getReserved } = createFakeTx(100000, 0);

    await upsertAdvanceReservation(tx as any, {
      accountId: "acct-1",
      buyerId: "buyer-1",
      orderId: "order-1",
      targetAmount: 30000,
      maxReservable: 120000,
      currentAvailable: 100000,
      currentReserved: 0,
      createdBy: "buyer-1",
    });

    await upsertAdvanceReservation(tx as any, {
      accountId: "acct-1",
      buyerId: "buyer-1",
      orderId: "order-1",
      targetAmount: 40000,
      maxReservable: 120000,
      currentAvailable: getAvailable(),
      currentReserved: getReserved(),
      createdBy: "buyer-1",
    });

    expect(getAvailable()).toBe(60000);
    expect(getReserved()).toBe(40000);
  });

  it("decreasing the amount releases the difference back to available", async () => {
    const { tx, getAvailable, getReserved } = createFakeTx(100000, 0);

    await upsertAdvanceReservation(tx as any, {
      accountId: "acct-1",
      buyerId: "buyer-1",
      orderId: "order-1",
      targetAmount: 50000,
      maxReservable: 120000,
      currentAvailable: 100000,
      currentReserved: 0,
      createdBy: "buyer-1",
    });

    await upsertAdvanceReservation(tx as any, {
      accountId: "acct-1",
      buyerId: "buyer-1",
      orderId: "order-1",
      targetAmount: 30000,
      maxReservable: 120000,
      currentAvailable: getAvailable(),
      currentReserved: getReserved(),
      createdBy: "buyer-1",
    });

    expect(getAvailable()).toBe(70000);
    expect(getReserved()).toBe(30000);
  });

  it("rejects an amount exceeding the order's outstanding amount", async () => {
    const { tx } = createFakeTx(100000, 0);

    await expect(
      upsertAdvanceReservation(tx as any, {
        accountId: "acct-1",
        buyerId: "buyer-1",
        orderId: "order-1",
        targetAmount: 50000,
        maxReservable: 40000,
        currentAvailable: 100000,
        currentReserved: 0,
        createdBy: "buyer-1",
      })
    ).rejects.toThrow(AdvanceReservationError);
  });

  it("rejects an amount exceeding the available balance", async () => {
    const { tx } = createFakeTx(10000, 0);

    await expect(
      upsertAdvanceReservation(tx as any, {
        accountId: "acct-1",
        buyerId: "buyer-1",
        orderId: "order-1",
        targetAmount: 50000,
        maxReservable: 120000,
        currentAvailable: 10000,
        currentReserved: 0,
        createdBy: "buyer-1",
      })
    ).rejects.toThrow(/available balance/);
  });

  it("rejects modifying an already-CONSUMED reservation", async () => {
    const { tx } = createFakeTx(100000, 0);

    await upsertAdvanceReservation(tx as any, {
      accountId: "acct-1",
      buyerId: "buyer-1",
      orderId: "order-1",
      targetAmount: 50000,
      maxReservable: 120000,
      currentAvailable: 100000,
      currentReserved: 0,
      createdBy: "buyer-1",
    });
    await consumeAdvanceReservation(tx as any, {
      orderId: "order-1",
      createdBy: "admin-1",
      currentAvailable: 50000,
      currentReserved: 50000,
    });

    await expect(
      upsertAdvanceReservation(tx as any, {
        accountId: "acct-1",
        buyerId: "buyer-1",
        orderId: "order-1",
        targetAmount: 10000,
        maxReservable: 120000,
        currentAvailable: 50000,
        currentReserved: 0,
        createdBy: "buyer-1",
      })
    ).rejects.toThrow(/already been consumed/);
  });

  it("allows creating a fresh reservation after a prior one for the same order was released (retry)", async () => {
    const { tx, getAvailable, getReserved } = createFakeTx(100000, 0);

    await upsertAdvanceReservation(tx as any, {
      accountId: "acct-1",
      buyerId: "buyer-1",
      orderId: "order-1",
      targetAmount: 50000,
      maxReservable: 120000,
      currentAvailable: 100000,
      currentReserved: 0,
      createdBy: "buyer-1",
    });
    await releaseAdvanceReservation(tx as any, {
      orderId: "order-1",
      createdBy: "admin-1",
      currentAvailable: 50000,
      currentReserved: 50000,
    });

    expect(getAvailable()).toBe(100000);
    expect(getReserved()).toBe(0);

    const retried = await upsertAdvanceReservation(tx as any, {
      accountId: "acct-1",
      buyerId: "buyer-1",
      orderId: "order-1",
      targetAmount: 50000,
      maxReservable: 120000,
      currentAvailable: 100000,
      currentReserved: 0,
      createdBy: "buyer-1",
    });

    expect(retried.reservation.status).toBe("ACTIVE");
    expect(getAvailable()).toBe(50000);
    expect(getReserved()).toBe(50000);
    expect(tx.advanceReservation.create).toHaveBeenCalledTimes(1); // row reused, not duplicated
  });
});

describe("consumeAdvanceReservation", () => {
  it("consumes an ACTIVE reservation, moving reserved -> 0 and writing ORDER_PAYMENT", async () => {
    const { tx, ledger, getAvailable, getReserved } = createFakeTx(100000, 0);

    await upsertAdvanceReservation(tx as any, {
      accountId: "acct-1",
      buyerId: "buyer-1",
      orderId: "order-1",
      targetAmount: 40000,
      maxReservable: 120000,
      currentAvailable: 100000,
      currentReserved: 0,
      createdBy: "buyer-1",
    });

    const result = await consumeAdvanceReservation(tx as any, {
      orderId: "order-1",
      createdBy: "admin-1",
      currentAvailable: getAvailable(),
      currentReserved: getReserved(),
    });

    expect(result?.reservation.status).toBe("CONSUMED");
    expect(result?.amount).toBe(40000);
    expect(getAvailable()).toBe(60000); // unchanged by consumption
    expect(getReserved()).toBe(0);

    const ledgerTypes = ledger.map((row: any) => row.type);
    expect(ledgerTypes).toContain("ORDER_PAYMENT");
  });

  it("is idempotent — consuming twice does not double-debit", async () => {
    const { tx, getAvailable, getReserved } = createFakeTx(100000, 0);

    await upsertAdvanceReservation(tx as any, {
      accountId: "acct-1",
      buyerId: "buyer-1",
      orderId: "order-1",
      targetAmount: 40000,
      maxReservable: 120000,
      currentAvailable: 100000,
      currentReserved: 0,
      createdBy: "buyer-1",
    });

    await consumeAdvanceReservation(tx as any, {
      orderId: "order-1",
      createdBy: "admin-1",
      currentAvailable: getAvailable(),
      currentReserved: getReserved(),
    });

    const second = await consumeAdvanceReservation(tx as any, {
      orderId: "order-1",
      createdBy: "admin-1",
      currentAvailable: getAvailable(),
      currentReserved: getReserved(),
    });

    expect(second).toBeNull();
    expect(getAvailable()).toBe(60000);
    expect(getReserved()).toBe(0);
  });

  it("is a no-op when no reservation exists for the order", async () => {
    const { tx } = createFakeTx(100000, 0);

    const result = await consumeAdvanceReservation(tx as any, {
      orderId: "order-without-reservation",
      createdBy: "admin-1",
      currentAvailable: 100000,
      currentReserved: 0,
    });

    expect(result).toBeNull();
  });
});

describe("releaseAdvanceReservation", () => {
  it("releases an ACTIVE reservation, restoring available and writing ADVANCE_RELEASE", async () => {
    const { tx, ledger, getAvailable, getReserved } = createFakeTx(100000, 0);

    await upsertAdvanceReservation(tx as any, {
      accountId: "acct-1",
      buyerId: "buyer-1",
      orderId: "order-1",
      targetAmount: 40000,
      maxReservable: 120000,
      currentAvailable: 100000,
      currentReserved: 0,
      createdBy: "buyer-1",
    });

    const result = await releaseAdvanceReservation(tx as any, {
      orderId: "order-1",
      createdBy: "admin-1",
      currentAvailable: getAvailable(),
      currentReserved: getReserved(),
    });

    expect(result?.reservation.status).toBe("RELEASED");
    expect(getAvailable()).toBe(100000);
    expect(getReserved()).toBe(0);

    const ledgerTypes = ledger.map((row: any) => row.type);
    expect(ledgerTypes).toContain("ADVANCE_RELEASE");
  });

  it("is idempotent — releasing twice does not double-credit", async () => {
    const { tx, getAvailable, getReserved } = createFakeTx(100000, 0);

    await upsertAdvanceReservation(tx as any, {
      accountId: "acct-1",
      buyerId: "buyer-1",
      orderId: "order-1",
      targetAmount: 40000,
      maxReservable: 120000,
      currentAvailable: 100000,
      currentReserved: 0,
      createdBy: "buyer-1",
    });

    await releaseAdvanceReservation(tx as any, {
      orderId: "order-1",
      createdBy: "admin-1",
      currentAvailable: getAvailable(),
      currentReserved: getReserved(),
    });

    const second = await releaseAdvanceReservation(tx as any, {
      orderId: "order-1",
      createdBy: "admin-1",
      currentAvailable: getAvailable(),
      currentReserved: getReserved(),
    });

    expect(second).toBeNull();
    expect(getAvailable()).toBe(100000);
  });

  it("is a no-op when no reservation exists for the order", async () => {
    const { tx } = createFakeTx(100000, 0);

    const result = await releaseAdvanceReservation(tx as any, {
      orderId: "order-without-reservation",
      createdBy: "admin-1",
      currentAvailable: 100000,
      currentReserved: 0,
    });

    expect(result).toBeNull();
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
