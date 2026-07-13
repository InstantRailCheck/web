// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SubmitRouteReport } from "./SubmitRouteReport";

const submitRouteReportMock = vi.fn().mockResolvedValue({ success: true });
const routerRefreshMock = vi.fn();

vi.mock("@/lib/actions/addBank", () => ({
  addBank: vi.fn(),
}));

vi.mock("@/lib/actions/submitRouteReport", () => ({
  submitRouteReport: (...args: unknown[]) => submitRouteReportMock(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefreshMock, push: vi.fn() }),
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

const FIXED_BANK = { id: "bank-fixed", slug: "fixed-bank", name: "Fixed Bank" };
const OTHER_BANK = { id: "bank-other", slug: "other-bank", name: "Other Bank" };

function mockBankSearch(banks: Array<{ id: string; slug: string; name: string }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ banks }), { status: 200 }))
  );
}

// Each field's <label> is now connected to its trigger via aria-labelledby
// (see BankSelect/SubmitRouteReport), so triggers are queryable by their
// field label as an accessible name, same as any other form control.
async function pickBank(user: ReturnType<typeof userEvent.setup>, fieldLabel: string, bankName: string) {
  await user.click(screen.getByRole("combobox", { name: fieldLabel }));
  await user.click(await screen.findByRole("option", { name: bankName }));
}

async function pickOption(user: ReturnType<typeof userEvent.setup>, fieldLabel: string, optionName: RegExp) {
  await user.click(screen.getByRole("combobox", { name: fieldLabel }));
  await user.click(await screen.findByRole("option", { name: optionName }));
}

async function fillCommonFields(user: ReturnType<typeof userEvent.setup>) {
  await pickOption(user, "Rail used", /ACH/i);
  await pickOption(user, "Direction", /Push/i);
  await pickOption(user, "Status", /Success/i);
}

beforeEach(() => {
  submitRouteReportMock.mockClear();
  submitRouteReportMock.mockResolvedValue({ success: true });
  routerRefreshMock.mockClear();
});

