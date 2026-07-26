// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthModal, oauthRedirectTo } from "./AuthModal";

const signInWithOAuthMock = vi.fn().mockResolvedValue({ error: null });
const signInWithOtpMock = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signInWithOAuth: signInWithOAuthMock,
      signInWithPasskey: vi.fn().mockResolvedValue({ error: null }),
      signInWithOtp: signInWithOtpMock,
      verifyOtp: vi.fn().mockResolvedValue({ error: null }),
    },
  }),
}));

describe("oauthRedirectTo", () => {
  it("carries the current path, query, and hash through as ?next=, so #search survives the OAuth round trip", () => {
    const url = oauthRedirectTo({
      origin: "https://www.instantrailcheck.com",
      pathname: "/",
      search: "?from=chase&to=becu",
      hash: "#search",
    });
    expect(url).toBe(
      "https://www.instantrailcheck.com/auth/callback?next=" +
        encodeURIComponent("/?from=chase&to=becu#search")
    );
  });

  it("carries a plain page path with no query or hash", () => {
    const url = oauthRedirectTo({
      origin: "https://www.instantrailcheck.com",
      pathname: "/contribute",
      search: "",
      hash: "",
    });
    expect(url).toBe(
      "https://www.instantrailcheck.com/auth/callback?next=" + encodeURIComponent("/contribute")
    );
  });
});

describe("AuthModal accessibility", () => {
  it("associates a visible label with the email input", () => {
    render(<AuthModal open onOpenChange={vi.fn()} />);
    expect(screen.getByLabelText("Email address")).toHaveAttribute("type", "email");
  });

  it("associates a visible label with the 8-digit OTP input once past the email step", async () => {
    const user = userEvent.setup();
    render(<AuthModal open onOpenChange={vi.fn()} />);

    await user.type(screen.getByLabelText("Email address"), "person@example.com");
    await user.click(screen.getByRole("button", { name: /Send sign-in link/i }));

    expect(await screen.findByLabelText("8-digit code")).toHaveAttribute("inputMode", "numeric");
  });

  it("announces a failed send as an alert", async () => {
    signInWithOtpMock.mockResolvedValueOnce({ error: { message: "Too many requests" } });
    const user = userEvent.setup();
    render(<AuthModal open onOpenChange={vi.fn()} />);

    await user.type(screen.getByLabelText("Email address"), "person@example.com");
    await user.click(screen.getByRole("button", { name: /Send sign-in link/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests");
  });
});

describe("AuthModal Google sign-in", () => {
  it("passes the current page's path+hash as redirectTo's ?next=, so the callback route can return the user to it", async () => {
    window.history.pushState({}, "", "/contribute#search");
    const user = userEvent.setup();

    render(<AuthModal open onOpenChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Continue with Google/i }));

    expect(signInWithOAuthMock).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo:
          `${window.location.origin}/auth/callback?next=` + encodeURIComponent("/contribute#search"),
      },
    });
  });
});
