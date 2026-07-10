// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SubmitRouteReport } from "./SubmitRouteReport";

const insertMock = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/lib/actions/addBank", () => ({
  addBank: vi.fn(),
}));

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

const FIXED_BANK = { id: "bank-fixed", slug: "fixed-bank", name: "Fixed Bank" };
const OTHER_BANK = { id: "bank-other", slug: "other-bank", name: "Other Bank" };

function mockBankSearch(banks: Array<{ id: string; slug: string; name: string }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ banks }), { status: 200 }))
  );
}

// Radix's `role="combobox"` triggers don't take their accessible name from
// their own text content (per ARIA, combobox is "name from author" only),
// so `getByRole("combobox", { name })` can't find them — query by the
// visible placeholder/value text instead. Radix also marks the inner value
// span `pointer-events: none`, so climb to the actual <button> before
// clicking rather than clicking the text node itself.
async function openDropdown(user: ReturnType<typeof userEvent.setup>, visibleText: string) {
  const el = screen.getByText(visibleText);
  const trigger = el.closest("button") ?? el;
  await user.click(trigger);
}

async function pickBank(user: ReturnType<typeof userEvent.setup>, triggerText: string, bankName: string) {
  await openDropdown(user, triggerText);
  await user.click(await screen.findByRole("option", { name: bankName }));
}

async function pickOption(user: ReturnType<typeof userEvent.setup>, triggerText: string, optionName: RegExp) {
  await openDropdown(user, triggerText);
  await user.click(await screen.findByRole("option", { name: optionName }));
}

async function fillCommonFields(user: ReturnType<typeof userEvent.setup>) {
  await pickOption(user, "Select rail", /ACH/i);
  await pickOption(user, "Select direction", /Push/i);
  await pickOption(user, "Select status", /Success/i);
}

beforeEach(() => {
  insertMock.mockClear();
});

describe("SubmitRouteReport — role toggle (bank-scoped page)", () => {
  it("defaults to the fixed bank as sender, and moves it to receiver on toggle", async () => {
    const user = userEvent.setup();
    mockBankSearch([OTHER_BANK]);
    render(<SubmitRouteReport bankId={FIXED_BANK.id} bankName={FIXED_BANK.name} />);

    await waitFor(() => screen.getByText(`Add a real transfer outcome involving ${FIXED_BANK.name}.`));

    // Sender by default: fixed bank shown as static text under "From bank",
    // the "To bank" slot is a live BankSelect showing its placeholder.
    expect(screen.getByText("From bank")).toBeInTheDocument();
    expect(screen.getAllByText(FIXED_BANK.name).length).toBeGreaterThan(0);
    expect(screen.getByText("Receiver bank")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Receiver" }));

    // After toggling, the fixed bank moves to "To bank" and "From bank"
    // becomes the live BankSelect instead.
    expect(screen.getByText("Sender bank")).toBeInTheDocument();
    expect(screen.queryByText("Receiver bank")).not.toBeInTheDocument();
  });
});

describe("SubmitRouteReport — submit behavior (bank-scoped page)", () => {
  it("submits, then keeps the fixed bank pinned and only resets the free side", async () => {
    const user = userEvent.setup();
    mockBankSearch([OTHER_BANK]);
    render(<SubmitRouteReport bankId={FIXED_BANK.id} bankName={FIXED_BANK.name} />);
    await waitFor(() => screen.getByText(`Add a real transfer outcome involving ${FIXED_BANK.name}.`));

    await pickBank(user, "Receiver bank", OTHER_BANK.name);
    await fillCommonFields(user);

    await user.click(screen.getByRole("button", { name: "Submit Report" }));

    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1));
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from_bank_id: FIXED_BANK.id,
        to_bank_id: OTHER_BANK.id,
      })
    );

    await waitFor(() => screen.getByText("Report submitted — thank you!"));

    // Fixed side ("From bank") still shows the pinned bank as static text.
    expect(screen.getAllByText(FIXED_BANK.name).length).toBeGreaterThan(0);
    // Free side reset back to an empty BankSelect.
    expect(screen.getByText("Receiver bank")).toBeInTheDocument();
  });
});

describe("SubmitRouteReport — same bank on both sides (general page)", () => {
  it("rejects submission when the same bank is picked as sender and receiver", async () => {
    const user = userEvent.setup();
    mockBankSearch([OTHER_BANK]);
    render(<SubmitRouteReport />);
    await waitFor(() => screen.getByText("Add real transfer outcomes to improve routing intelligence."));

    await pickBank(user, "Sender bank", OTHER_BANK.name);
    await pickBank(user, "Receiver bank", OTHER_BANK.name);
    await fillCommonFields(user);

    await user.click(screen.getByRole("button", { name: "Submit Report" }));

    await waitFor(() => screen.getByText("Sender and receiver banks must be different"));
    expect(insertMock).not.toHaveBeenCalled();
  });
});
