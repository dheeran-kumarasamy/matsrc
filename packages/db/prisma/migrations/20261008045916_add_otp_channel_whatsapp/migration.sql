-- Additive-only: adds the WHATSAPP value to the existing OtpChannel enum so
-- the OtpChallenge.channel column can record WhatsApp OTP deliveries
-- (Buyer/Supplier portal login) without overloading the existing SMS/EMAIL
-- values. Existing enum values (SMS, EMAIL) and all existing OtpChallenge
-- rows remain valid and unchanged — PostgreSQL's ALTER TYPE ... ADD VALUE is
-- a pure, non-destructive extension of the enum's value set.
--
-- Hand-authored (not `prisma migrate dev`, which requires an interactive TTY
-- unavailable in this environment), matching the existing project
-- convention already used for 20261004125527_add_otp_challenge.

ALTER TYPE "OtpChannel" ADD VALUE 'WHATSAPP';