describe("SubmitRouteReport — role toggle (bank-scoped page)", () => {
  it("defaults to the fixed bank as sender, and moves it to receiver on toggle, with aria-pressed reflecting the active side", async () => {
    const user = userEvent.setup();
    mockBankSearch([OTHER_BANK]);
    render(<SubmitRouteReport bankId={FIXED_BANK.id} bankName={FIXED_BANK.name} />);

    await waitFor(() => screen.getByText(`Add a real transfer outcome involving ${FIXED_BANK.name}.`));

    // Sender by default: fixed bank shown as static text under "From bank",
    // the "To bank" slot is a live BankSelect.
    expect(screen.getByText("From bank")).toBeInTheDocument();
    expect(screen.getAllByText(FIXED_BANK.name).length).toBeGreaterThan(0);
    expect(screen.getByRole("combobox", { name: "To bank" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sender" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Receiver" })).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "Receiver" }));

    // After toggling, the fixed bank moves to "To bank" and "From bank"
    // becomes the live BankSelect instead.
    expect(screen.getByRole("combobox", { name: "From bank" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "To bank" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sender" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Receiver" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("SubmitRouteReport — submit behavior (bank-scoped page)", () => {
  it("submits, then keeps the fixed bank pinned and only resets the free side", async () => {
    const user = userEvent.setup();
    mockBankSearch([OTHER_BANK]);
    render(<SubmitRouteReport bankId={FIXED_BANK.id} bankName={FIXED_BANK.name} />);
    await waitFor(() => screen.getByText(`Add a real transfer outcome involving ${FIXED_BANK.name}.`));

    await pickBank(user, "To bank", OTHER_BANK.name);
    await fillCommonFields(user);

    await user.click(screen.getByRole("button", { name: "Submit Report" }));

    await waitFor(() => expect(submitRouteReportMock).toHaveBeenCalledTimes(1));
    expect(submitRouteReportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fromBankId: FIXED_BANK.id,
        toBankId: OTHER_BANK.id,
      })
    );

    await waitFor(() => screen.getByText("Report submitted — thank you!"));

    // Fixed side ("From bank") still shows the pinned bank as static text.
    expect(screen.getAllByText(FIXED_BANK.name).length).toBeGreaterThan(0);
    // Free side reset back to an empty BankSelect.
    expect(screen.getByRole("combobox", { name: "To bank" })).toBeInTheDocument();
    // The submission may have fulfilled an active route_requests row and/or
    // changed the needs-fresh-reports list (already invalidated server-side
    // by submitRouteReport) — refresh so this page reflects it immediately.
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
  });
});

describe("SubmitRouteReport — same bank on both sides (general page)", () => {
  it("rejects submission when the same bank is picked as sender and receiver", async () => {
    const user = userEvent.setup();
    mockBankSearch([OTHER_BANK]);
    render(<SubmitRouteReport />);
    await waitFor(() => screen.getByText("Add real transfer outcomes to improve routing intelligence."));

    await pickBank(user, "From bank", OTHER_BANK.name);
    await pickBank(user, "To bank", OTHER_BANK.name);
    await fillCommonFields(user);

    await user.click(screen.getByRole("button", { name: "Submit Report" }));

    await waitFor(() => screen.getByText("Sender and receiver banks must be different"));
    expect(submitRouteReportMock).not.toHaveBeenCalled();
  });
});

describe("SubmitRouteReport — coordinated/prefilled mode (homepage route checker)", () => {
  const PREFILLED_FROM = { id: "bank-from", slug: "from-bank", name: "From Bank" };
  const PREFILLED_TO = { id: "bank-to", slug: "to-bank", name: "To Bank" };

  it("keeps both sides as live, editable BankSelects showing the prefilled values", async () => {
    render(<SubmitRouteReport initialFromBank={PREFILLED_FROM} initialToBank={PREFILLED_TO} />);
    await waitFor(() => screen.getByText("Add real transfer outcomes to improve routing intelligence."));

    expect(screen.getByRole("combobox", { name: "From bank" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "To bank" })).toBeInTheDocument();
    expect(screen.getByText(PREFILLED_FROM.name)).toBeInTheDocument();
    expect(screen.getByText(PREFILLED_TO.name)).toBeInTheDocument();
    // Not the fixed-bank UI — no sender/receiver toggle should appear.
    expect(screen.queryByRole("button", { name: "Sender" })).not.toBeInTheDocument();
  });

  it("preserves both selections after a successful submit and calls onSuccess", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn().mockResolvedValue(undefined);
    render(<SubmitRouteReport initialFromBank={PREFILLED_FROM} initialToBank={PREFILLED_TO} onSuccess={onSuccess} />);
    await waitFor(() => screen.getByText("Add real transfer outcomes to improve routing intelligence."));

    await fillCommonFields(user);
    await user.click(screen.getByRole("button", { name: "Submit Report" }));

    await waitFor(() => expect(submitRouteReportMock).toHaveBeenCalledTimes(1));
    expect(submitRouteReportMock).toHaveBeenCalledWith(
      expect.objectContaining({ fromBankId: PREFILLED_FROM.id, toBankId: PREFILLED_TO.id })
    );
    await waitFor(() => screen.getByText("Report submitted — thank you!"));

    // Both sides still show the same banks — neither was cleared/remounted.
    expect(screen.getByText(PREFILLED_FROM.name)).toBeInTheDocument();
    expect(screen.getByText(PREFILLED_TO.name)).toBeInTheDocument();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith({ fromBank: PREFILLED_FROM, toBank: PREFILLED_TO });
  });

  it("reports the edited banks to onSuccess, not the original prefilled ones", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn().mockResolvedValue(undefined);
    mockBankSearch([OTHER_BANK]);
    render(<SubmitRouteReport initialFromBank={PREFILLED_FROM} initialToBank={PREFILLED_TO} onSuccess={onSuccess} />);
    await waitFor(() => screen.getByText("Add real transfer outcomes to improve routing intelligence."));

    // Edit the prefilled "To bank" to a different bank before submitting.
    await pickBank(user, "To bank", OTHER_BANK.name);
    await fillCommonFields(user);
    await user.click(screen.getByRole("button", { name: "Submit Report" }));

    await waitFor(() => expect(submitRouteReportMock).toHaveBeenCalledTimes(1));
    expect(submitRouteReportMock).toHaveBeenCalledWith(
      expect.objectContaining({ fromBankId: PREFILLED_FROM.id, toBankId: OTHER_BANK.id })
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onSuccess).toHaveBeenCalledWith({ fromBank: PREFILLED_FROM, toBank: OTHER_BANK });
  });

  it("does not report a submit failure when onSuccess itself throws", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn().mockRejectedValue(new Error("refetch boom"));
    render(<SubmitRouteReport initialFromBank={PREFILLED_FROM} initialToBank={PREFILLED_TO} onSuccess={onSuccess} />);
    await waitFor(() => screen.getByText("Add real transfer outcomes to improve routing intelligence."));

    await fillCommonFields(user);
    await user.click(screen.getByRole("button", { name: "Submit Report" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    // The insert genuinely succeeded — that must stay reported as success,
    // regardless of the parent's own follow-up failing.
    expect(screen.getByText("Report submitted — thank you!")).toBeInTheDocument();
    expect(screen.queryByText(/Submit failed/)).not.toBeInTheDocument();
    expect(screen.queryByText("refetch boom")).not.toBeInTheDocument();
  });
});
