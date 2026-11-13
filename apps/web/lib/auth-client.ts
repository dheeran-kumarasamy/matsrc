"use client";

import { signIn as nextAuthSignIn, signOut as nextAuthSignOut } from "next-auth/react";
import { runBrowserAuthTransition } from "./api";

/**
 * Application-owned client-side sign-out helper.
 *
 * Runs inside a browser authentication transition barrier:
 * 1. Synchronously marks the authentication state as transitioning, invalidates any in-flight
 *    session lookup, and increments the session epoch before calling NextAuth signOut.
 * 2. Queues any concurrent or pending builder API session resolutions so they cannot dispatch
 *    with a stale pre-logout identity.
 * 3. Releases the barrier in a finally-safe path when signOut settles, allowing queued requests
 *    to resolve fresh against the post-logout unauthenticated state.
 */
export const appSignOut: typeof nextAuthSignOut = ((options?: any) => {
  return runBrowserAuthTransition(async () => {
    return nextAuthSignOut(options);
  });
}) as unknown as typeof nextAuthSignOut;

/**
 * Application-owned client-side sign-in helper.
 *
 * Runs inside a browser authentication transition barrier:
 * 1. Synchronously establishes the barrier before NextAuth signIn initiates.
 * 2. Queues any concurrent or pending builder API session resolutions so they cannot dispatch
 *    with a stale pre-transition identity.
 * 3. Releases the barrier in a finally-safe path when signIn completes (or fails), allowing
 *    queued requests to resolve fresh against the newly established session.
 */
export const appSignIn: typeof nextAuthSignIn = (async (
  provider?: any,
  options?: any,
  authorizationParams?: any
) => {
  return runBrowserAuthTransition(async () => {
    const result = await nextAuthSignIn(provider, options, authorizationParams);
    return result;
  });
}) as unknown as typeof nextAuthSignIn;

// Aliases matching next-auth/react naming for drop-in use in UI components
export { appSignIn as signIn, appSignOut as signOut };
