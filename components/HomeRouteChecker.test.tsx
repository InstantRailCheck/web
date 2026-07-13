// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomeRouteChecker } from "./HomeRouteChecker";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("@/lib/actions/addBank", () => ({
  addBank: vi.fn(),
}));

vi.mock("@/lib/actions/requestRoute", () => ({
  requestRoute: vi.fn(),
}));

vi.mock("@/lib/actions/submitRouteReport", () => ({
  submitRouteReport: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: () => Promise.resolve(),
    },
    from: () => ({ insert: vi.fn() }),
  }),
}));

const BANK_A = { id: "bank-a", slug: "bank-a", name: "Bank A" };
const BANK_B = { id: "bank-b", slug: "bank-b", name: "Bank B" };
const BANK_C = { id: "bank-c", slug: "bank-c", name: "Bank C" };

// HomeRouteChecker no longer imports lib/routingEngine directly (it's
// server-only, admin-client-backed) — it fetches /api/routes like a real
// browser would. This single fetch mock routes both that and BankSelect's
// /api/bank-search based on the request path.
const routeApiMock = vi.fn();
function mockFetch(banks: Array<{ id: string; slug: string; name: string }> = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/bank-search") {
        return new Response(JSON.stringify({ banks }), { status: 200 });
      }
      if (url.pathname === "/api/routes") {
        const from = url.searchParams.get("from")!;
        const to = url.searchParams.get("to")!;
        // Awaited (not just returned) so a test can hand back a pending
        // promise it controls the resolution of, e.g. to exercise the
        // stale-response race — a plain value still resolves immediately.
        const data = await routeApiMock(from, to);
        return new Response(JSON.stringify(data), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    })
  );
}

const NO_EVIDENCE = { rails: [], message: "No data available yet for this route" };
const WITH_EVIDENCE = {
  rails: [
    {
      rail: "RTP",
      evidence: { state: "limited_evidence" as const, reportCount: 1, latestObservationDate: "2026-07-06", outcome: "success" as const },
      avgTime: null,
      directions: ["push" as const],
      sameDayCount: null,
    },
  ],
};
const STALE_ONLY_EVIDENCE = {
  rails: [
    {
      rail: "RTP",
      evidence: { state: "previously_observed" as const, reportCount: 2, latestObservationDate: "2025-11-01" },
      avgTime: null,
      directions: ["push" as const],
      sameDayCount: null,
    },
  ],
};

beforeEach(() => {
  pushMock.mockClear();
  refreshMock.mockClear();
  routeApiMock.mockReset();
  routeApiMock.mockReturnValue(NO_EVIDENCE);
  mockFetch();
});

describe("HomeRouteChecker — shared URL restoration", () => {
  it("auto-fetches on mount when both initial banks resolve and differ", async () => {
    routeApiMock.mockReturnValue(WITH_EVIDENCE);
    render(<HomeRouteChecker bankCount={100} initialFromBank={BANK_A} initialToBank={BANK_B} />);

    await waitFor(() => expect(routeApiMock).toHaveBeenCalledWith(BANK_A.id, BANK_B.id));
    await waitFor(() => screen.getByText(/Limited evidence/));
  });

  it("passes from/to in the order given, so a reversed slug pair checks the reverse route", async () => {
    render(<HomeRouteChecker bankCount={100} initialFromBank={BANK_B} initialToBank={BANK_A} />);

    await waitFor(() => expect(routeApiMock).toHaveBeenCalledWith(BANK_B.id, BANK_A.id));
  });

  it("does not auto-fetch when the two initial banks are identical", async () => {
    render(<HomeRouteChecker bankCount={100} initialFromBank={BANK_A} initialToBank={BANK_A} />);

    await waitFor(() => screen.getByText("Choose two different banks to check a route."));
    expect(routeApiMock).not.toHaveBeenCalled();
  });

  it("does not auto-fetch when only one side resolved (invalid/missing slug)", async () => {
    render(<HomeRouteChecker bankCount={100} initialFromBank={BANK_A} initialToBank={null} />);

    // Give any errant async fetch a chance to fire before asserting it didn't.
    await new Promise((r) => setTimeout(r, 10));
    expect(routeApiMock).not.toHaveBeenCalled();
    expect(screen.getByText("Bank A")).toBeInTheDocument();
  });

  it("does not auto-fetch when neither side resolved (plain homepage)", async () => {
    render(<HomeRouteChecker bankCount={100} initialFromBank={null} initialToBank={null} />);

    await new Promise((r) => setTimeout(r, 10));
    expect(routeApiMock).not.toHaveBeenCalled();
  });
});

