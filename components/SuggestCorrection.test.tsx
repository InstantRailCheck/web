// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SuggestCorrection } from "./SuggestCorrection";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: "user-1" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  }),
}));

const submitCorrectionMock = vi.fn();
vi.mock("@/lib/actions/submitCorrection", () => ({
  submitCorrection: (...args: unknown[]) => submitCorrectionMock(...args),
}));

beforeEach(() => {
  submitCorrectionMock.mockReset();
});

async function openForm() {
  const user = userEvent.setup();
  render(<SuggestCorrection bankId="bank-1" />);
  await user.click(screen.getByRole("button", { name: /Suggest a correction/i }));
  return user;
}

describe("SuggestCorrection accessibility", () => {
  it("associates visible labels with the field select and the value input", async () => {
    await openForm();
    expect(screen.getByLabelText("Field")).toBeInstanceOf(HTMLSelectElement);
    expect(screen.getByLabelText("New value")).toHaveAttribute("placeholder", "https://example.com");
  });

  it("marks a rejected/error result as an alert", async () => {
    submitCorrectionMock.mockResolvedValue({ status: "error", message: "Invalid correction value." });
    const user = await openForm();

    await user.type(screen.getByLabelText("New value"), "not-a-url");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid correction value.");
  });

  it("marks an auto-applied result as a status region, not an alert", async () => {
    submitCorrectionMock.mockResolvedValue({ status: "auto_applied", message: "Thanks — this matched our official source." });
    const user = await openForm();

    await user.type(screen.getByLabelText("New value"), "https://example.com");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Thanks");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
