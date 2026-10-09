import { createAuthClient } from "better-auth/react";
import { runSignOut } from "../../../scripts/sign-out-plan.mjs";

/**
 * Better Auth client for this React app (browser-side).
 *
 * Talks to this app's OWN Better Auth at same-origin `/api/auth/*` with a
 * cookie session. Email + password only (`authClient.signUp.email`,
 * `authClient.signIn.email`).
 *
 * To sign out call `signOut()` below, which waits for the server to confirm
 * (the session cookie is HttpOnly) and then redirects.
 */
export const authClient = createAuthClient();

/**
 * True when sign-in UI should be shown — whenever `VITE_AUTH_ENABLED` is not
 * `"false"`. Set `VITE_AUTH_ENABLED=true` explicitly in deploy env.
 */
export const authEnabled = import.meta.env.VITE_AUTH_ENABLED !== "false";

/** Sign up with email + password, then continue to `callbackURL`. */
export async function signUpWithEmail(input: {
  name: string;
  email: string;
  password: string;
}): Promise<void> {
  const { error } = await authClient.signUp.email({
    name: input.name.trim() || input.email.split("@")[0] || "Member",
    email: input.email.trim(),
    password: input.password,
  });
  if (error) throw new Error(error.message ?? "Sign-up failed");
}

/** Sign in with email + password. */
export async function signInWithEmail(input: {
  email: string;
  password: string;
}): Promise<void> {
  const { error } = await authClient.signIn.email({
    email: input.email.trim(),
    password: input.password,
  });
  if (error) throw new Error(error.message ?? "Sign-in failed");
}

/**
 * Sign out of this app's session, then redirect.
 *
 * **Rejects if the server never confirms** (the session is an HttpOnly cookie
 * only the server can clear), so a failed sign-out is never reported as done.
 */
export async function signOut(redirectTo = "/"): Promise<void> {
  await runSignOut({
    livePreview: false,
    hasBearer: false,
    requestSignOut: async () => {
      const { error } = await authClient.signOut();
      if (error) throw new Error(error.message ?? "Sign-out failed");
    },
    clearToken: () => {},
    redirect: () => {
      window.location.href = redirectTo;
    },
  });
}
