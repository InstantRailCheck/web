// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SubmitEddReport } from "./SubmitEddReport";

const insertMock = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: "user-1", email: "test@example.com" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: () => Promise.resolve(),
    },
    from: () => ({ insert: insertMock }),
  }),
}));

const BANK = { id: "bank-1", slug: "some-bank", name: "Some Bank" };

function mockBankSearch(banks: Array<{ id: string; slug: string; name: string }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ banks }), { status: 200 }))
  );
}

// Each field's <label> is connected to its trigger via aria-labelledby, so
// triggers are queryable by their field label as an accessible name.
async function pickOption(user: ReturnType<typeof userEvent.setup>, fieldLabel: string, optionName: RegExp | string) {
  await user.click(screen.getByRole("combobox", { name: fieldLabel }));
  await user.click(await screen.findByRole("option", { name: optionName }));
}

beforeEach(() => {
  insertMock.mockClear();
});

describe("SubmitEddReport — submit behavior (bank-picker page)", () => {
  it("resets the Bank field back to its placeholder after a successful submit", async () => {
    const user = userEvent.setup();
    mockBankSearch([BANK]);
    render(<SubmitEddReport banks />);

    await waitFor(() => screen.getByText("Did a paycheck or benefit show up before the scheduled date?"));

    await pickOption(user, "Bank", BANK.name);
    await pickOption(user, "How early", /Not early/i);

    await user.click(screen.getByRole("button", { name: "Submit Report" }));

    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1));
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ bank_id: BANK.id, days_early: 0 })
    );

    await waitFor(() => screen.getByText("Report submitted — thank you!"));

    // The BankSelect field must visually reset, not keep showing the bank
    // from the previous submission (it's uncontrolled internally, so the
    // parent clearing bankId alone doesn't do this — see resetKey).
    expect(screen.getByRole("combobox", { name: "Bank" })).toBeInTheDocument();
    expect(screen.queryByText(BANK.name)).not.toBeInTheDocument();
  });
});
