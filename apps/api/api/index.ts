import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { Request, Response } from 'express';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const express = require('express');

// Import from the compiled `dist/` output (produced by `nest build` / swc during the
// Vercel build step), NOT from `../src/app.module`. Vercel's serverless function
// bundler (esbuild-based, via @vercel/node) traces and transpiles TS source files
// directly without applying tsconfig `paths` alias resolution (`src/*` -> `./src/*`),
// so importing from `src/` causes every internal `import ... from "src/..."` inside
// the app to fail at runtime with `Cannot find module 'src/...'`. The `dist/` output
// has already had those aliases resolved into plain relative `require()` calls by
// swc/nest build, so requiring it here avoids the issue entirely.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AppModule } = require('../dist/app.module');

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
