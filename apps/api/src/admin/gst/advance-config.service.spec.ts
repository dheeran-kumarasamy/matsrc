import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AdvanceConfigService } from "./advance-config.service";

function buildService(existing: any = null) {
  const prisma: any = {
    advanceConfig: {
      findUnique: vi.fn().mockResolvedValue(existing),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...data })),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "global", ...existing, ...data })),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const service = new AdvanceConfigService(prisma as any);
  return { service, prisma };
}

describe("AdvanceConfigService.get / upsert — singleton behavior", () => {
  it("creates the singleton row using the canonical 'global' id when none exists", async () => {
    const { service, prisma } = buildService(null);
    const saved = await service.upsert(20, true, "admin-1");
    expect(prisma.advanceConfig.create).toHaveBeenCalledWith({
      data: { id: "global", percentage: 20, isEnabled: true, updatedBy: "admin-1" },
    });
    expect(saved.id).toBe("global");
  });

  it("updates the existing singleton row rather than creating a second one", async () => {
    const { service, prisma } = buildService({ id: "global", percentage: 10, isEnabled: true });
    await service.upsert(25, true, "admin-1");
    expect(prisma.advanceConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "global" } })
    );
    expect(prisma.advanceConfig.create).not.toHaveBeenCalled();
  });

  it("logs ADVANCE_CONFIG_CREATED on first configuration and ADVANCE_CONFIG_UPDATED thereafter", async () => {
    const { service: createService, prisma: createPrisma } = buildService(null);
    await createService.upsert(20, true, "admin-1");
    expect(createPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "ADVANCE_CONFIG_CREATED" }) })
    );

    const { service: updateService, prisma: updatePrisma } = buildService({ id: "global", percentage: 10, isEnabled: true });
    await updateService.upsert(25, true, "admin-1");
    expect(updatePrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "ADVANCE_CONFIG_UPDATED" }) })
    );
  });

  it("rejects a negative or non-finite percentage", async () => {
    const { service } = buildService(null);
    await expect(service.upsert(-10, true, "admin-1")).rejects.toThrow(BadRequestException);
    await expect(service.upsert(NaN, true, "admin-1")).rejects.toThrow(BadRequestException);
    await expect(service.upsert(Infinity, true, "admin-1")).rejects.toThrow(BadRequestException);
  });

  it("accepts an explicit 0% as a valid configuration", async () => {
    const { service } = buildService(null);
    const saved = await service.upsert(0, true, "admin-1");
    expect(saved.percentage).toBe(0);
  });

  it("defaults isEnabled to true when omitted", async () => {
    const { service, prisma } = buildService(null);
    await service.upsert(20, undefined, "admin-1");
    expect(prisma.advanceConfig.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isEnabled: true }) })
    );
  });

  it("supports disabling via isEnabled: false without rejecting the write", async () => {
    const { service, prisma } = buildService(null);
    await service.upsert(20, false, "admin-1");
    expect(prisma.advanceConfig.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isEnabled: false }) })
    );
  });
});
