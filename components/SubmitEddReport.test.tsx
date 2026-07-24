// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SubmitEddReport } from "./SubmitEddReport";

const DEFAULT_RECEIPT = {
  isRepeatReporter: false,
  contributorCountBefore: 0,
  contributorCountAfter: 1,
  crossedVisibility: false,
  crossedLeaderboard: false,
  lines: ["Thanks — your report adds to this bank's EDD evidence."],
};

const submitEddReportMock = vi.fn().mockResolvedValue({ success: true, receipt: DEFAULT_RECEIPT });

vi.mock("@/lib/actions/submitEddReport", () => ({
  submitEddReport: (...args: unknown[]) => submitEddReportMock(...args),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: "user-1", email: "test@example.com" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: () => Promise.resolve(),
    },
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
  submitEddReportMock.mockClear();
  submitEddReportMock.mockResolvedValue({ success: true, receipt: DEFAULT_RECEIPT });
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

    await waitFor(() => expect(submitEddReportMock).toHaveBeenCalledTimes(1));
    expect(submitEddReportMock).toHaveBeenCalledWith(
      expect.objectContaining({ bankId: BANK.id, daysEarly: 0 })
    );

    await waitFor(() => screen.getByText("Thanks — your report adds to this bank's EDD evidence."));

    // The BankSelect field must visually reset, not keep showing the bank
    // from the previous submission (it's uncontrolled internally, so the
    // parent clearing bankId alone doesn't do this — see resetKey).
    expect(screen.getByRole("combobox", { name: "Bank" })).toBeInTheDocument();
    expect(screen.queryByText(BANK.name)).not.toBeInTheDocument();
  });

  it("renders every line of a receipt reporting a leaderboard threshold crossing", async () => {
    const user = userEvent.setup();
    submitEddReportMock.mockResolvedValue({
      success: true,
      receipt: {
        isRepeatReporter: false,
        contributorCountBefore: 4,
        contributorCountAfter: 5,
        crossedVisibility: false,
        crossedLeaderboard: true,
        lines: ["This bank now qualifies for the Early Direct Deposit leaderboard."],
      },
    });
    mockBankSearch([BANK]);
    render(<SubmitEddReport banks />);

    await waitFor(() => screen.getByText("Did a paycheck or benefit show up before the scheduled date?"));

    await pickOption(user, "Bank", BANK.name);
    await pickOption(user, "How early", /Not early/i);
    await user.click(screen.getByRole("button", { name: "Submit Report" }));

    await waitFor(() => screen.getByText("This bank now qualifies for the Early Direct Deposit leaderboard."));
  });
});
