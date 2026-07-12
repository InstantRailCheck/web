"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RouteSearch } from "@/components/RouteSearch";
import { SubmitRouteReport } from "@/components/SubmitRouteReport";
import { SubmitEddReport } from "@/components/SubmitEddReport";
import type { Bank } from "@/components/BankSelect";
import type { RouteIntelligence } from "@/lib/routingEngine";

// Route evidence includes attribution data (user_id) internally, so it's
// only ever read server-side via the admin client — RLS denies public
// SELECT on route_reports entirely. The browser must go through this public
// API, never import lib/routingEngine directly (it's marked server-only).
async function fetchRouteIntelligence(fromId: string, toId: string): Promise<RouteIntelligence> {
  const res = await fetch(`/api/routes?from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}`);
  return res.json();
}

type Props = {
  bankCount: number;
  initialFromBank: Bank | null;
  initialToBank: Bank | null;
};

// Owns fromBank/toBank/result/loading centrally so RouteSearch (the picker +
// results UI) and SubmitRouteReport (the "report this route" form) can share
// one selection instead of each keeping an independent, uncoordinated copy —
// see the state-ownership discussion this component's design came out of.
//
// Keyed by the parent (app/page.tsx) on the resolved from/to slugs: BankSelect
// is uncontrolled (its initialBank prop only seeds first mount), so a shared
// URL or browser back/forward that should show a different route relies on a
// full remount here rather than trying to resync already-mounted pickers.
const shouldAutoFetch = (from: Bank | null, to: Bank | null) => !!from && !!to && from.id !== to.id;

export function HomeRouteChecker({ bankCount, initialFromBank, initialToBank }: Props) {
  const router = useRouter();
  const [fromBank, setFromBank] = useState<Bank | null>(initialFromBank);
  const [toBank, setToBank] = useState<Bank | null>(initialToBank);
  // Seeded directly (not via an effect) so there's no flash of "not loading"
  // before a mount-time auto-fetch's own setState would otherwise fire.
  const [loading, setLoading] = useState(() => shouldAutoFetch(initialFromBank, initialToBank));
  const [result, setResult] = useState<RouteIntelligence | null>(null);
  const [swapKey, setSwapKey] = useState(0);
  const resultRef = useRef<HTMLDivElement>(null);

  async function checkRoute(from: Bank, to: Bank) {
    setLoading(true);
    setResult(null);
    try {
      const data = await fetchRouteIntelligence(from.id, to.id);
      setResult(data);
    } finally {
      setLoading(false);
    }
  }

  // Shared URL / back-forward restoration: auto-fetch once on mount if both
  // sides resolved server-side and differ. A single slug that failed to
  // resolve (or two identical slugs) intentionally does not auto-fetch —
  // the existing same-bank warning in RouteSearch covers the latter. Calls
  // the API directly (not checkRoute) so nothing sets state synchronously
  // within the effect body itself — only the eventual .then() does.
  useEffect(() => {
    if (!shouldAutoFetch(initialFromBank, initialToBank)) return;
    let cancelled = false;
    fetchRouteIntelligence(initialFromBank!.id, initialToBank!.id).then((data) => {
      if (!cancelled) {
        setResult(data);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
    // Runs once per mount only — a new route (via URL push or back/forward)
    // arrives as a full remount (see the key comment above), not a prop change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Shared by both a normal "Check Route" click and the reverse-direction
  // shortcut below — fetches evidence and pushes the shareable URL for
  // whichever from/to pair is passed in. Fire-and-forget on the URL push;
  // it doesn't gate the fetch, so there's no round trip before results
  // start loading.
  function runCheck(from: Bank, to: Bank) {
    void checkRoute(from, to);
    router.push(`/?from=${from.slug}&to=${to.slug}#search`);
  }

  function handleCheckRoute() {
    if (!fromBank || !toBank || fromBank.id === toBank.id) {
      setResult(null);
      return;
    }
    runCheck(fromBank, toBank);
  }

  // Swaps the two selections without checking. BankSelect is uncontrolled
  // (initialBank only seeds first mount), so swapKey forces both pickers to
  // remount with their new initial values rather than trying to resync an
  // already-mounted, uncontrolled input — same reasoning as the parent
  // component's own remount-on-slug-change design.
  function handleSwap() {
    if (!fromBank && !toBank) return;
    setFromBank(toBank);
    setToBank(fromBank);
    setResult(null);
    setSwapKey((k) => k + 1);
  }

  // One-click "check the other direction" from an existing result — route
  // evidence is directional, so someone looking at A->B's result is often
  // specifically curious about B->A next. Swaps (same remount reasoning as
  // handleSwap) and immediately re-checks rather than requiring a manual
  // swap + Check Route.
  function handleCheckReverse() {
    if (!fromBank || !toBank) return;
    const newFrom = toBank;
    const newTo = fromBank;
    setFromBank(newFrom);
    setToBank(newTo);
    setSwapKey((k) => k + 1);
    runCheck(newFrom, newTo);
  }

  // Changing either side must immediately drop the previous route's result
  // (and with it, the contribution CTA) — otherwise the "X -> Y" heading
  // updates to the newly selected banks while the evidence rendered below it
  // still belongs to whatever route was last checked, visually misattributing
  // real evidence to the wrong pair until "Check Route" is clicked again.
  function handleFromBankChange(bank: Bank | null) {
    setFromBank(bank);
    setResult(null);
  }

  function handleToBankChange(bank: Bank | null) {
    setToBank(bank);
    setResult(null);
  }

  async function handleReportSuccess(route: { fromBank: Bank; toBank: Bank }) {
    setFromBank(route.fromBank);
    setToBank(route.toBank);
    router.push(`/?from=${route.fromBank.slug}&to=${route.toBank.slug}#search`);
    await checkRoute(route.fromBank, route.toBank);
    resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const hasEvidence = !!result && result.rails.length > 0;
  // All rails present but every one of them stale (>180 days, per
  // lib/routeConfidence.ts's FRESHNESS_WINDOW_DAYS) is functionally the same
  // "needs a fresh report" situation as no evidence at all — a mix of fresh
  // and stale rails is left alone, since at least one rail already has
  // current evidence.
  const isStaleOnly =
    !!result && result.rails.length > 0 && result.rails.every((r) => r.evidence.state === "previously_observed");
  const showContributionCta =
    !loading && !!result && (!hasEvidence || isStaleOnly) && !!fromBank && !!toBank && fromBank.id !== toBank.id;

  return (
    <>
      <div ref={resultRef}>
        <RouteSearch
          bankCount={bankCount}
          fromBank={fromBank}
          toBank={toBank}
          onFromBankChange={handleFromBankChange}
          onToBankChange={handleToBankChange}
          onCheckRoute={handleCheckRoute}
          onSwap={handleSwap}
          onCheckReverse={handleCheckReverse}
          swapKey={swapKey}
          loading={loading}
          result={result}
        />
      </div>

      {showContributionCta && (
        <div className="mt-6 rounded-2xl border border-blue-500/30 bg-blue-500/10 p-6 text-center">
          <p className="text-sm text-blue-100">
            {isStaleOnly
              ? "This route needs a fresh report — the evidence on file is over 180 days old."
              : "No community evidence yet for this route. Have you tried it?"}
          </p>
          <button
            type="button"
            onClick={() =>
              document.getElementById("submit-route-report")?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
            className="mt-4 rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-500"
          >
            Report this route
          </button>
        </div>
      )}

      <SubmitRouteReport initialFromBank={fromBank} initialToBank={toBank} onSuccess={handleReportSuccess} />
      <SubmitEddReport banks={true} />
    </>
  );
}
