"use client";

import { type ReactNode, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, Check, CircleArrowRight, Copy, Users } from "lucide-react";
import { BankSelect, type Bank } from "@/components/BankSelect";
import { RouteIntelligence } from "@/lib/routingEngine";
import { EVIDENCE_LABELS, type EvidenceState } from "@/lib/routeConfidence";
import { railDisplayName } from "@/lib/railDisplayName";

// Controlled — fromBank/toBank/result/loading are all owned by a parent
// (HomeRouteChecker) so a submitted "Report this route" form can share the
// same selection and refresh evidence in place without RouteSearch keeping
// its own duplicate copy of that state.
type RouteSearchProps = {
  bankCount: number;
  fromBank: Bank | null;
  toBank: Bank | null;
  onFromBankChange: (bank: Bank | null) => void;
  onToBankChange: (bank: Bank | null) => void;
  onCheckRoute: () => void;
  onSwap: () => void;
  onCheckReverse: () => void;
  // Bumped by the parent on every swap/reverse — BankSelect is uncontrolled,
  // so this forces both pickers to remount with their new initial bank
  // rather than trying to resync an already-mounted, uncontrolled input.
  swapKey: number;
  loading: boolean;
  result: RouteIntelligence | null;
};

const INSTANT_RAILS = new Set(["RTP", "FedNow", "Visa Direct", "Mastercard Send"]);

// Color emoji glyphs (💸, ⚡, 🏦) are pre-rendered by the OS's emoji font and
// ignore CSS `color` entirely — an SVG icon is the only way to actually pick
// up the badge's violet/etc. text color via currentColor.
const RAIL_STYLES: Record<string, { border: string; bg: string; text: string; icon: ReactNode }> = {
  RTP:              { border: "border-green-500/30",  bg: "bg-green-500/10",  text: "text-green-300",  icon: "⚡" },
  FedNow:           { border: "border-purple-500/30",  bg: "bg-purple-500/10", text: "text-purple-300", icon: <CircleArrowRight className="inline-block h-[14px] w-[14px]" /> },
  ACH:              { border: "border-blue-500/30",   bg: "bg-blue-500/10",   text: "text-blue-300",   icon: "" },
  Wire:             { border: "border-slate-800",     bg: "bg-slate-900",     text: "text-slate-300",  icon: "" },
  Zelle:            { border: "border-white/30",       bg: "bg-white/10",      text: "text-white",      icon: <Users className="inline-block h-[14px] w-[14px]" /> },
  "Visa Direct":     { border: "border-sky-500/30",    bg: "bg-sky-500/10",    text: "text-sky-300",    icon: "" },
  "Mastercard Send": { border: "border-orange-500/30", bg: "bg-orange-500/10", text: "text-orange-300", icon: "" },
};

function getRailStyle(rail: string) {
  return RAIL_STYLES[rail] ?? { border: "border-slate-700", bg: "bg-slate-900", text: "text-slate-300", icon: "" };
}

// Not a claim of quality — just distinguishes "backed by evidence you can
// trust" (green) from "backed by evidence, but read the label" (yellow/red)
// from "not enough/too old to say anything" (slate).
const EVIDENCE_STYLES: Record<EvidenceState, string> = {
  observed_working: "text-green-400",
  consistently_reported: "text-green-400",
  limited_evidence: "text-slate-400",
  variable_timing: "text-yellow-400",
  reported_delayed: "text-yellow-400",
  reported_unsuccessful: "text-red-400",
  conflicting: "text-orange-400",
  previously_observed: "text-slate-500",
};

function EvidenceLine({
  evidence,
}: {
  evidence: { state: EvidenceState; reportCount: number; latestObservationDate: string; outcome?: string };
}) {
  return (
    <div className={`mt-1 text-xs ${EVIDENCE_STYLES[evidence.state]}`}>
      {EVIDENCE_LABELS[evidence.state]}
      {evidence.outcome && ` (${evidence.outcome})`} · {evidence.reportCount} report
      {evidence.reportCount !== 1 ? "s" : ""} · last observed {evidence.latestObservationDate}
    </div>
  );
}

