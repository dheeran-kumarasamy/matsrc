import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sendWhatsAppMessage } from './twilio-whatsapp';
import { sendOtpSms } from './contact-verification/sms-sender';
import { sendOtpEmail } from './contact-verification/email-sender';

describe('External Notification Isolation Guards (Preview / Test Safety)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('WhatsApp Twilio Isolation', () => {
    it('returns error if WHATSAPP_ENABLED is not "true"', async () => {
      process.env.WHATSAPP_ENABLED = 'false';
      const result = await sendWhatsAppMessage('+919876543210', 'Test message');
      expect(result).toHaveProperty('error');
      expect((result as any).error).toContain('WhatsApp sending is disabled');
    });

    it('suppresses real WhatsApp send in VERCEL_ENV=preview even when WHATSAPP_ENABLED="true"', async () => {
      process.env.WHATSAPP_ENABLED = 'true';
      process.env.VERCEL_ENV = 'preview';
      (process.env as any).NODE_ENV = 'production'; // simulate production node env on preview branch
      const result = await sendWhatsAppMessage('+919876543210', 'Preview notification');

      expect(result).not.toHaveProperty('error');
      expect((result as any).provider).toBe('mock-preview');
      expect((result as any).externalId).toContain('mock-preview-wa-');
    });

    it('suppresses real WhatsApp send in dry-run mode', async () => {
      process.env.WHATSAPP_ENABLED = 'true';
      delete process.env.VERCEL_ENV;
      process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = 'dry-run';
      const result = await sendWhatsAppMessage('+919876543210', 'Dry run alert');

      expect(result).not.toHaveProperty('error');
      expect((result as any).provider).toBe('mock-preview');
    });
  });

  describe('SMS OTP Isolation', () => {
    it('returns ok: true when SMS_OTP_ENABLED is not "true" without sending', async () => {
      process.env.SMS_OTP_ENABLED = 'false';
      const result = await sendOtpSms('+919876543210', '123456');
      expect(result.ok).toBe(true);
    });

    it('suppresses real SMS send in VERCEL_ENV=preview even when SMS_OTP_ENABLED="true"', async () => {
      process.env.SMS_OTP_ENABLED = 'true';
      process.env.VERCEL_ENV = 'preview';
      (process.env as any).NODE_ENV = 'production';
      const result = await sendOtpSms('+919876543210', '123456');
      expect(result.ok).toBe(true);
    });
  });

  describe('Email OTP Isolation', () => {
    it('suppresses real email send in VERCEL_ENV=preview and returns ok: true', async () => {
      process.env.VERCEL_ENV = 'preview';
      (process.env as any).NODE_ENV = 'production';
      process.env.SMTP_HOST = 'smtp.fake-ses.amazonaws.com';
      process.env.SMTP_USERNAME = 'fake-user';
      process.env.SMTP_PASSWORD = 'fake-password';

      const result = await sendOtpEmail('buyer@example.com', '123456');
      expect(result.ok).toBe(true);
    });

    it('suppresses real email send in test environment and returns ok: true', async () => {
      (process.env as any).NODE_ENV = 'test';
      const result = await sendOtpEmail('buyer@example.com', '123456');
      expect(result.ok).toBe(true);
    });
  });
});
