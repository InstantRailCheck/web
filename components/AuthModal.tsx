"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Flip to true once Reddit approves the custom OAuth2 app under their
// Responsible Builder Policy and it's configured on the Supabase project
// — the button and its handler are already fully wired, just hidden
// until sign-in would actually work.
const REDDIT_SIGN_IN_ENABLED = false;

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

function RedditIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <circle cx="10" cy="10" r="10" fill="#FF4500" />
      <circle cx="10" cy="5.5" r="1.1" fill="#fff" />
      <line x1="10" y1="6.6" x2="10" y2="9" stroke="#fff" strokeWidth="1" />
      <ellipse cx="10" cy="12.5" rx="5.3" ry="4" fill="#fff" />
      <circle cx="7.7" cy="12" r="1" fill="#FF4500" />
      <circle cx="12.3" cy="12" r="1" fill="#FF4500" />
      <path d="M7.3 14.2c.8.7 1.8 1 2.7 1s1.9-.3 2.7-1" stroke="#FF4500" strokeWidth="0.9" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function AuthModal({ open, onOpenChange }: Props) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [redditLoading, setRedditLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogleSignIn() {
    setGoogleLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setGoogleLoading(false);
      setError(error.message);
    }
    // On success the browser navigates to Google — no further state to set.
  }

  async function handleRedditSignIn() {
    setRedditLoading(true);
    setError(null);
    const supabase = createClient();
    // Reddit isn't one of Supabase Auth's built-in providers (unlike
    // google) — it's wired up as a custom OAuth2 provider on the Supabase
    // project itself. "reddit" here is the identifier that provider must
    // be registered under; if it's configured under a different
    // identifier this string needs to match.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "custom:reddit",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setRedditLoading(false);
      setError(error.message);
    }
    // On success the browser navigates to Reddit — no further state to set.
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
    if (otp.length < 6) return;
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
          <DialogTitle className="text-lg font-semibold text-white">
            {step === "email" ? "Sign in to submit" : "Check your email"}
          </DialogTitle>
        </DialogHeader>

        {step === "email" ? (
          <div className="space-y-4">
            <button
              onClick={handleGoogleSignIn}
              disabled={googleLoading}
              className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-700 bg-slate-950 py-3 font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {!googleLoading && <GoogleIcon />}
              {googleLoading ? "Redirecting..." : "Continue with Google"}
            </button>
            <p className="text-center text-xs text-slate-500">
              We only use your Google account to verify your identity — we never access your
              Gmail, Drive, or other Google data.
            </p>
            {REDDIT_SIGN_IN_ENABLED && (
              <>
                <button
                  onClick={handleRedditSignIn}
                  disabled={redditLoading}
                  className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-700 bg-slate-950 py-3 font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                >
                  {!redditLoading && <RedditIcon />}
                  {redditLoading ? "Redirecting..." : "Continue with Reddit"}
                </button>
                <p className="text-center text-xs text-slate-500">
                  We only use your Reddit account to verify your identity — we never post or
                  access your Reddit activity.
                </p>
              </>
            )}
            <button
              onClick={handlePasskeySignIn}
              disabled={passkeyLoading}
              className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-700 bg-slate-950 py-3 font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {!passkeyLoading && <KeyRound className="h-[18px] w-[18px]" />}
              {passkeyLoading ? "Waiting for passkey..." : "Sign in with a passkey"}
            </button>
            <p className="text-center text-xs text-slate-500">
              Passkeys can be added once you have an account — sign in with Google or email
              first, then register one from your account page.
            </p>

            <div className="flex items-center gap-3 text-xs text-slate-500">
              <div className="h-px flex-1 bg-slate-800" />
              or
              <div className="h-px flex-1 bg-slate-800" />
            </div>

            <p className="text-sm text-slate-400">
              Enter your email and we&apos;ll send you a sign-in link. No password needed.
            </p>
            <input
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
              className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-white placeholder-slate-500 outline-none focus:border-blue-500"
              autoFocus
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              onClick={handleSend}
              disabled={!email || loading}
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
              the link to sign in, or enter the 6-digit code below.
            </p>
            <input
              type="text"
              inputMode="numeric"
              value={otp}
              onChange={(e) =>
                setOtp(e.target.value.replace(/\D/g, "").slice(0, 8))
              }
              onKeyDown={(e) => e.key === "Enter" && handleVerifyOtp()}
              placeholder="000000"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-center text-2xl tracking-[0.5em] text-white placeholder-slate-700 outline-none focus:border-blue-500"
              autoFocus
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              onClick={handleVerifyOtp}
              disabled={otp.length < 6 || loading}
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
