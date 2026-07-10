"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Banknote } from "lucide-react";
import { BankSelect, type Bank } from "@/components/BankSelect";
import { getRouteIntelligence, RouteIntelligence } from "@/lib/routingEngine";

type RouteSearchProps = {
  bankCount: number;
};

const INSTANT_RAILS = new Set(["RTP", "FedNow", "Visa Direct", "Mastercard Send"]);

// Color emoji glyphs (💸, ⚡, 🏦) are pre-rendered by the OS's emoji font and
// ignore CSS `color` entirely — an SVG icon is the only way to actually pick
// up the badge's violet/etc. text color via currentColor.
const RAIL_STYLES: Record<string, { border: string; bg: string; text: string; icon: ReactNode }> = {
  RTP:              { border: "border-green-500/30",  bg: "bg-green-500/10",  text: "text-green-300",  icon: "⚡" },
  FedNow:           { border: "border-purple-500/30", bg: "bg-purple-500/10", text: "text-purple-300", icon: "🏦" },
  ACH:              { border: "border-blue-500/30",   bg: "bg-blue-500/10",   text: "text-blue-300",   icon: "" },
  Wire:             { border: "border-slate-800",     bg: "bg-slate-900",     text: "text-slate-300",  icon: "" },
  Zelle:            { border: "border-violet-500/30", bg: "bg-violet-500/10", text: "text-violet-300", icon: <Banknote className="inline-block h-[14px] w-[14px]" /> },
  "Visa Direct":     { border: "border-sky-500/30",    bg: "bg-sky-500/10",    text: "text-sky-300",    icon: "" },
  "Mastercard Send": { border: "border-orange-500/30", bg: "bg-orange-500/10", text: "text-orange-300", icon: "" },
};

function getRailStyle(rail: string) {
  return RAIL_STYLES[rail] ?? { border: "border-slate-700", bg: "bg-slate-900", text: "text-slate-300", icon: "" };
}

function RailMeta({
  rail,
}: {
  rail: {
    lastTested: string | null;
    isStale: boolean;
    directions: ("push" | "pull")[];
    sameDayCount?: number | null;
  };
}) {
  const dirLabel =
    rail.directions.length === 2 ? "Push & Pull" :
    rail.directions[0] === "push" ? "Push only" :
    rail.directions[0] === "pull" ? "Pull only" : null;

  if (!rail.lastTested && !dirLabel && !rail.sameDayCount) return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs opacity-70">
      {rail.isStale && <span className="text-yellow-400">⚠ Stale</span>}
      {dirLabel && <span>{dirLabel}</span>}
      {!!rail.sameDayCount && (
        <span>
          Same-Day ACH in {rail.sameDayCount} report{rail.sameDayCount !== 1 ? "s" : ""}
        </span>
      )}
      {rail.lastTested && <span>Last tested {rail.lastTested}</span>}
    </div>
  );
}

