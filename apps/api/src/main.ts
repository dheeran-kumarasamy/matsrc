import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  // `rawBody: true` preserves `req.rawBody` (a Buffer) alongside the normally-parsed
  // `req.body` for every request. This is required to verify the WhatsApp webhook's
  // `X-Hub-Signature-256` HMAC, which must be computed over the exact raw bytes Meta
  // sent — not a re-serialized JSON body. It does not change body parsing behavior for
  // any other route.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.setGlobalPrefix("api");
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    })
  );
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 4000);
}

void bootstrap();