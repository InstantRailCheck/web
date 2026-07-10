// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomeRouteChecker } from "./HomeRouteChecker";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/actions/addBank", () => ({
  addBank: vi.fn(),
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
        const data = routeApiMock(from, to);
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

beforeEach(() => {
  pushMock.mockClear();
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
});
