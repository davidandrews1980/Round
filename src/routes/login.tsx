import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { authEnabled, signInWithEmail, signUpWithEmail } from "@/lib/auth/client";
import { Mark } from "@/lib/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signingUp = mode === "sign-up";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (signingUp) await signUpWithEmail({ name, email, password });
      else await signInWithEmail({ email, password });
      // Full navigation so every query and the session start clean.
      window.location.href = "/roundtable";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Link to="/" className="flex items-center gap-2 text-fg">
          <Mark className="size-12" />
          <span className="font-display text-2xl tracking-tight">
            Roundtable
          </span>
        </Link>
        <h1 className="mt-8 font-display text-4xl tracking-tight">
          {signingUp ? "Create account" : "Sign in"}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Your keys and sittings stay on this account. After you sign in,
          Roundtable will tell you which API keys you still need.
        </p>
        {authEnabled ? (
          <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
            {signingUp ? (
              <div className="space-y-1.5">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  name="name"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={signingUp ? "new-password" : "current-password"}
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {signingUp ? (
                <p className="text-xs text-muted">At least 8 characters.</p>
              ) : null}
            </div>
            {error ? (
              <p role="alert" className="text-sm text-red-400">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={busy}>
              {busy ? "Working…" : signingUp ? "Create account" : "Sign in"}
            </Button>
            <button
              type="button"
              className="cursor-pointer text-sm text-muted underline underline-offset-4 hover:text-fg"
              onClick={() => {
                setError(null);
                setMode(signingUp ? "sign-in" : "sign-up");
              }}
            >
              {signingUp
                ? "Already have an account? Sign in"
                : "New here? Create an account"}
            </button>
          </form>
        ) : (
          <p className="mt-8 text-sm text-muted">Sign-in is disabled.</p>
        )}
      </div>
    </main>
  );
}