describe("HomeRouteChecker — clearing stale evidence on selection change", () => {
  it("clears the previous route's evidence as soon as a bank selection changes, before Check Route is clicked again", async () => {
    const user = userEvent.setup();
    routeApiMock.mockReturnValue(WITH_EVIDENCE);
    render(<HomeRouteChecker bankCount={100} initialFromBank={BANK_A} initialToBank={BANK_B} />);
    await waitFor(() => screen.getByText(/Limited evidence/));

    // RouteSearch and the always-rendered SubmitRouteReport form both have a
    // "From bank" field — scope to RouteSearch's own container so the query
    // is unambiguous.
    const routeSearchSection = screen.getByText("Check a transfer route").closest<HTMLElement>("div.rounded-2xl")!;
    mockFetch([BANK_C]);
    await user.click(within(routeSearchSection).getByRole("combobox", { name: "From bank" }));
    await user.click(await screen.findByRole("option", { name: BANK_C.name }));

    // The A -> B evidence must be gone immediately — not still shown
    // underneath a heading that now reads "Bank C -> Bank B".
    expect(screen.queryByText(/Limited evidence/)).not.toBeInTheDocument();
    expect(screen.queryByText("No data available yet for this route")).not.toBeInTheDocument();
  });
});

describe("HomeRouteChecker — contribution CTA", () => {
  it("shows the CTA with the exact required copy when a checked route has no evidence", async () => {
    render(<HomeRouteChecker bankCount={100} initialFromBank={BANK_A} initialToBank={BANK_B} />);

    await waitFor(() => screen.getByText("No community evidence yet for this route. Have you tried it?"));
    expect(screen.getByRole("button", { name: "Report this route" })).toBeInTheDocument();
  });

  it("shows a distinct 'Request this route' action alongside 'Report this route', with copy that never uses report/evidence language", async () => {
    render(<HomeRouteChecker bankCount={100} initialFromBank={BANK_A} initialToBank={BANK_B} />);

    await waitFor(() => screen.getByText("No community evidence yet for this route. Have you tried it?"));
    const reportButton = screen.getByRole("button", { name: "Report this route" });
    const requestButton = screen.getByRole("button", { name: "Request this route" });
    expect(reportButton).toBeInTheDocument();
    expect(requestButton).toBeInTheDocument();
    expect(reportButton).not.toBe(requestButton);
    expect(
      screen.getByText("Don't have evidence yourself? Requesting just lets others know this route needs checking.")
    ).toBeInTheDocument();
  });

  it("does not show the CTA when the route has evidence", async () => {
    routeApiMock.mockReturnValue(WITH_EVIDENCE);
    render(<HomeRouteChecker bankCount={100} initialFromBank={BANK_A} initialToBank={BANK_B} />);

    await waitFor(() => screen.getByText(/Limited evidence/));
    expect(screen.queryByText("No community evidence yet for this route. Have you tried it?")).not.toBeInTheDocument();
  });

  it("does not show the CTA before a route has been checked", () => {
    render(<HomeRouteChecker bankCount={100} initialFromBank={null} initialToBank={null} />);
    expect(screen.queryByText("No community evidence yet for this route. Have you tried it?")).not.toBeInTheDocument();
  });

  it("shows the stale-evidence CTA (distinct copy) when every rail is previously_observed", async () => {
    routeApiMock.mockReturnValue(STALE_ONLY_EVIDENCE);
    render(<HomeRouteChecker bankCount={100} initialFromBank={BANK_A} initialToBank={BANK_B} />);

    await waitFor(() =>
      screen.getByText("This route needs a fresh report — the evidence on file is over 180 days old.")
    );
    expect(screen.getByRole("button", { name: "Report this route" })).toBeInTheDocument();
    expect(screen.queryByText("No community evidence yet for this route. Have you tried it?")).not.toBeInTheDocument();
  });

  it("links to the needs-fresh-reports list whenever the contribution CTA is shown", async () => {
    render(<HomeRouteChecker bankCount={100} initialFromBank={BANK_A} initialToBank={BANK_B} />);

    await waitFor(() => screen.getByText("No community evidence yet for this route. Have you tried it?"));
    expect(screen.getByRole("link", { name: "See other routes that need fresh reports →" })).toHaveAttribute(
      "href",
      "/routes/needs-fresh-reports"
    );
  });

  it("does not show the discovery link when the CTA itself isn't shown", async () => {
    routeApiMock.mockReturnValue(WITH_EVIDENCE);
    render(<HomeRouteChecker bankCount={100} initialFromBank={BANK_A} initialToBank={BANK_B} />);

    await waitFor(() => screen.getByText(/Limited evidence/));
    expect(screen.queryByRole("link", { name: "See other routes that need fresh reports →" })).not.toBeInTheDocument();
  });
});

