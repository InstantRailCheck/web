// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ComparePicker } from "./ComparePicker";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/actions/addBank", () => ({
  addBank: vi.fn(),
}));

const BANK_A = { id: "bank-a", slug: "bank-a", name: "Bank A" };
const BANK_B = { id: "bank-b", slug: "bank-b", name: "Bank B" };

describe("ComparePicker — resync across URL navigation", () => {
  // BankSelect is uncontrolled (initialBank only seeds first mount), so the
  // parent (app/compare/page.tsx) must key ComparePicker on the resolved
  // slugs to force a remount when ?banks= changes via router.push — this
  // simulates that by re-rendering with a new key, exactly like React would
  // treat it as a fresh mount.
  it("shows the newly resolved banks after a key change simulating URL navigation", () => {
    const { rerender } = render(
      <ComparePicker key="bank-a-bank-b" initialBankA={BANK_A} initialBankB={BANK_B} />
    );
    expect(screen.getByText("Bank A")).toBeInTheDocument();
    expect(screen.getByText("Bank B")).toBeInTheDocument();

    const BANK_C = { id: "bank-c", slug: "bank-c", name: "Bank C" };
    rerender(<ComparePicker key="bank-a-bank-c" initialBankA={BANK_A} initialBankB={BANK_C} />);

    expect(screen.getByText("Bank A")).toBeInTheDocument();
    expect(screen.getByText("Bank C")).toBeInTheDocument();
    expect(screen.queryByText("Bank B")).not.toBeInTheDocument();
  });

  it("without a key change, stale BankSelect state would persist (documents why the key is required)", () => {
    const { rerender } = render(<ComparePicker initialBankA={BANK_A} initialBankB={BANK_B} />);
    expect(screen.getByText("Bank A")).toBeInTheDocument();

    const BANK_C = { id: "bank-c", slug: "bank-c", name: "Bank C" };
    rerender(<ComparePicker initialBankA={BANK_A} initialBankB={BANK_C} />);

    // Same component instance (no key change) — BankSelect's uncontrolled
    // state doesn't resync, so the old value is still shown. This is the
    // exact bug the key prop in app/compare/page.tsx exists to prevent.
    expect(screen.getByText("Bank B")).toBeInTheDocument();
    expect(screen.queryByText("Bank C")).not.toBeInTheDocument();
  });
});
