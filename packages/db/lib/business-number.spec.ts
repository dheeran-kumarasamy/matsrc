import { describe, expect, it, vi } from "vitest";
import {
  getFinancialYearMonth,
  generateBusinessNumber,
  generateEnquiryNumber,
  generateOrderNumber,
  generateInvoiceNumber,
  generateAdvancePaymentNumber,
  validateBusinessNumber,
  allocateBusinessNumbers,
  allocateEnquiryNumbers,
} from "./business-number";

function createFakeTx() {
  const sequences = new Map<string, number>();

  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    businessSequence: {
      upsert: vi.fn(async ({ where, create }: any) => {
        if (!sequences.has(where.id)) {
          sequences.set(where.id, create.value ?? 0);
        }
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const current = sequences.get(where.id) ?? 0;
        const next = current + (data.value?.increment ?? 1);
        sequences.set(where.id, next);
        return { value: next };
      }),
    },
  };

  return { tx, sequences };
}

describe("Financial Year Calculation", () => {
  it("correctly calculates FY and month codes", () => {
    expect(getFinancialYearMonth(new Date(2026, 3, 1)).yymm).toBe("2601"); // April 2026
    expect(getFinancialYearMonth(new Date(2026, 4, 15)).yymm).toBe("2602"); // May 2026
    expect(getFinancialYearMonth(new Date(2026, 11, 25)).yymm).toBe("2609"); // Dec 2026
    expect(getFinancialYearMonth(new Date(2027, 0, 15)).yymm).toBe("2610"); // Jan 2027
    expect(getFinancialYearMonth(new Date(2027, 1, 20)).yymm).toBe("2611"); // Feb 2027
    expect(getFinancialYearMonth(new Date(2027, 2, 31)).yymm).toBe("2612"); // Mar 2027
    expect(getFinancialYearMonth(new Date(2027, 3, 1)).yymm).toBe("2701"); // Apr 2027
  });
});

describe("Business Number Validation", () => {
  it("validates EQ, OD, IN and AP business number formats", () => {
    expect(validateBusinessNumber("EQ", "EQ/2601/00001")).toBe(true);
    expect(validateBusinessNumber("OD", "OD/2601/00001")).toBe(true);
    expect(validateBusinessNumber("IN", "IN/2601/00001")).toBe(true);
    expect(validateBusinessNumber("AP", "AP/2601/00001")).toBe(true);
    expect(validateBusinessNumber("EQ", "INVALID")).toBe(false);
    expect(validateBusinessNumber("AP", "EQ/2601/00001")).toBe(false);
  });
});

describe("AP Business Number Generation", () => {
  it("generates AP/YYMM/SSSSS formatted numbers using its own independent sequence", async () => {
    const { tx } = createFakeTx();
    const date = new Date(2026, 3, 1);

    const first = await generateAdvancePaymentNumber(tx as any, date);
    const second = await generateAdvancePaymentNumber(tx as any, date);

    expect(first).toBe("AP/2601/00001");
    expect(second).toBe("AP/2601/00002");
  });

  it("maintains an AP counter independent of EQ/OD/IN", async () => {
    const { tx } = createFakeTx();
    const date = new Date(2026, 3, 1);

    const eq1 = await generateEnquiryNumber(tx as any, date);
    const od1 = await generateOrderNumber(tx as any, date);
    const in1 = await generateInvoiceNumber(tx as any, date);
    const ap1 = await generateAdvancePaymentNumber(tx as any, date);
    const ap2 = await generateAdvancePaymentNumber(tx as any, date);

    expect(eq1).toBe("EQ/2601/00001");
    expect(od1).toBe("OD/2601/00001");
    expect(in1).toBe("IN/2601/00001");
    expect(ap1).toBe("AP/2601/00001");
    expect(ap2).toBe("AP/2601/00002");
  });
});

describe("EQ Business Number Generation", () => {
  it("generates EQ/YYMM/SSSSS formatted numbers", async () => {
    const { tx } = createFakeTx();
    const date = new Date(2026, 3, 1);

    const first = await generateEnquiryNumber(tx as any, date);
    const second = await generateEnquiryNumber(tx as any, date);

    expect(first).toBe("EQ/2601/00001");
    expect(second).toBe("EQ/2601/00002");
  });
});

describe("OD Business Number Generation", () => {
  it("generates OD/YYMM/SSSSS formatted numbers", async () => {
    const { tx } = createFakeTx();
    const date = new Date(2026, 3, 1);

    const first = await generateOrderNumber(tx as any, date);
    const second = await generateOrderNumber(tx as any, date);

    expect(first).toBe("OD/2601/00001");
    expect(second).toBe("OD/2601/00002");
  });
});

describe("IN Business Number Generation", () => {
  it("generates IN/YYMM/SSSSS formatted numbers", async () => {
    const { tx } = createFakeTx();
    const date = new Date(2026, 3, 1);

    const first = await generateInvoiceNumber(tx as any, date);
    const second = await generateInvoiceNumber(tx as any, date);

    expect(first).toBe("IN/2601/00001");
    expect(second).toBe("IN/2601/00002");
  });
});

