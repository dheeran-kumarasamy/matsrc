// Route-level tests for GET & POST /api/builder/advance/payments.
// Prisma and the auth context (resolveUserCtx/getOrCreateBuilder) are mocked;
// no real database/network calls. Placed under lib/ to match
// vitest.config.ts's include pattern ("lib/**/*.spec.ts").

import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveUserCtx = vi.fn(async (..._args: unknown[]) => ({
  userId: "user-1",
  email: "builder@example.com",
  name: "Builder",
}));
const getOrCreateBuilder = vi.fn(async (..._args: unknown[]) => ({
  id: "user-1",
  email: "builder@example.com",
  name: "Builder",
}));
const getOrCreateAdvanceAccount = vi.fn();
const generateAdvancePaymentNumber = vi.fn();
const advancePaymentFindMany = vi.fn();
const advancePaymentCreate = vi.fn();
const auditLogCreate = vi.fn();
const notifyAdvancePaymentSubmitted = vi.fn();

vi.mock("@/lib/builder-db", () => ({
  prisma: {
    advancePayment: {
      findMany: (...args: unknown[]) => advancePaymentFindMany(...args),
      create: (...args: unknown[]) => advancePaymentCreate(...args),
    },
    auditLog: {
      create: (...args: unknown[]) => auditLogCreate(...args),
    },
    $transaction: async (callback: (tx: any) => Promise<any>) =>
      callback({
        advancePayment: {
          create: (...args: unknown[]) => advancePaymentCreate(...args),
        },
      }),
  },
  getOrCreateBuilder: (...args: unknown[]) => getOrCreateBuilder(...args),
  resolveUserCtx: (...args: unknown[]) => resolveUserCtx(...args),
}));

vi.mock("@matsrc/db", () => ({
  generateAdvancePaymentNumber: (...args: unknown[]) => generateAdvancePaymentNumber(...args),
  getOrCreateAdvanceAccount: (...args: unknown[]) => getOrCreateAdvanceAccount(...args),
}));

vi.mock("@/lib/notify-advance", () => ({
  notifyAdvancePaymentSubmitted: (...args: unknown[]) => notifyAdvancePaymentSubmitted(...args),
}));

vi.mock("@/lib/payment-proof-validation", () => ({
  validatePaymentProofFile: vi.fn(() => ({ valid: true })),
  buildSafePaymentProofFileName: vi.fn((prefix: string, name: string) => `${prefix}-${name}`),
}));

function makeGetRequest(url = "https://example.com/api/builder/advance/payments"): Request {
  return new Request(url, { method: "GET" });
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveUserCtx.mockResolvedValue({
    userId: "user-1",
    email: "builder@example.com",
    name: "Builder",
  });
  getOrCreateBuilder.mockResolvedValue({
    id: "user-1",
    email: "builder@example.com",
    name: "Builder",
  });
  getOrCreateAdvanceAccount.mockResolvedValue({ id: "acct-1", buyerId: "user-1" });
  generateAdvancePaymentNumber.mockResolvedValue("ADV-202611-0001");
  advancePaymentFindMany.mockResolvedValue([
    {
      id: "pay-1",
      referenceNumber: "ADV-202611-0001",
      amount: 15000,
      paymentMethod: "MANUAL",
      status: "PENDING",
      paymentReference: "UTR123456",
      submittedAt: new Date("2026-11-14T10:00:00Z"),
      approvedAt: null,
      rejectedAt: null,
      rejectionReason: null,
    },
  ]);
  advancePaymentCreate.mockResolvedValue({
    id: "pay-1",
    referenceNumber: "ADV-202611-0001",
    amount: 15000,
    status: "PENDING",
    submittedAt: new Date("2026-11-14T10:00:00Z"),
  });
  auditLogCreate.mockResolvedValue({ id: "audit-1" });
  notifyAdvancePaymentSubmitted.mockResolvedValue(undefined);
});