export function RouteSearch({ bankCount }: RouteSearchProps) {
  const [fromBank, setFromBank] = useState<Bank | null>(null);
  const [toBank, setToBank] = useState<Bank | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RouteIntelligence | null>(null);

  async function handleCheckRoute() {
    if (!fromBank || !toBank || fromBank.id === toBank.id) {
      setResult(null);
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const data = await getRouteIntelligence(fromBank.id, toBank.id);
      setResult(data);
    } finally {
      setLoading(false);
    }
  }

  const instantRails = result?.rails.filter((r) => INSTANT_RAILS.has(r.rail)) ?? [];
  const fallbackRails = result?.rails.filter((r) => !INSTANT_RAILS.has(r.rail)) ?? [];
  const hasData = result && result.rails.length > 0;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-left shadow-2xl">
      <form className="mx-auto grid max-w-3xl gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <div className="text-center md:col-span-2 md:row-start-1">
          <h2 className="text-xl font-semibold">Check a transfer route</h2>
          <p className="mt-1 text-sm text-slate-400">
            Choose a sending bank and receiving bank.
          </p>
        </div>

        <div className="md:row-start-2">
          <BankSelect
            label="From bank"
            placeholder="Search sender"
            onChange={setFromBank}
            centerLabel
            centerText
          />
        </div>
        <div className="md:row-start-2">
          <BankSelect
            label="To bank"
            placeholder="Search receiver"
            onChange={setToBank}
            centerLabel
            centerText
          />
        </div>
        <button
          type="button"
          onClick={handleCheckRoute}
          disabled={!fromBank || !toBank || fromBank.id === toBank.id}
          className="rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 md:row-start-2"
        >
          {loading ? "Checking..." : "Check Route"}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-slate-500">{bankCount} banks currently available.</p>

      {fromBank && toBank && fromBank.id === toBank.id && (
        <p className="mt-4 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm text-yellow-200">
          Choose two different banks to check a route.
        </p>
      )}

      {loading && (
        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950 p-5">
          <p className="text-sm uppercase tracking-[0.3em] text-blue-400">
            Analyzing Routes
          </p>
          <div className="mt-4 space-y-2">
            <div className="h-2 w-full animate-pulse rounded bg-slate-800" />
            <div className="h-2 w-3/4 animate-pulse rounded bg-slate-800" />
            <div className="h-2 w-1/2 animate-pulse rounded bg-slate-800" />
          </div>
          <p className="mt-4 text-sm text-slate-500">
            Checking RTP, ACH, FedNow, and wire availability...
          </p>
        </div>
      )}

      {result && !loading && (
        <div className="mt-6 space-y-6 rounded-xl border border-slate-800 bg-slate-950 p-5">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-blue-400">
              Route Intelligence Report
            </p>
            <h3 className="mt-2 text-2xl font-semibold">
              <Link href={`/banks/${fromBank?.slug}`} className="hover:text-blue-300 transition">
                {fromBank?.name}
              </Link>
              {" → "}
              <Link href={`/banks/${toBank?.slug}`} className="hover:text-blue-300 transition">
                {toBank?.name}
              </Link>
            </h3>
          </div>

          {!hasData ? (
            <p className="text-sm text-slate-400">
              {result.message ?? "No data available yet for this route."}
            </p>
          ) : (
            <>
              {instantRails.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs uppercase tracking-wider text-slate-500">
                    Primary Rails (Instant Settlement)
                  </p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {instantRails.map((rail) => {
                      const s = getRailStyle(rail.rail);
                      return (
                        <div key={rail.rail} className={`rounded-lg border ${s.border} ${s.bg} p-3 ${s.text}`}>
                          <div>{s.icon && <span className="mr-1 inline-flex align-middle">{s.icon}</span>}{rail.rail}: {Math.round(rail.successRate * 100)}% success{rail.avgTime !== null && ` · ~${rail.avgTime}m avg`}</div>
                          <RailMeta rail={rail} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {fallbackRails.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs uppercase tracking-wider text-slate-500">
                    Fallback Rails
                  </p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {fallbackRails.map((rail) => {
                      const s = getRailStyle(rail.rail);
                      return (
                        <div key={rail.rail} className={`rounded-lg border ${s.border} ${s.bg} p-3 ${s.text}`}>
                          <div>{s.icon && <span className="mr-1 inline-flex align-middle">{s.icon}</span>}{rail.rail}: {Math.round(rail.successRate * 100)}% success{rail.avgTime !== null && ` · ~${rail.avgTime}m avg`}</div>
                          <RailMeta rail={rail} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-400">
                Based on {result.sampleSize} report{result.sampleSize !== 1 ? "s" : ""}.{" "}
                Confidence:{" "}
                <span
                  className={
                    result.confidence === "HIGH"
                      ? "text-green-400"
                      : result.confidence === "MEDIUM"
                        ? "text-yellow-400"
                        : "text-slate-400"
                  }
                >
                  {result.confidence}
                </span>
                .
              </div>

              <div className="text-xs uppercase tracking-wider text-blue-400">
                Instant Capability:{" "}
                {instantRails.length > 0
                  ? `HIGH (${instantRails.map((r) => r.rail).join(", ")} supported)`
                  : "NONE CONFIRMED"}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
