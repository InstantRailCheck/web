// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { NeedsFreshReportRoute } from "@/lib/needsFreshReports";

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

const { generateMetadata, RouteRow } = await import("./page");

describe("/routes/needs-fresh-reports generateMetadata", () => {
  it("is noindex,follow with the bare canonical for page 1 (default)", async () => {
    const result = await generateMetadata({ searchParams: Promise.resolve({}) });
    expect(result).toEqual({
      alternates: { canonical: "https://www.instantrailcheck.com/routes/needs-fresh-reports" },
      robots: { index: false, follow: true },
    });
  });

  it("self-canonicalizes page 2+ while staying noindex,follow", async () => {
    const result = await generateMetadata({ searchParams: Promise.resolve({ page: "2" }) });
    expect(result).toEqual({
      alternates: { canonical: "https://www.instantrailcheck.com/routes/needs-fresh-reports?page=2" },
      robots: { index: false, follow: true },
    });
  });

  it("normalizes an invalid page param (decimal) to page 1's canonical", async () => {
    const result = await generateMetadata({ searchParams: Promise.resolve({ page: "2.5" }) });
    expect(result.alternates).toEqual({ canonical: "https://www.instantrailcheck.com/routes/needs-fresh-reports" });
  });
});

describe("RouteRow", () => {
  const route: NeedsFreshReportRoute = {
    fromBankId: "bank-a",
    fromBankSlug: "bank-a",
    fromBankName: "Bank A",
    toBankId: "bank-b",
    toBankSlug: "bank-b",
    toBankName: "Bank B",
    reason: "no_evidence",
    lastObservationDate: null,
    requestCount: 3,
  };

  it("renders the route link and the request button as siblings, not nested", () => {
    const { container } = render(<RouteRow route={route} />);

    const link = screen.getByRole("link", { name: /Bank A → Bank B/ });
    const button = screen.getByRole("button", { name: "Request this route" });

    // The actual regression this guards against: an interactive button
    // nested inside the <a> Link renders is invalid HTML and breaks click
    // targeting. Assert the DOM relationship directly, not just that both
    // elements exist somewhere on the page.
    expect(link.contains(button)).toBe(false);
    expect(button.closest("a")).toBeNull();

    // Both are children of the same row container.
    const row = container.firstElementChild!;
    expect(row.contains(link)).toBe(true);
    expect(row.contains(button)).toBe(true);
  });

  it("links to the homepage checker with both bank slugs prefilled", () => {
    render(<RouteRow route={route} />);
    expect(screen.getByRole("link", { name: /Bank A → Bank B/ })).toHaveAttribute(
      "href",
      "/?from=bank-a&to=bank-b#search"
    );
  });

  it("shows the active request count in the reason line", () => {
    render(<RouteRow route={route} />);
    expect(screen.getByText(/requested by 3 members/)).toBeInTheDocument();
  });

  it("does not mention a request count when there are none", () => {
    render(<RouteRow route={{ ...route, requestCount: 0 }} />);
    expect(screen.queryByText(/requested by/)).not.toBeInTheDocument();
  });
});