describe("Three Independent Sequences", () => {
  it("maintains independent counters for EQ, OD, and IN within the same financial year", async () => {
    const { tx } = createFakeTx();
    const date = new Date(2026, 3, 1);

    // Increment EQ multiple times
    await generateEnquiryNumber(tx as any, date);
    await generateEnquiryNumber(tx as any, date);
    await generateEnquiryNumber(tx as any, date);
    await generateEnquiryNumber(tx as any, date);
    const eq5 = await generateEnquiryNumber(tx as any, date);

    // Generate first OD and IN
    const od1 = await generateOrderNumber(tx as any, date);
    const in1 = await generateInvoiceNumber(tx as any, date);

    expect(eq5).toBe("EQ/2601/00005");
    expect(od1).toBe("OD/2601/00001");
    expect(in1).toBe("IN/2601/00001");
  });
});

describe("Month Continuity", () => {
  it("continues serial sequence across months within the same financial year", async () => {
    const { tx } = createFakeTx();

    const april = await generateEnquiryNumber(tx as any, new Date(2026, 3, 1));
    const may = await generateEnquiryNumber(tx as any, new Date(2026, 4, 15));
    const june = await generateEnquiryNumber(tx as any, new Date(2026, 5, 20));

    expect(april).toBe("EQ/2601/00001");
    expect(may).toBe("EQ/2602/00002");
    expect(june).toBe("EQ/2603/00003");
  });
});

describe("New Financial Year Boundary", () => {
  it("resets serial to 00001 when moving to a new financial year", async () => {
    const { tx, sequences } = createFakeTx();

    // Set sequence in FY 26 to 100
    sequences.set("EQ_26", 99);
    const march2027 = await generateEnquiryNumber(tx as any, new Date(2027, 2, 31)); // FY 2612
    expect(march2027).toBe("EQ/2612/00100");

    // April 2027 is a new FY (FY 2701)
    const april2027 = await generateEnquiryNumber(tx as any, new Date(2027, 3, 1));
    expect(april2027).toBe("EQ/2701/00001");
  });
});

describe("Enquiry -> Order -> Invoice Conversions", () => {
  it("preserves EQ number when generating an independent OD number on order confirmation", async () => {
    const { tx } = createFakeTx();
    const date = new Date(2026, 3, 1);

    const eqNumber = await generateEnquiryNumber(tx as any, date); // EQ/2601/00001
    expect(eqNumber).toBe("EQ/2601/00001");

    // Order gets independent OD number
    const odNumber = await generateOrderNumber(tx as any, date); // OD/2601/00001
    expect(odNumber).toBe("OD/2601/00001");

    // EQ number is unaffected and retains its value
    expect(eqNumber).toBe("EQ/2601/00001");
  });

  it("generates an independent IN number for an invoice", async () => {
    const { tx } = createFakeTx();
    const date = new Date(2026, 3, 1);

    const eqNumber = await generateEnquiryNumber(tx as any, date);
    const odNumber = await generateOrderNumber(tx as any, date);
    const inNumber = await generateInvoiceNumber(tx as any, date);

    expect(eqNumber).toBe("EQ/2601/00001");
    expect(odNumber).toBe("OD/2601/00001");
    expect(inNumber).toBe("IN/2601/00001");
  });
});

describe("Batch Enquiry Number Allocation (P0 Optimization)", () => {
  it("allocates N sequential enquiry numbers in a single atomic increment", async () => {
    const { tx } = createFakeTx();
    const date = new Date(2026, 3, 1);

    const allocated = await allocateEnquiryNumbers(tx, 3, date);
    expect(allocated).toEqual([
      "EQ/2601/00001",
      "EQ/2601/00002",
      "EQ/2601/00003",
    ]);

    // Subsequent single allocation picks up right after the allocated batch
    const nextSingle = await generateEnquiryNumber(tx as any, date);
    expect(nextSingle).toBe("EQ/2601/00004");
  });

  it("returns an empty array when count is zero or negative", async () => {
    const { tx } = createFakeTx();
    const date = new Date(2026, 3, 1);

    const zero = await allocateEnquiryNumbers(tx, 0, date);
    const negative = await allocateEnquiryNumbers(tx, -5, date);

    expect(zero).toEqual([]);
    expect(negative).toEqual([]);
  });

  it("handles concurrent checkout allocations without overlap or duplicate numbers", async () => {
    const { tx } = createFakeTx();
    const date = new Date(2026, 3, 1);

    // Simulate 5 simultaneous checkouts with varying supplier group counts
    const counts = [2, 1, 3, 2, 1]; // Total = 9
    const results = await Promise.all(
      counts.map((count) => allocateEnquiryNumbers(tx, count, date))
    );

    const allAllocated = results.flat();
    expect(allAllocated).toHaveLength(9);

    // Verify all 9 enquiry numbers are completely unique
    const uniqueNumbers = new Set(allAllocated);
    expect(uniqueNumbers.size).toBe(9);

    // Verify every number matches the EQ business number specification
    allAllocated.forEach((num) => {
      expect(validateBusinessNumber("EQ", num)).toBe(true);
    });

    // Verify range spans exactly 00001 through 00009
    expect(allAllocated[0]).toBe("EQ/2601/00001");
    expect(allAllocated[allAllocated.length - 1]).toBe("EQ/2601/00009");
  });
});
