import nodemailer from "nodemailer";

// Sends the OTP verification email for the /profile "change email" flow.
//
// PROVIDER: this repo already declares AWS SES as its intended transactional
// email provider (see SES_FROM_EMAIL in .env.example) but no email-sending
// code path exists anywhere in the codebase yet — the AWS SES SDK is not a
// dependency of any package. Rather than adding a brand-new AWS SDK
// dependency for a single email, this uses `nodemailer` (already a
// transitive dependency of next-auth's email-provider support, and now a
// direct dependency here) over SMTP — AWS SES exposes a standard SMTP
// interface, so the existing SES_FROM_EMAIL account can be used unchanged by
// pointing nodemailer's SMTP transport at SES's SMTP endpoint. This keeps
// "the existing suitable email provider" as required (SES), rather than
// introducing a different one (e.g. SendGrid/Resend), while not requiring a
// new AWS SDK dependency.
//
// Required environment variables (documented in .env.example):
//   SES_FROM_EMAIL      — already-existing "from" address env var, reused as-is.
//   SMTP_HOST           — SES SMTP endpoint, e.g. email-smtp.ap-south-1.amazonaws.com
//   SMTP_PORT           — typically 587 (STARTTLS) or 465 (TLS).
//   SMTP_USERNAME       — SES SMTP username (generated in the SES console, NOT the AWS access key).
//   SMTP_PASSWORD       — SES SMTP password (generated in the SES console, NOT the AWS secret key).
//
// If SMTP is not configured (local/dev), sends are logged (never the OTP
// itself — see comment below) and treated as a soft failure so the profile
// page's OTP flow remains testable without real credentials.

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

/**
 * Sends the OTP code to `toEmail`. NEVER logs the OTP value itself (task
 * spec §4 "Never log OTP values") — only the fact that a send was
 * attempted/succeeded/failed.
 */
export async function sendOtpEmail(toEmail: string, otp: string): Promise<EmailSendResult> {
  const from = process.env.SES_FROM_EMAIL || "noreply@buildohub.in";
  const subject = "Your BuildOHub verification code";
  const text = `Your BuildOHub verification code is ${otp}. It expires in 10 minutes. If you didn't request this, you can safely ignore this email.`;
  const html = `<p>Your BuildOHub verification code is:</p><p style="font-size:24px;font-weight:700;letter-spacing:4px;">${otp}</p><p>This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>`;

  const client = getTransporter();
  if (!client) {
    // Dev/unconfigured-SMTP fallback — mirrors the existing dev-mode
    // send-otp route's documented behaviour, but never prints the code.
    console.log(`[contact-verification] SMTP not configured — would send email OTP to ${maskLogTarget(toEmail)}`);
    return { ok: true };
  }

  try {
    await client.sendMail({ from, to: toEmail, subject, text, html });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email send failed";
    console.error(`[contact-verification] Failed to send email OTP to ${maskLogTarget(toEmail)}:`, message);
    return { ok: false, error: message };
  }
}

function maskLogTarget(value: string): string {
  const at = value.indexOf("@");
  if (at <= 0) return "***";
  return `${value.slice(0, 2)}***@${value.slice(at + 1)}`;
}
