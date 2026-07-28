"use client";

import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Step = "email" | "sent";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
      <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z" />
      <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z" />
      <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z" />
      <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.36-3.9-1.36-.52-1.34-1.28-1.7-1.28-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.28-5.27-5.69 0-1.26.45-2.28 1.18-3.08-.12-.29-.51-1.47.11-3.05 0 0 .96-.31 3.16 1.18a10.95 10.95 0 0 1 5.75 0c2.2-1.49 3.16-1.18 3.16-1.18.62 1.58.23 2.76.11 3.05.74.8 1.18 1.82 1.18 3.08 0 4.42-2.71 5.39-5.29 5.68.42.36.79 1.06.79 2.14v3.26c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z"
      />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg viewBox="0 0 23 23" width="18" height="18" aria-hidden="true">
      <path fill="#f25022" d="M1 1h10v10H1z" />
      <path fill="#00a4ef" d="M1 12h10v10H1z" />
      <path fill="#7fba00" d="M12 1h10v10H12z" />
      <path fill="#ffb900" d="M12 12h10v10H12z" />
    </svg>
  );
}

// Carries the page the user opened this modal from through the OAuth round
// trip, so e.g. signing in from /contribute lands back on /contribute (and
// signing in from the homepage's #search anchor lands back on #search)
// instead of always bouncing to / — app/auth/callback/route.ts already
// sanitizes `next` against open-redirect abuse, it just wasn't being sent
// before.
export function oauthRedirectTo(location: Pick<Location, "origin" | "pathname" | "search" | "hash">): string {
  const next = encodeURIComponent(location.pathname + location.search + location.hash);
  return `${location.origin}/auth/callback?next=${next}`;
}

export function AuthModal({ open, onOpenChange }: Props) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [githubLoading, setGithubLoading] = useState(false);
  const [microsoftLoading, setMicrosoftLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogleSignIn() {
    setGoogleLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: oauthRedirectTo(window.location) },
    });
    if (error) {
      setGoogleLoading(false);
      setError(error.message);
    }
    // On success the browser navigates to Google — no further state to set.
  }

  async function handleGitHubSignIn() {
    setGithubLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: oauthRedirectTo(window.location) },
    });
    if (error) {
      setGithubLoading(false);
      setError(error.message);
    }
    // On success the browser navigates to GitHub — no further state to set.
  }

  async function handleMicrosoftSignIn() {
    setMicrosoftLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      // Unlike Google/GitHub, Azure doesn't return email/profile claims by
      // default — Supabase's own docs require explicitly requesting these
      // scopes (see supabase.com/docs/guides/auth/social-login/auth-azure).
      // The Azure app registration also needs "email" added as an optional
      // ID token claim in its manifest, or the scope alone still won't
      // produce one.
      options: { redirectTo: oauthRedirectTo(window.location), scopes: "email profile" },
    });
    if (error) {
      setMicrosoftLoading(false);
      setError(error.message);
    }
    // On success the browser navigates to Microsoft — no further state to set.
  }

  async function handlePasskeySignIn() {
    setPasskeyLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPasskey();
    setPasskeyLoading(false);
    if (error) {
      setError(error.message);
    } else {
      onOpenChange(false);
      setStep("email");
      setEmail("");
      setOtp("");
    }
  }

  async function handleSend() {
    if (!email) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setStep("sent");
    }
  }

  async function handleVerifyOtp() {
    if (otp.length < 8) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: otp,
      type: "email",
    });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      onOpenChange(false);
      setStep("email");
      setEmail("");
      setOtp("");
    }
  }

  function handleClose(open: boolean) {
    onOpenChange(open);
    if (!open) {
      setStep("email");
      setEmail("");
      setOtp("");
      setError(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="border-slate-800 bg-slate-900 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center text-lg font-semibold text-white">
            {step === "email" ? "Sign in to submit" : "Check your email"}
          </DialogTitle>
        </DialogHeader>

        {step === "email" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={handleGoogleSignIn}
                disabled={googleLoading}
                className="flex flex-col items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 py-3 text-xs font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
              >
                {googleLoading ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <GoogleIcon />}
                Google
              </button>
              <button
                onClick={handleGitHubSignIn}
                disabled={githubLoading}
                className="flex flex-col items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 py-3 text-xs font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
              >
                {githubLoading ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <GitHubIcon />}
                GitHub
              </button>
              <button
                onClick={handleMicrosoftSignIn}
                disabled={microsoftLoading}
                className="flex flex-col items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 py-3 text-xs font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
              >
                {microsoftLoading ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <MicrosoftIcon />}
                Microsoft
              </button>
            </div>
            <p className="text-center text-xs text-slate-400">
              We only use these accounts to verify your identity — never your files, mail, or
              repositories.
            </p>
            <button
              onClick={handlePasskeySignIn}
              disabled={passkeyLoading}
              className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-700 bg-slate-950 py-3 font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {!passkeyLoading && <KeyRound className="h-[18px] w-[18px]" />}
              {passkeyLoading ? "Waiting for passkey..." : "Sign in with a passkey"}
            </button>
            <p className="text-center text-xs text-slate-400">
              Add a passkey from your account page after signing in once.
            </p>

            <div className="flex items-center gap-3 text-xs text-slate-400">
              <div className="h-px flex-1 bg-slate-800" />
              or
              <div className="h-px flex-1 bg-slate-800" />
            </div>

            <p className="text-sm text-slate-400">
              Enter your email and we&apos;ll send you a sign-in link. No password needed.
            </p>
            <div className="text-center">
              <label htmlFor="signin-email" className="mb-1 block text-sm font-medium text-slate-300">
                Email address
              </label>
              <input
                id="signin-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder="you@example.com"
                // RFC 5321's own limit — this call goes straight to Supabase's
                // GoTrue auth service (not through any of our own API code),
                // which has its own request validation and OTP rate limiting;
                // this is just basic input hygiene, not a security boundary.
                maxLength={254}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-center text-white placeholder-slate-500 outline-none focus:border-blue-500"
              />
            </div>
            {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
            <button
              onClick={handleSend}
              disabled={!email || loading}
              aria-live="polite"
              className="w-full rounded-xl bg-blue-600 py-3 font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50"
            >
              {loading ? "Sending..." : "Send sign-in link"}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-400">
              We sent an email to{" "}
              <span className="font-medium text-white">{email}</span>. Click
              the link to sign in, or enter the 8-digit code below.
            </p>
            <div className="text-left">
              <label htmlFor="signin-otp" className="mb-1 block text-sm font-medium text-slate-300">
                8-digit code
              </label>
              <input
                id="signin-otp"
                type="text"
                inputMode="numeric"
                value={otp}
                onChange={(e) =>
                  setOtp(e.target.value.replace(/\D/g, "").slice(0, 8))
                }
                onKeyDown={(e) => e.key === "Enter" && handleVerifyOtp()}
                placeholder="00000000"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-center text-2xl tracking-[0.5em] text-white placeholder-slate-700 outline-none focus:border-blue-500"
                autoFocus
              />
            </div>
            {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
            <button
              onClick={handleVerifyOtp}
              disabled={otp.length < 8 || loading}
              aria-live="polite"
              className="w-full rounded-xl bg-blue-600 py-3 font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50"
            >
              {loading ? "Verifying..." : "Verify code"}
            </button>
            <button
              onClick={() => { setStep("email"); setOtp(""); setError(null); }}
              className="w-full text-sm text-slate-400 transition hover:text-white"
            >
              Use a different email
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
