// This handler proxies requests to the NestJS app
// The built app is in dist/main.js and should be started separately
// For Vercel, we need to ensure the built app can be started

import { VercelRequest, VercelResponse } from '@vercel/node';

export default async (req: VercelRequest, res: VercelResponse) => {
  // In production, the NestJS app should be running as a serverless function
  // This is a fallback that would be replaced by proper serverless configuration
  res.status(503).json({ error: 'API server is starting up' });
};

