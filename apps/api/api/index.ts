import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import * as express from 'express';
import type { Request, Response } from 'express';

const server = express();
let nestReady: Promise<void> | null = null;

function initNest(): Promise<void> {
  if (!nestReady) {
    nestReady = NestFactory.create(AppModule, new ExpressAdapter(server), {
      logger: ['error', 'warn'],
    }).then(async (app) => {
      app.setGlobalPrefix('api');
      app.enableCors();
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          transform: true,
          forbidNonWhitelisted: true,
        }),
      );
      await app.init();
    });
  }
  return nestReady;
}

module.exports = async (req: Request, res: Response) => {
  await initNest();
  server(req, res);
};