describe("GET /api/builder/advance/payments", () => {
  it("returns 401 Unauthorized when unauthenticated", async () => {
    resolveUserCtx.mockRejectedValue(new Error("UNAUTHENTICATED"));

    const { GET } = await import("@/app/api/builder/advance/payments/route");
    const res = await GET(makeGetRequest());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
    expect(advancePaymentFindMany).not.toHaveBeenCalled();
  });

  it("handles authenticated requests and converts amounts to numbers", async () => {
    const { GET } = await import("@/app/api/builder/advance/payments/route");
    const res = await GET(makeGetRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.payments).toHaveLength(1);
    expect(body.payments[0].referenceNumber).toBe("ADV-202611-0001");
    expect(body.payments[0].amount).toBe(15000);
  });

  it("enforces customer isolation so buyer cannot access another customer's payments", async () => {
    resolveUserCtx.mockResolvedValue({
      userId: "user-isolated",
      email: "isolated@example.com",
      name: "Isolated Builder",
    });
    getOrCreateBuilder.mockResolvedValue({
      id: "user-isolated",
      email: "isolated@example.com",
      name: "Isolated Builder",
    });

    const { GET } = await import("@/app/api/builder/advance/payments/route");
    await GET(makeGetRequest());

    expect(advancePaymentFindMany).toHaveBeenCalledWith({
      where: { buyerId: "user-isolated" },
      orderBy: { submittedAt: "desc" },
      select: expect.objectContaining({
        id: true,
        referenceNumber: true,
        amount: true,
      }),
    });
  });

  it("returns 500 when database error occurs during findMany", async () => {
    advancePaymentFindMany.mockRejectedValue(new Error("DB failure"));

    const { GET } = await import("@/app/api/builder/advance/payments/route");
    const res = await GET(makeGetRequest());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Failed to fetch advance payments");
  });
});

describe("POST /api/builder/advance/payments", () => {
  function makePostRequest(formData: FormData): Request {
    return new Request("https://example.com/api/builder/advance/payments", {
      method: "POST",
      body: formData,
    });
  }

  it("returns 401 Unauthorized when unauthenticated on POST", async () => {
    resolveUserCtx.mockRejectedValue(new Error("UNAUTHENTICATED"));

    const formData = new FormData();
    formData.append("amount", "5000");
    formData.append("paymentReference", "UTR9999");
    const file = new File(["fake-image"], "proof.jpg", { type: "image/jpeg" });
    formData.append("file", file);

    const { POST } = await import("@/app/api/builder/advance/payments/route");
    const res = await POST(makePostRequest(formData));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
    expect(advancePaymentCreate).not.toHaveBeenCalled();
  });

  it("creates advance payment submission for authenticated customer", async () => {
    const formData = new FormData();
    formData.append("amount", "10000");
    formData.append("paymentReference", "UTR12345678");
    const file = new File(["test-proof-bytes"], "receipt.png", { type: "image/png" });
    formData.append("file", file);

    const { POST } = await import("@/app/api/builder/advance/payments/route");
    const res = await POST(makePostRequest(formData));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.referenceNumber).toBe("ADV-202611-0001");
    expect(body.amount).toBe(15000);
    expect(body.status).toBe("PENDING");
    expect(getOrCreateAdvanceAccount).toHaveBeenCalledWith(expect.anything(), "user-1");
  });

  it("rejects invalid advance amounts", async () => {
    const formData = new FormData();
    formData.append("amount", "0");
    formData.append("paymentReference", "UTR123");
    formData.append("file", new File(["bytes"], "proof.jpg", { type: "image/jpeg" }));

    const { POST } = await import("@/app/api/builder/advance/payments/route");
    const res = await POST(makePostRequest(formData));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Enter a valid advance amount");
  });

  it("rejects amounts with more than 2 decimal places", async () => {
    const formData = new FormData();
    formData.append("amount", "100.123");
    formData.append("paymentReference", "UTR123");
    formData.append("file", new File(["bytes"], "proof.jpg", { type: "image/jpeg" }));

    const { POST } = await import("@/app/api/builder/advance/payments/route");
    const res = await POST(makePostRequest(formData));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Amount cannot have more than 2 decimal places");
  });

  it("rejects missing payment reference", async () => {
    const formData = new FormData();
    formData.append("amount", "5000");
    formData.append("paymentReference", "   ");
    formData.append("file", new File(["bytes"], "proof.jpg", { type: "image/jpeg" }));

    const { POST } = await import("@/app/api/builder/advance/payments/route");
    const res = await POST(makePostRequest(formData));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Payment reference / UTR is required");
  });
});
