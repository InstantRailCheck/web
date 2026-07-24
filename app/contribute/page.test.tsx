// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/actions/requestRoute", () => ({
  requestRoute: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  }),
}));

// The async default export awaits several mocked data-layer calls, which
// @testing-library/react can't render outside a real RSC runtime — same
// boundary app/routes/needs-fresh-reports/page.test.tsx already draws
// (it tests generateMetadata + the exported RouteRow, never the page
// itself). This file mirrors that: static `metadata` + the exported,
// synchronous PrivateSummaryPanel are what's actually testable here.
const { metadata, PrivateSummaryPanel } = await import("./page");

describe("/contribute metadata", () => {
  it("is indexed normally with the bare canonical — unlike /routes/needs-fresh-reports, this is a permanent, prominent hub", () => {
    expect(metadata.alternates).toEqual({ canonical: "https://www.instantrailcheck.com/contribute" });
    expect(metadata.robots).toBeUndefined();
  });
});

describe("PrivateSummaryPanel", () => {
  it("always shows the three counts, even when all are zero", () => {
    render(
      <PrivateSummaryPanel
        summary={{
          routeReports: { total: 0, recent: [] },
          eddReports: { total: 0, recent: [] },
          openRequests: { total: 0, recent: [] },
        }}
      />
    );
    expect(screen.getByText("Route reports")).toBeInTheDocument();
    expect(screen.getByText("EDD reports")).toBeInTheDocument();
    expect(screen.getByText("Open requests")).toBeInTheDocument();
  });

  it("renders recent route reports, EDD reports, and open requests when present", () => {
    render(
      <PrivateSummaryPanel
        summary={{
          routeReports: {
            total: 1,
            recent: [
              {
                type: "route_reports",
                id: "r1",
                createdAt: "2026-01-01T00:00:00Z",
                attributable: true,
                userId: "u1",
                fromBankName: "Bank A",
                toBankName: "Bank B",
                railUsed: "RTP",
                direction: "push",
                status: "success",
                testedAt: "2026-01-01",
                settlementTimeMinutes: null,
                sameDay: null,
                notes: null,
              },
            ],
          },
          eddReports: {
            total: 1,
            recent: [
              {
                type: "edd_reports",
                id: "e1",
                createdAt: "2026-01-01T00:00:00Z",
                attributable: true,
                userId: "u1",
                bankName: "Bank C",
                daysEarly: 2,
                depositType: null,
                payrollProvider: null,
              },
            ],
          },
          openRequests: {
            total: 1,
            recent: [
              {
                type: "route_requests",
                id: "q1",
                createdAt: "2026-01-01T00:00:00Z",
                attributable: true,
                userId: "u1",
                fromBankName: "Bank D",
                toBankName: "Bank E",
                fulfilledAt: null,
              },
            ],
          },
        }}
      />
    );

    expect(screen.getByText(/Bank A → Bank B/)).toBeInTheDocument();
    expect(screen.getByText("Bank C")).toBeInTheDocument();
    expect(screen.getByText(/Bank D → Bank E/)).toBeInTheDocument();
  });

  it("does not render an empty recent-items section when there's nothing to show", () => {
    const { container } = render(
      <PrivateSummaryPanel
        summary={{
          routeReports: { total: 0, recent: [] },
          eddReports: { total: 0, recent: [] },
          openRequests: { total: 0, recent: [] },
        }}
      />
    );
    expect(container.querySelector(".border-t")).toBeNull();
  });
});