// The route URL is already shareable/bookmarkable (HomeRouteChecker pushes
// ?from=<slug>&to=<slug> on every check), so this just builds that same URL
// directly from the two slugs rather than reading window.location — avoids
// any dependency on the router push having already committed.
function CopyLinkButton({ fromSlug, toSlug }: { fromSlug: string; toSlug: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function handleCopy() {
    const url = `${window.location.origin}/?from=${fromSlug}&to=${toSlug}`;
    try {
      // clipboard.writeText is unavailable in some contexts (e.g. non-HTTPS,
      // certain in-app browsers) and can also reject on permission denial —
      // either way, fail visibly rather than leaving an unhandled rejection
      // and no feedback that nothing was actually copied.
      await navigator.clipboard.writeText(url);
      setStatus("copied");
    } catch {
      setStatus("failed");
    } finally {
      setTimeout(() => setStatus("idle"), 2000);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 text-slate-400 transition hover:text-blue-300"
    >
      {status === "copied" ? (
        <>
          <Check className="h-3.5 w-3.5" /> Copied
        </>
      ) : status === "failed" ? (
        "Couldn't copy"
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" /> Copy link
        </>
      )}
    </button>
  );
}

function RailMeta({
  rail,
}: {
  rail: {
    directions: ("push" | "pull")[];
    sameDayCount?: number | null;
  };
}) {
  const dirLabel =
    rail.directions.length === 2 ? "Push & Pull" :
    rail.directions[0] === "push" ? "Push only" :
    rail.directions[0] === "pull" ? "Pull only" : null;

  if (!dirLabel && !rail.sameDayCount) return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs opacity-70">
      {dirLabel && <span>{dirLabel}</span>}
      {!!rail.sameDayCount && (
        <span>
          Same-Day ACH in {rail.sameDayCount} report{rail.sameDayCount !== 1 ? "s" : ""}
        </span>
      )}
    </div>
  );
}

export function RouteSearch({
  bankCount,
  fromBank,
  toBank,
  onFromBankChange,
  onToBankChange,
  onCheckRoute,
  onSwap,
  onCheckReverse,
  swapKey,
  loading,
  result,
}: RouteSearchProps) {
  const instantRails = result?.rails.filter((r) => INSTANT_RAILS.has(r.rail)) ?? [];
  const fallbackRails = result?.rails.filter((r) => !INSTANT_RAILS.has(r.rail)) ?? [];
  const hasData = result && result.rails.length > 0;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-left shadow-2xl">
      <form className="mx-auto grid max-w-3xl gap-4 md:grid-cols-[1fr_auto_1fr_auto] md:items-end">
        {/* Spans only the From/Swap/To columns (1-3), not the Check Route
            button's column (4) - that column has no counterpart on the
            left, so including it in the span would pull the centered text
            off from the two dropdowns' actual visual center. */}
        <div className="text-center md:col-span-3 md:row-start-1">
          <h2 className="text-xl font-semibold">Check a transfer route</h2>
          <p className="mt-1 text-sm text-slate-400">
            Choose a sending bank and receiving bank.
          </p>
        </div>

        <div className="md:row-start-2">
          <BankSelect
            key={`from-${swapKey}`}
            label="From bank"
            placeholder="Search sender"
            initialBank={fromBank}
            onChange={onFromBankChange}
            centerLabel
            centerText
          />
        </div>
        <div className="flex justify-center md:row-start-2 md:pb-3">
          <button
            type="button"
            onClick={onSwap}
            disabled={!fromBank && !toBank}
            aria-label="Swap from and to banks"
            title="Swap from and to banks"
            className="rounded-full border border-slate-700 bg-slate-800 p-2 text-slate-300 transition hover:bg-slate-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowLeftRight className="h-4 w-4" />
          </button>
        </div>
        <div className="md:row-start-2">
          <BankSelect
            key={`to-${swapKey}`}
            label="To bank"
            placeholder="Search receiver"
            initialBank={toBank}
            onChange={onToBankChange}
            centerLabel
            centerText
          />
        </div>
        <button
          type="button"
          onClick={onCheckRoute}
          disabled={!fromBank || !toBank || fromBank.id === toBank.id}
          className="rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 md:row-start-2"
        >
          {loading ? "Checking..." : "Check Route"}
        </button>

        <p className="text-center text-sm text-slate-500 md:col-span-3 md:row-start-3">
          {bankCount} banks currently available.
        </p>
      </form>

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

      {result && !loading && fromBank && toBank && (
        <div className="mt-6 space-y-6 rounded-xl border border-slate-800 bg-slate-950 p-5">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-blue-400">
              Route Intelligence Report
            </p>
            <h3 className="mt-2 text-2xl font-semibold">
              <Link href={`/banks/${fromBank.slug}`} className="hover:text-blue-300 transition">
                {fromBank.name}
              </Link>
              {" → "}
              <Link href={`/banks/${toBank.slug}`} className="hover:text-blue-300 transition">
                {toBank.name}
              </Link>
            </h3>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <CopyLinkButton fromSlug={fromBank.slug} toSlug={toBank.slug} />
              <button
                type="button"
                onClick={onCheckReverse}
                className="text-slate-400 underline-offset-2 transition hover:text-blue-300 hover:underline"
              >
                Check {toBank.name} → {fromBank.name}
              </button>
              <Link
                href={`/compare?banks=${fromBank.slug},${toBank.slug}`}
                className="text-slate-400 underline-offset-2 transition hover:text-blue-300 hover:underline"
              >
                Compare these banks
              </Link>
            </div>
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
                          <div>{s.icon && <span className="mr-1 inline-flex align-middle">{s.icon}</span>}{railDisplayName(rail.rail)}{rail.avgTime !== null && ` · ~${rail.avgTime}m avg`}</div>
                          <EvidenceLine evidence={rail.evidence} />
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
                          <div>{s.icon && <span className="mr-1 inline-flex align-middle">{s.icon}</span>}{railDisplayName(rail.rail)}{rail.avgTime !== null && ` · ~${rail.avgTime}m avg`}</div>
                          <EvidenceLine evidence={rail.evidence} />
                          <RailMeta rail={rail} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="text-xs uppercase tracking-wider text-blue-400">
                Instant rails with evidence:{" "}
                {instantRails.length > 0
                  ? instantRails.map((r) => r.rail).join(", ")
                  : "None yet"}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
