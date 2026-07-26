// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RouteSearch } from "./RouteSearch";

const BANK_A = { id: "bank-a", slug: "bank-a", name: "Bank A" };
const BANK_B = { id: "bank-b", slug: "bank-b", name: "Bank B" };

function renderRouteSearch(overrides: Partial<React.ComponentProps<typeof RouteSearch>> = {}) {
  return render(
    <RouteSearch
      bankCount={10}
      fromBank={BANK_A}
      toBank={BANK_B}
      onFromBankChange={vi.fn()}
      onToBankChange={vi.fn()}
      onCheckRoute={vi.fn()}
      onSwap={vi.fn()}
      onCheckReverse={vi.fn()}
      swapKey={0}
      loading={false}
      result={null}
      {...overrides}
    />
  );
}

describe("RouteSearch — form submission", () => {
  it("submits via the form (e.g. pressing Enter), not only via the button's own click handler", () => {
    const onCheckRoute = vi.fn();
    renderRouteSearch({ onCheckRoute });

    const button = screen.getByRole("button", { name: "Check Route" });
    expect(button).toHaveAttribute("type", "submit");
    fireEvent.submit(button.closest("form")!);

    expect(onCheckRoute).toHaveBeenCalledTimes(1);
  });

  it("does not navigate the page on submit (preventDefault called)", () => {
    renderRouteSearch();
    const form = screen.getByRole("button", { name: "Check Route" }).closest("form")!;
    const event = new Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("RouteSearch — accessibility", () => {
  it("marks the same-bank warning as an alert", () => {
    renderRouteSearch({ toBank: BANK_A });
    expect(screen.getByRole("alert")).toHaveTextContent("Choose two different banks to check a route.");
  });

  it("marks the loading state as a status region", () => {
    renderRouteSearch({ loading: true });
    expect(screen.getByRole("status")).toHaveTextContent("Analyzing Routes");
  });
});
