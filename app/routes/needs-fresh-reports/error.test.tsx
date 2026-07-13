// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NeedsFreshReportsError from "./error";

describe("NeedsFreshReportsError", () => {
  it("renders a fallback message", () => {
    render(<NeedsFreshReportsError error={new Error("boom")} unstable_retry={() => {}} />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("calls unstable_retry when the retry button is clicked", async () => {
    const unstable_retry = vi.fn();
    render(<NeedsFreshReportsError error={new Error("boom")} unstable_retry={unstable_retry} />);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(unstable_retry).toHaveBeenCalledOnce();
  });
});
