// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageBreadcrumb } from "./PageBreadcrumb";
import type { BreadcrumbItems } from "@/lib/breadcrumbs";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-nonce": "test-nonce" })),
}));

describe("PageBreadcrumb", () => {
  it("derives visible navigation and nonce-protected JSON-LD from the same items", async () => {
    const items: BreadcrumbItems = [
      { name: "Home", href: "/" },
      { name: "Compare banks", href: "/compare" },
    ];

    const { container } = render(await PageBreadcrumb({ items }));

    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByText("Compare banks")).toHaveAttribute("aria-current", "page");

    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).toHaveAttribute("nonce", "test-nonce");
    expect(JSON.parse(script?.textContent ?? "")).toMatchObject({
      "@type": "BreadcrumbList",
      itemListElement: [
        { position: 1, name: "Home", item: "https://www.instantrailcheck.com/" },
        { position: 2, name: "Compare banks", item: "https://www.instantrailcheck.com/compare" },
      ],
    });
  });

  it("escapes hostile breadcrumb names inside the inline script", async () => {
    const items: BreadcrumbItems = [
      { name: "Home", href: "/" },
      { name: '</script><script>alert("xss")</script>', href: "/compare" },
    ];

    const { container } = render(await PageBreadcrumb({ items }));
    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script?.innerHTML).not.toContain("<script>");
    expect(script?.innerHTML).toContain("\\u003c/script>");
  });
});
