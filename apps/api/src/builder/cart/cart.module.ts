import { Module } from "@nestjs/common";
import { BuilderModule } from "src/builder/builder.module";
import { CartController } from "./cart.controller";
import { CartService } from "./cart.service";

@Module({
  imports: [BuilderModule],
  controllers: [CartController],
  providers: [CartService],
})
export class CartModule {}
// Note: CartService uses the shared resolveMarkupForProduct() function
// directly (via @matsrc/db), not the MarkupService wrapper, so no
// additional module import is required here.
