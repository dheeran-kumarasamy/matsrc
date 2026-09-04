import type { Metadata } from "next";
import SiteHeader from "@/components/home/SiteHeader";
import BuildOHubLogo from "@/components/shared/BuildOHubLogo";
import { getSiteUrl } from "@/lib/site-url";

// Static marketing/legal page — no client state needed, so this stays a
// plain server component (matches the pattern used by app/page.tsx for the
// Home surface: SiteHeader + theme-home wrapper + shared BuildOHubLogo).
export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How BuildOHub collects, uses, and protects your personal and business data on India's B2B construction material procurement marketplace.",
  alternates: { canonical: `${getSiteUrl()}/privacy-policy` },
};

const LAST_UPDATED = "1 September 2026";

export default function PrivacyPolicyPage() {
  return (
    <main
      className="theme-home min-h-screen overflow-x-hidden"
      style={{ background: "var(--posh-bg)", color: "var(--posh-fg)" }}
    >
      <SiteHeader />

      <div className="mx-auto max-w-3xl px-6 pb-20 pt-32 md:px-10 md:pt-40">
        <h1 className="posh-page-title">Privacy Policy</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--posh-fg-muted)" }}>
          Last updated: {LAST_UPDATED}
        </p>

        <div className="panel mt-8 space-y-8 p-6 text-sm leading-relaxed md:p-10">
          <section>
            <h2 className="posh-card-title">1. Introduction</h2>
            <p className="mt-3" style={{ color: "var(--posh-fg-muted)" }}>
              BuildOHub (&ldquo;BuildOHub&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;) operates
              buildohub.in, a B2B construction material procurement marketplace connecting Builders and Suppliers.
              This Privacy Policy explains what personal and business information we collect, how we use and share
              it, and the choices you have, when you use our website, mobile applications, and related services
              (together, the &ldquo;Platform&rdquo;).
            </p>
          </section>

          <section>
            <h2 className="posh-card-title">2. Information We Collect</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5" style={{ color: "var(--posh-fg-muted)" }}>
              <li>
                <strong style={{ color: "var(--posh-fg)" }}>Account &amp; identity data:</strong> name, email
                address, phone number, company name, GSTIN, and role (Builder or Supplier) provided during
                registration or KYC.
              </li>
              <li>
                <strong style={{ color: "var(--posh-fg)" }}>Transaction data:</strong> enquiries, RFQs, quotes,
                orders, purchase orders, invoices, payments, credit/BNPL applications, and delivery details.
              </li>
              <li>
                <strong style={{ color: "var(--posh-fg)" }}>Communications:</strong> messages exchanged through the
                Platform, including WhatsApp and SMS notifications you opt into for order updates, OTP verification,
                and reminders.
              </li>
              <li>
                <strong style={{ color: "var(--posh-fg)" }}>Usage data:</strong> pages viewed, searches, watchlist
                items, device/browser information, and approximate location (e.g. site/district) used for price
                and delivery estimates.
              </li>
              <li>
                <strong style={{ color: "var(--posh-fg)" }}>Documents:</strong> KYC documents, Mill Test
                Certificates (MTCs), UTR/payment proofs, and Bank Guarantee documents you upload.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="posh-card-title">3. How We Use Your Information</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5" style={{ color: "var(--posh-fg-muted)" }}>
              <li>To operate the Platform — matching Builders with Suppliers, processing orders, payments, and credit/BNPL.</li>
              <li>To verify identity and prevent fraud (KYC, OTP verification, GST e-Invoice compliance).</li>
              <li>To send transactional notifications via email, SMS, and WhatsApp (order status, delivery ETA, payment reminders, quote updates).</li>
              <li>To provide price intelligence and market insight features relevant to your sourcing needs.</li>
              <li>To improve the Platform, respond to support requests, and comply with legal and regulatory obligations.</li>
            </ul>
          </section>

          <section>
            <h2 className="posh-card-title">4. WhatsApp &amp; SMS Communications</h2>
            <p className="mt-3" style={{ color: "var(--posh-fg-muted)" }}>
              With your consent, we send order and enquiry lifecycle updates, OTP codes, and reminders over WhatsApp
              (via the WhatsApp Business Platform) and SMS. These messages are limited to transactional and
              account-related purposes — we do not use WhatsApp for unsolicited marketing. You can ask us to stop
              WhatsApp notifications at any time by contacting the Grievance Officer below.
            </p>
          </section>

          <section>
            <h2 className="posh-card-title">5. Sharing of Information</h2>
            <p className="mt-3" style={{ color: "var(--posh-fg-muted)" }}>
              We share information with the Supplier or Builder counterparty necessary to fulfil an order or quote,
              with payment and lending partners to process transactions and credit/BNPL applications, and with
              service providers who help us operate the Platform (cloud hosting, messaging providers such as
              Twilio/Meta, SMS/email delivery, and analytics) under contractual confidentiality obligations. We do
              not sell your personal information to third parties.
            </p>
          </section>

          <section>
            <h2 className="posh-card-title">6. Data Security</h2>
            <p className="mt-3" style={{ color: "var(--posh-fg-muted)" }}>
              We use industry-standard safeguards — encryption in transit, access controls, and audited storage —
              to protect your data. Uploaded documents (KYC, MTCs, UTRs, Bank Guarantees) are stored in access-
              controlled cloud storage. No method of transmission or storage is 100% secure, and we continuously
              work to strengthen our safeguards.
            </p>
          </section>

          <section>
            <h2 className="posh-card-title">7. Data Retention</h2>
            <p className="mt-3" style={{ color: "var(--posh-fg-muted)" }}>
              We retain account and transaction data for as long as your account is active and thereafter as
              required to comply with legal, tax, and audit obligations, resolve disputes, and enforce our
              agreements.
            </p>
          </section>

          <section>
            <h2 className="posh-card-title">8. Your Rights &amp; Choices</h2>
            <p className="mt-3" style={{ color: "var(--posh-fg-muted)" }}>
              You may access, correct, or request deletion of your personal information, and manage your
              notification preferences, from your Profile settings or by contacting us using the details below.
              We will respond to verified requests in accordance with applicable law.
            </p>
          </section>

          <section>
            <h2 className="posh-card-title">9. Changes to This Policy</h2>
            <p className="mt-3" style={{ color: "var(--posh-fg-muted)" }}>
              We may update this Privacy Policy from time to time. Material changes will be notified on the
              Platform, and the &ldquo;Last updated&rdquo; date above will reflect the most recent revision.
            </p>
          </section>

          <section>
            <h2 className="posh-card-title">10. Contact Us</h2>
            <p className="mt-3" style={{ color: "var(--posh-fg-muted)" }}>
              For any privacy-related questions, requests, or grievances, contact our Grievance Officer at{" "}
              <a href="mailto:grievance@buildohub.in" className="underline" style={{ color: "var(--posh-primary)" }}>
                grievance@buildohub.in
              </a>
              .
            </p>
          </section>
        </div>

        <footer
          className="mt-10 flex flex-col justify-between gap-4 text-sm md:flex-row"
          style={{ color: "var(--posh-fg-muted)" }}
        >
          <BuildOHubLogo href="/" className="text-lg" />
          <span>© {new Date().getFullYear()} BuildOHub · Coimbatore, India</span>
        </footer>
      </div>
    </main>
  );
}
