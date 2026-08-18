// P0 fix — maps NextAuth/Auth.js `?error=` query values (e.g. after a failed
// Google sign-in redirect to /auth/login?error=Configuration) to a truthful,
// non-technical, user-facing message. Previously the login page never read
// this query param at all, so any auth failure left the user on what looked
// like an untouched login form with no explanation of what went wrong.
//
// Never expose stack traces, provider internals, or secrets here — only the
// small set of documented Auth.js error codes
// (https://authjs.dev/reference/core/errors) mapped to plain language.
export function authErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;

  switch (code) {
    case "Configuration":
      return "Google sign-in is temporarily unavailable. Please continue with your phone number or email OTP instead.";
    case "AccessDenied":
      return "Google sign-in was cancelled or access was denied. Please try again, or continue with OTP.";
    case "OAuthSignin":
    case "OAuthCallback":
    case "OAuthCreateAccount":
    case "OAuthAccountNotLinked":
      return "We couldn't complete Google sign-in. Please try again, or continue with your phone number or email OTP.";
    case "CredentialsSignin":
      return "That OTP was incorrect or has expired. Please request a new one.";
    case "Verification":
      return "This sign-in link has expired or was already used. Please request a new OTP.";
    default:
      return "We couldn't sign you in. Please try again, or continue with your phone number or email OTP.";
  }
}
