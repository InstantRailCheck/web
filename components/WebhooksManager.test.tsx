// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WebhooksManager } from "./WebhooksManager";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: "user-1", email: "person@example.com" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  }),
}));

const listWebhooksMock = vi.fn();
const registerWebhookMock = vi.fn();
vi.mock("@/lib/actions/webhooks", () => ({
  listWebhooks: (...args: unknown[]) => listWebhooksMock(...args),
  registerWebhook: (...args: unknown[]) => registerWebhookMock(...args),
  deleteWebhook: vi.fn(),
}));

beforeEach(() => {
  listWebhooksMock.mockReset();
  listWebhooksMock.mockResolvedValue([]);
  registerWebhookMock.mockReset();
});

describe("WebhooksManager accessibility", () => {
  it("associates a visible label with the webhook URL input", async () => {
    render(<WebhooksManager />);
    expect(await screen.findByLabelText("Webhook URL")).toHaveAttribute(
      "placeholder",
      "https://your-server.com/webhook"
    );
  });

  it("announces a registration failure as an alert", async () => {
    registerWebhookMock.mockResolvedValue({ error: "You already have 5 webhooks registered." });
    const user = userEvent.setup();
    render(<WebhooksManager />);

    await user.type(await screen.findByLabelText("Webhook URL"), "https://example.com/hook");
    await user.click(screen.getByRole("button", { name: /Add webhook/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You already have 5 webhooks registered.");
  });

  it("announces a successful registration as a status region carrying the one-time secret", async () => {
    registerWebhookMock.mockResolvedValue({ id: "wh-1", secret: "whsec_abc123" });
    const user = userEvent.setup();
    render(<WebhooksManager />);

    await user.type(await screen.findByLabelText("Webhook URL"), "https://example.com/hook");
    await user.click(screen.getByRole("button", { name: /Add webhook/i }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("whsec_abc123"));
  });
});
