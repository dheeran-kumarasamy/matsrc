import { Injectable, BadRequestException, NotFoundException, Logger } from "@nestjs/common";
import { OrderStatus, PaymentMethod, PaymentStatus } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { formatCurrency, formatDate, humanizeToken } from "src/supplier/utils";
import { BuilderContextService } from "src/builder/builder-context.service";
import { CreateOrderDto } from "./dto/create-order.dto";
import { NotificationService } from "src/notifications/notification.service";
import { UpsertOrderRatingDto } from "./dto/upsert-order-rating.dto";

function resolveUnitPrice(product: any, quantity: number) {
  const tiers = Array.isArray(product.pricingTiers) ? product.pricingTiers : [];
  const matchedTier = tiers.find((tier: any) => quantity >= tier.minQty && quantity <= tier.maxQty);
  return Number(matchedTier?.tierPrice ?? product.basePrice);
}

function getPaymentLink(orderId: string) {
  return `/orders/${orderId}/payment`;
}

@Injectable()
export class BuilderOrdersService {
  private readonly logger = new Logger(BuilderOrdersService.name);
  private static readonly RATING_EDIT_WINDOW_MS = 72 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly builderContext: BuilderContextService,
    private readonly notificationService: NotificationService
  ) {}

  async findAll(userCtx: any) {
    const { user } = await this.builderContext.getOrCreateBuilder(userCtx.userId, userCtx.email, userCtx.name);

    const orders = await this.prisma.order.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        totalAmount: true,
        createdAt: true,
        items: {
          select: {
            id: true,
            product: {
              select: {
                supplier: {
                  select: {
                    companyName: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return orders.map((order) => ({
      id: order.id,
      status: order.status,
      paymentStatus: order.paymentStatus,
      itemCount: order.items.length,
      total: Number(order.totalAmount),
      totalLabel: formatCurrency(order.totalAmount.toString()),
      createdAt: order.createdAt,
      supplierName: order.items[0]?.product.supplier.companyName ?? "Supplier",
      paymentLinkAvailable: order.status === OrderStatus.PROCESSING && order.paymentStatus === PaymentStatus.PENDING,
      paymentLink: getPaymentLink(order.id),
    }));
  }

  async findOne(userCtx: any, id: string) {
    const { user } = await this.builderContext.getOrCreateBuilder(userCtx.userId, userCtx.email, userCtx.name);

    const order = await this.prisma.order.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        status: true,
        paymentMethod: true,
        paymentStatus: true,
        totalAmount: true,
        deliveryDate: true,
        items: {
          select: {
            id: true,
            quantity: true,
            unitPrice: true,
            product: {
              select: {
                name: true,
                unit: true,
                supplier: {
                  select: {
                    companyName: true,
                  },
                },
              },
            },
          },
        },
        tracking: {
          select: {
            id: true,
            status: true,
            note: true,
            recordedAt: true,
          },
          orderBy: { recordedAt: "asc" },
        },
      },
    });

    if (!order) {
      throw new NotFoundException("Order not found");
    }

    return {
      id: order.id,
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      paymentLinkAvailable: order.status === OrderStatus.PROCESSING && order.paymentStatus === PaymentStatus.PENDING,
      paymentLink: getPaymentLink(order.id),
      total: Number(order.totalAmount),
      totalLabel: formatCurrency(order.totalAmount.toString()),
      deliveryDate: formatDate(order.deliveryDate),
      supplierName: order.items[0]?.product.supplier.companyName ?? "Supplier",
      items: order.items.map((item) => ({
        id: item.id,
        name: item.product.name,
        quantity: item.quantity,
        unit: item.product.unit,
        unitPrice: Number(item.unitPrice),
      })),
      tracking: order.tracking.map((step) => ({
        id: step.id,
        status: step.status,
        label: step.note || humanizeToken(step.status),
        recordedAt: step.recordedAt,
      })),
    };
  }

  async create(userCtx: any, dto: CreateOrderDto) {
    const { user } = await this.builderContext.getOrCreateBuilder(userCtx.userId, userCtx.email, userCtx.name);

    const cartItems = await this.prisma.cartItem.findMany({
      where: { userId: user.id },
      include: {
        product: {
          include: {
            supplier: true,
            pricingTiers: { orderBy: { minQty: "asc" } },
          },
        },
      },
    });

    if (!cartItems.length) {
      throw new BadRequestException("Cart is empty");
    }

    const groupedItems = new Map<
      string,
      {
        supplierId: string;
        supplierName: string;
        items: Array<{ productId: string; quantity: number; unitPrice: number }>;
      }
    >();

    for (const item of cartItems) {
      const unitPrice = resolveUnitPrice(item.product, item.quantity);
      const currentGroup = groupedItems.get(item.product.supplierId) ?? {
        supplierId: item.product.supplierId,
        supplierName: item.product.supplier.companyName,
        items: [],
      };

      currentGroup.items.push({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice,
      });

      groupedItems.set(item.product.supplierId, currentGroup);
    }

    const createdOrders: Array<{ id: string; supplierName: string; total: number; itemCount: number; status: OrderStatus }> = [];

    for (const group of groupedItems.values()) {
      const totalAmount = group.items.reduce((acc, item) => acc + item.unitPrice * item.quantity, 0);

      const order = await this.prisma.order.create({
        data: {
          userId: user.id,
          paymentMethod: dto.paymentMethod ?? PaymentMethod.BANK_TRANSFER,
          status: OrderStatus.PLACED,
          paymentStatus: PaymentStatus.PENDING,
          totalAmount,
          deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
          items: {
            create: group.items.map((item) => ({
              productId: item.productId,
              supplierId: group.supplierId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
            })),
          },
          tracking: {
            create: {
              status: OrderStatus.PLACED,
              note: "Pending supplier confirmation",
            },
          },
        },
        select: {
          id: true,
          totalAmount: true,
          status: true,
          items: {
            select: {
              id: true,
            },
          },
        },
      });

      createdOrders.push({
        id: order.id,
        supplierName: group.supplierName,
        total: Number(order.totalAmount),
        itemCount: order.items.length,
        status: order.status,
      });
    }

    await this.prisma.cartItem.deleteMany({ where: { userId: user.id } });

    for (const order of createdOrders) {
      void this.notificationService.notifySupplierOrderSubmitted(order.id).catch((error) => {
        this.logger.warn(`Failed to queue supplier notification for order ${order.id}: ${error instanceof Error ? error.message : String(error)}`);
      });
    }

    return { orders: createdOrders };
  }

  async upsertRating(userCtx: any, orderId: string, dto: UpsertOrderRatingDto) {
    const { user } = await this.builderContext.getOrCreateBuilder(userCtx.userId, userCtx.email, userCtx.name);

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId: user.id },
      include: {
        items: {
          select: {
            supplierId: true,
          },
          take: 1,
        },
        supplierRating: true,
      },
    });

    if (!order) {
      throw new NotFoundException("Order not found");
    }

    if (order.status !== OrderStatus.DELIVERED) {
      throw new BadRequestException("Ratings can be submitted only after delivery");
    }

    const supplierId = order.items[0]?.supplierId;
    if (!supplierId) {
      throw new BadRequestException("Cannot determine supplier for this order");
    }

    if (order.supplierRating) {
      const canEditUntil = order.supplierRating.createdAt.getTime() + BuilderOrdersService.RATING_EDIT_WINDOW_MS;
      if (Date.now() > canEditUntil) {
        throw new BadRequestException("Rating edit window has expired");
      }

      const rating = await this.prisma.supplierRating.update({
        where: { orderId },
        data: {
          deliveryRating: dto.deliveryRating,
          qualityRating: dto.qualityRating,
          comment: dto.comment?.trim() || null,
        },
      });

      return {
        id: rating.id,
        orderId: rating.orderId,
        supplierId: rating.supplierId,
        deliveryRating: rating.deliveryRating,
        qualityRating: rating.qualityRating,
        comment: rating.comment,
        updated: true,
      };
    }

    const rating = await this.prisma.supplierRating.create({
      data: {
        orderId,
        supplierId,
        builderId: user.id,
        deliveryRating: dto.deliveryRating,
        qualityRating: dto.qualityRating,
        comment: dto.comment?.trim() || null,
      },
    });

    return {
      id: rating.id,
      orderId: rating.orderId,
      supplierId: rating.supplierId,
      deliveryRating: rating.deliveryRating,
      qualityRating: rating.qualityRating,
      comment: rating.comment,
      updated: false,
    };
  }
}
