// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BankBreadcrumb } from "./BankBreadcrumb";

describe("BankBreadcrumb", () => {
  it("links 'All banks' to /banks", () => {
    render(<BankBreadcrumb bankName="Chase Bank" />);
    expect(screen.getByRole("link", { name: "All banks" })).toHaveAttribute("href", "/banks");
  });

  it("marks the current bank as the current page, not a link", () => {
    render(<BankBreadcrumb bankName="Chase Bank" />);
    const current = screen.getByText("Chase Bank");
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current.tagName).not.toBe("A");
  });

  it("uses a semantic nav landmark", () => {
    render(<BankBreadcrumb bankName="Chase Bank" />);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
  });
});