describe("HomeRouteChecker — swap, copy link, reverse check, compare", () => {
  it("swaps the two selections without re-checking, clearing the previous result", async () => {
    const user = userEvent.setup();
    routeApiMock.mockReturnValue(WITH_EVIDENCE);
    render(<HomeRouteChecker bankCount={100} initialFromBank={BANK_A} initialToBank={BANK_B} />);
    await waitFor(() => screen.getByText(/Limited evidence/));
    routeApiMock.mockClear();

    await user.click(screen.getByRole("button", { name: "Swap from and to banks" }));

    expect(screen.getByRole("combobox", { name: "From bank" })).toHaveTextContent(BANK_B.name);
    expect(screen.getByRole("combobox", { name: "To bank" })).toHaveTextContent(BANK_A.name);
    expect(screen.queryByText(/Limited evidence/)).not.toBeInTheDocument();
    expect(routeApiMock).not.toHaveBeenCalled();
  });

  it("ignores a stale response that resolves after the selection has already moved on (async race)", async () => {
    const user = userEvent.setup();
    let resolveFirst!: (data: unknown) => void;
    const firstRequest = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    // Only the initial A->B auto-fetch is deferred; anything else (there
    // shouldn't be another call in this test) would resolve immediately.
    routeApiMock.mockImplementation((from: string) => (from === BANK_A.id ? firstRequest : WITH_EVIDENCE));

    render(<HomeRouteChecker bankCount={100} initialFromBank={BANK_A} initialToBank={BANK_B} />);
    // The A -> B auto-fetch is now in flight and deliberately left unresolved.

    await user.click(screen.getByRole("button", { name: "Swap from and to banks" }));
    expect(screen.getByRole("combobox", { name: "From bank" })).toHaveTextContent(BANK_B.name);
    expect(screen.getByRole("combobox", { name: "To bank" })).toHaveTextContent(BANK_A.name);

    // Resolve the stale A -> B request now that the selection has moved on.
    resolveFirst(WITH_EVIDENCE);
    await new Promise((r) => setTimeout(r, 10));

    // Must not misattribute the A->B evidence to the now-displayed B->A
    // pair, and swapping must have cleared "loading" rather than leaving it
    // stuck waiting for a resolution that's now ignored.
    expect(screen.queryByText(/Limited evidence/)).not.toBeInTheDocument();
    expect(screen.queryByText("Analyzing Routes")).not.toBeInTheDocument();
  });

  it("copies the shareable route URL to the clipboard and shows 'Copied' feedback", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    routeApiMock.mockReturnValue(WITH_EVIDENCE);
    render(<HomeRouteChecker bankCount={100} initialFromBank={BANK_A} initialToBank={BANK_B} />);
    await waitFor(() => screen.getByText(/Limited evidence/));

    await user.click(screen.getByRole("button", { name: "Copy link" }));

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/?from=${BANK_A.slug}&to=${BANK_B.slug}`);
    await screen.findByRole("button", { name: "Copied" });
  });

  it("shows 'Couldn't copy' feedback (not an unhandled rejection) when the clipboard write fails", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    routeApiMock.mockReturnValue(WITH_EVIDENCE);
    render(<HomeRouteChecker bankCount={100} initialFromBank={BANK_A} initialToBank={BANK_B} />);
    await waitFor(() => screen.getByText(/Limited evidence/));

    await user.click(screen.getByRole("button", { name: "Copy link" }));

    await screen.findByRole("button", { name: "Couldn't copy" });
  });

  it("checks the reverse direction and pushes the swapped URL when the reverse-check link is clicked", async () => {
    const user = userEvent.setup();
    routeApiMock.mockReturnValue(WITH_EVIDENCE);
    render(<HomeRouteChecker bankCount={100} initialFromBank={BANK_A} initialToBank={BANK_B} />);
    await waitFor(() => screen.getByText(/Limited evidence/));
    routeApiMock.mockClear();
    pushMock.mockClear();

    await user.click(screen.getByRole("button", { name: `Check ${BANK_B.name} → ${BANK_A.name}` }));

    await waitFor(() => expect(routeApiMock).toHaveBeenCalledWith(BANK_B.id, BANK_A.id));
    expect(pushMock).toHaveBeenCalledWith(`/?from=${BANK_B.slug}&to=${BANK_A.slug}#search`);
    expect(screen.getByRole("combobox", { name: "From bank" })).toHaveTextContent(BANK_B.name);
    expect(screen.getByRole("combobox", { name: "To bank" })).toHaveTextContent(BANK_A.name);
  });

  it("links to the compare page with both bank slugs once a result is shown", async () => {
    routeApiMock.mockReturnValue(WITH_EVIDENCE);
    render(<HomeRouteChecker bankCount={100} initialFromBank={BANK_A} initialToBank={BANK_B} />);
    await waitFor(() => screen.getByText(/Limited evidence/));

    expect(screen.getByRole("link", { name: "Compare these banks" })).toHaveAttribute(
      "href",
      `/compare?banks=${BANK_A.slug},${BANK_B.slug}`
    );
  });
});
