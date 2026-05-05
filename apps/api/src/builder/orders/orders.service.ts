import { Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { OrderStatus } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { formatCurrency, formatDate, humanizeToken } from "src/supplier/utils";
import { BuilderContextService } from "src/builder/builder-context.service";
import { CreateOrderDto } from "./dto/create-order.dto";

@Injectable()
export class BuilderOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly builderContext: BuilderContextService
  ) {}

  async findAll(userCtx: any) {
    const { user } = await this.builderContext.getOrCreateBuilder(userCtx.userId, userCtx.email, userCtx.name);

    const orders = await this.prisma.order.findMany({
      where: { userId: user.id },
      include: { items: { include: { product: true } } },
      orderBy: { createdAt: "desc" },
    });

    return orders.map((order) => ({
      id: order.id,
      status: order.status,
      itemCount: order.items.length,
      total: Number(order.totalAmount),
      totalLabel: formatCurrency(order.totalAmount.toString()),
      createdAt: order.createdAt,
    }));
  }

  async findOne(userCtx: any, id: string) {
    const { user } = await this.builderContext.getOrCreateBuilder(userCtx.userId, userCtx.email, userCtx.name);

    const order = await this.prisma.order.findFirst({
      where: { id, userId: user.id },
      include: {
        items: { include: { product: true } },
        tracking: { orderBy: { recordedAt: "asc" } },
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
      total: Number(order.totalAmount),
      totalLabel: formatCurrency(order.totalAmount.toString()),
      deliveryDate: formatDate(order.deliveryDate),
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
      include: { product: { include: { supplier: true } } },
    });

    if (!cartItems.length) {
      throw new BadRequestException("Cart is empty");
    }

    const totalAmount = cartItems.reduce((acc, item) => acc + Number(item.product.basePrice) * item.quantity, 0);

    const order = await this.prisma.order.create({
      data: {
        userId: user.id,
        paymentMethod: dto.paymentMethod,
        status: OrderStatus.PLACED,
        totalAmount,
        deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
        items: {
          create: cartItems.map((item) => ({
            productId: item.productId,
            supplierId: item.product.supplierId,
            quantity: item.quantity,
            unitPrice: item.product.basePrice,
            deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
          })),
        },
        tracking: {
          create: {
            status: OrderStatus.PLACED,
            note: "Order placed successfully",
          },
        },
      },
      include: { items: true },
    });

    await this.prisma.cartItem.deleteMany({ where: { userId: user.id } });

    return {
      id: order.id,
      status: order.status,
      total: Number(order.totalAmount),
      itemCount: order.items.length,
    };
  }
}
