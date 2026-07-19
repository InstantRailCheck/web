// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Breadcrumb } from "./Breadcrumb";
import type { BreadcrumbItems } from "@/lib/breadcrumbs";

const ITEMS: BreadcrumbItems = [
  { name: "Home", href: "/" },
  { name: "Compare banks", href: "/compare" },
];

describe("Breadcrumb", () => {
  it("renders linked ancestors and an unlinked current page", () => {
    render(<Breadcrumb items={ITEMS} />);

    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    const current = screen.getByText("Compare banks");
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current.tagName).not.toBe("A");
  });

  it("uses a semantic breadcrumb navigation landmark", () => {
    const { container } = render(<Breadcrumb items={ITEMS} />);
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(nav).toBeInTheDocument();
    expect(container.querySelectorAll("ol > li")).toHaveLength(3);
    expect(container.querySelector('li[aria-hidden="true"]')).toHaveTextContent("/");
  });
});
