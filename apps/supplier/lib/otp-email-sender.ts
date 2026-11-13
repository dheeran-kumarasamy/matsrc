import nodemailer from "nodemailer";

// Supplier portal's OTP email-fallback sender — mirrors
// apps/web/lib/contact-verification/email-sender.ts exactly (same SES/SMTP
// env vars, same soft-fail-when-unconfigured dev behavior, same "never log
// the OTP itself" invariant) rather than inventing a second email-sending
// approach for the Supplier portal's new login OTP email fallback.

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USERNAME;
  const pass = process.env.SMTP_PASSWORD;
  if (!host || !user || !pass) {
    return null;
  }
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  return transporter;
}

export type EmailSendResult = { ok: true } | { ok: false; error: string };

/** Sends the OTP code to `toEmail`. NEVER logs the OTP value itself. */
export async function sendOtpEmail(toEmail: string, otp: string): Promise<EmailSendResult> {
  const from = process.env.SES_FROM_EMAIL || "noreply@buildohub.in";
  const subject = "Your BuildOHub verification code";
  const text = `Your BuildOHub verification code is ${otp}. It expires in 5 minutes. If you didn't request this, you can safely ignore this email.`;
  const html = `<p>Your BuildOHub verification code is:</p><p style="font-size:24px;font-weight:700;letter-spacing:4px;">${otp}</p><p>This code expires in 5 minutes. If you didn't request this, you can safely ignore this email.</p>`;

  const client = getTransporter();
  if (!client) {
    console.log(`[supplier-otp] SMTP not configured — would send email OTP to ${maskLogTarget(toEmail)}`);
    return { ok: false, error: "SMTP_NOT_CONFIGURED" };
  }

  try {
    await client.sendMail({ from, to: toEmail, subject, text, html });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email send failed";
    console.error(`[supplier-otp] Failed to send email OTP to ${maskLogTarget(toEmail)}:`, message);
    return { ok: false, error: message };
  }
}

function maskLogTarget(value: string): string {
  const at = value.indexOf("@");
  if (at <= 0) return "***";
  return `${value.slice(0, 2)}***@${value.slice(at + 1)}`;
}
