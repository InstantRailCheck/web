// @vitest-environment jsdom
//
// Isolated from HomeRouteChecker.test.tsx: stubs SubmitRouteReport so this
// file can invoke onSuccess directly with an arbitrary route, without
// driving the real nested form (which shares "From bank"/"To bank" labels
// with RouteSearch and would need auth + rail/direction/status selection
// just to reach submission). The other HomeRouteChecker tests render the
// real SubmitRouteReport for integration coverage — this file trades that
// for a precise, direct test of the orchestrator's own onSuccess handling.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { HomeRouteChecker } from "./HomeRouteChecker";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

// SubmitRouteReport is stubbed below, but HomeRouteChecker's contribution
// CTA also renders the real RequestRouteButton — mock its server action
// (which has its own "server-only" import) and the client Supabase auth
// check it relies on, same as HomeRouteChecker.test.tsx does.
vi.mock("@/lib/actions/requestRoute", () => ({
  requestRoute: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  }),
}));

// HomeRouteChecker fetches /api/routes rather than importing the (now
// server-only) engine directly — mock fetch instead of the module.
const routeApiMock = vi.fn();
function mockFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input), "http://localhost");
      const from = url.searchParams.get("from")!;
      const to = url.searchParams.get("to")!;
      return new Response(JSON.stringify(routeApiMock(from, to)), { status: 200 });
    })
  );
}

let capturedOnSuccess: ((route: { fromBank: unknown; toBank: unknown }) => void | Promise<void>) | null = null;
vi.mock("@/components/SubmitRouteReport", () => ({
  SubmitRouteReport: (props: { onSuccess?: (route: { fromBank: unknown; toBank: unknown }) => void | Promise<void> }) => {
    capturedOnSuccess = props.onSuccess ?? null;
    return <div data-testid="submit-route-report-stub" />;
  },
}));

vi.mock("@/components/SubmitEddReport", () => ({
  SubmitEddReport: () => <div data-testid="submit-edd-report-stub" />,
}));

const BANK_A = { id: "bank-a", slug: "bank-a", name: "Bank A" };
const BANK_B = { id: "bank-b", slug: "bank-b", name: "Bank B" };
const BANK_C = { id: "bank-c", slug: "bank-c", name: "Bank C" };
const BANK_D = { id: "bank-d", slug: "bank-d", name: "Bank D" };

const EVIDENCE_AB = { rails: [{ rail: "RTP", evidence: { state: "limited_evidence" as const, reportCount: 1, latestObservationDate: "2026-07-06", outcome: "success" as const }, avgTime: null, directions: [], sameDayCount: null }] };
const EVIDENCE_CD = { rails: [{ rail: "ACH", evidence: { state: "observed_working" as const, reportCount: 2, latestObservationDate: "2026-07-08" }, avgTime: null, directions: [], sameDayCount: null }] };

beforeEach(() => {
  pushMock.mockClear();
  routeApiMock.mockReset();
  capturedOnSuccess = null;
});

describe("HomeRouteChecker — editing the prefilled report before submitting", () => {
  it("refetches the actually-submitted route, not the originally checked one", async () => {
    routeApiMock.mockImplementation((from: string, to: string) => {
      if (from === BANK_A.id && to === BANK_B.id) return EVIDENCE_AB;
      if (from === BANK_C.id && to === BANK_D.id) return EVIDENCE_CD;
      return { rails: [] };
    });
    mockFetch();

    render(<HomeRouteChecker bankCount={100} initialFromBank={BANK_A} initialToBank={BANK_B} />);
    await waitFor(() => screen.getByText(/Limited evidence/));
    expect(routeApiMock).toHaveBeenCalledWith(BANK_A.id, BANK_B.id);

    // Simulate the user having edited the prefilled form to a different
    // route (C -> D) and successfully submitted it — SubmitRouteReport
    // reports back what was *actually* submitted via onSuccess's argument.
    expect(capturedOnSuccess).not.toBeNull();
    await capturedOnSuccess!({ fromBank: BANK_C, toBank: BANK_D });

    await waitFor(() => expect(routeApiMock).toHaveBeenCalledWith(BANK_C.id, BANK_D.id));
    await waitFor(() => screen.getByText(/Observed working/));
    // The stale A -> B evidence must be gone, replaced by C -> D's.
    expect(screen.queryByText(/Limited evidence/)).not.toBeInTheDocument();

    // The URL also updates to reflect the submitted route, not the original.
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining(`from=${BANK_C.slug}&to=${BANK_D.slug}`));
  });
});
