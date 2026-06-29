"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Step = "email" | "otp";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AuthModal({ open, onOpenChange }: Props) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSendOtp() {
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
      setStep("otp");
    }
  }

  async function handleVerifyOtp() {
    if (otp.length !== 6) return;
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

  function handleBack() {
    setStep("email");
    setOtp("");
    setError(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-800 bg-slate-900 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-white">
            {step === "email" ? "Sign in to submit" : "Check your email"}
          </DialogTitle>
        </DialogHeader>

        {step === "email" ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-400">
              Enter your email and we'll send you a one-time code. No password needed.
            </p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendOtp()}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-white placeholder-slate-500 outline-none focus:border-blue-500"
              autoFocus
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              onClick={handleSendOtp}
              disabled={!email || loading}
              className="w-full rounded-xl bg-blue-600 py-3 font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50"
            >
              {loading ? "Sending..." : "Send code"}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-400">
              We sent a 6-digit code to{" "}
              <span className="font-medium text-white">{email}</span>. It
              expires in 10 minutes.
            </p>
            <input
              type="text"
              inputMode="numeric"
              value={otp}
              onChange={(e) =>
                setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              onKeyDown={(e) => e.key === "Enter" && handleVerifyOtp()}
              placeholder="000000"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-center text-2xl tracking-[0.5em] text-white placeholder-slate-700 outline-none focus:border-blue-500"
              autoFocus
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              onClick={handleVerifyOtp}
              disabled={otp.length !== 6 || loading}
              className="w-full rounded-xl bg-blue-600 py-3 font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50"
            >
              {loading ? "Verifying..." : "Verify code"}
            </button>
            <button
              onClick={handleBack}
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
