// Single source of truth for deriving a user's display name and avatar
// initials from their authenticated profile (NextAuth session's
// User.name / User.email — the same session object every page already
// reads via next-auth/react's useSession()). Used by every top-navigation
// profile control (see components/shared/ProfileMenu.tsx) so the same
// authenticated profile always produces the same first name and initials
// on every page — Dashboard, Products, Orders, Sourcing, Cart, Reports,
// Alerts, etc.

function splitName(name?: string | null): string[] {
  return (name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * First name only, e.g. "Dheeran Kumarasamy" -> "Dheeran".
 *
 * Falls back to the local part of the email address (e.g.
 * "dheeran@example.com" -> "dheeran") when no name is set, then to
 * `fallback` ("there" by default, safe to drop into a "Welcome back, X"
 * greeting) when neither is available.
 */
export function getFirstName(name?: string | null, email?: string | null, fallback = "there"): string {
  const parts = splitName(name);
  if (parts.length > 0) return parts[0];

  const local = email?.split("@")[0]?.trim();
  if (local) return local;

  return fallback;
}

/**
 * Two-letter avatar initials, dynamically derived from the profile name:
 *   "Dheeran Kumarasamy" -> "DK"
 *   "John Smith"         -> "JS"
 *   "Priya R"            -> "PR"
 *
 * A single-word name (no last name on file) falls back to that word's own
 * first letter(s) rather than guessing a second initial ("Cher" -> "CH",
 * "X" -> "X"). Extra/irregular whitespace is normalized away first. When
 * there is no usable name at all, falls back to the email's local-part
 * initials, then to `fallback` ("U" for "Unknown user").
 */
export function getInitials(name?: string | null, email?: string | null, fallback = "U"): string {
  const parts = splitName(name);

  if (parts.length >= 2) {
    const first = parts[0][0] ?? "";
    const last = parts[parts.length - 1][0] ?? "";
    const initials = `${first}${last}`.toUpperCase();
    if (initials) return initials;
  }

  if (parts.length === 1) {
    const initials = parts[0].slice(0, 2).toUpperCase();
    if (initials) return initials;
  }

  const local = email?.split("@")[0]?.trim();
  if (local) {
    const initials = local.slice(0, 2).toUpperCase();
    if (initials) return initials;
  }

  return fallback;
}
