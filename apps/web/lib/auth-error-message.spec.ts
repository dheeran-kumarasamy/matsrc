import { describe, expect, it } from "vitest";
import { authErrorMessage } from "./auth-error-message";

describe("authErrorMessage", () => {
  it("returns null when there is no error code", () => {
    expect(authErrorMessage(null)).toBeNull();
    expect(authErrorMessage(undefined)).toBeNull();
    expect(authErrorMessage("")).toBeNull();
  });

  it("maps Configuration to an actionable, non-technical message suggesting OTP", () => {
    const message = authErrorMessage("Configuration");
    expect(message).toMatch(/google/i);
    expect(message).toMatch(/otp|phone|email/i);
  });

  it("maps AccessDenied to a plain-language message", () => {
    expect(authErrorMessage("AccessDenied")).toMatch(/cancelled|denied/i);
  });

  it("maps OAuth-family error codes to a generic Google retry message", () => {
    for (const code of ["OAuthSignin", "OAuthCallback", "OAuthCreateAccount", "OAuthAccountNotLinked"]) {
      expect(authErrorMessage(code)).toMatch(/google/i);
    }
  });

  it("maps CredentialsSignin to an OTP-specific message", () => {
    expect(authErrorMessage("CredentialsSignin")).toMatch(/otp/i);
  });

  it("never leaks the raw error code or technical details for unknown codes", () => {
    const message = authErrorMessage("SomeInternalProviderStackTraceCode");
    expect(message).not.toMatch(/SomeInternalProviderStackTraceCode/);
    expect(message).toBeTruthy();
  });
});
