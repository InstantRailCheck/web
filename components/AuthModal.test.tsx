// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthModal, oauthRedirectTo } from "./AuthModal";

const signInWithOAuthMock = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signInWithOAuth: signInWithOAuthMock,
      signInWithPasskey: vi.fn().mockResolvedValue({ error: null }),
      signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
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
