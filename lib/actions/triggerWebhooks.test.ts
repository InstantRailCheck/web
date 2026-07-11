import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const insertMock = vi.fn(() => Promise.resolve({ data: null, error: null }));
const fromMock = vi.fn(() => ({ select: selectMock, insert: insertMock }));
let selectResult: { data: unknown[] | null } = { data: [] };
const selectMock = vi.fn(() => ({
  eq: () => ({
    eq: () => Promise.resolve(selectResult),
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const isUrlSafeForWebhookMock = vi.fn();
vi.mock("@/lib/webhookSafety", () => ({
  isUrlSafeForWebhook: (...args: unknown[]) => isUrlSafeForWebhookMock(...args),
}));

const undiciFetchMock = vi.fn();
class FakeAgent {
  opts: unknown;
  constructor(opts: unknown) {
    this.opts = opts;
  }
}
vi.mock("undici", () => ({
  fetch: (...args: unknown[]) => undiciFetchMock(...args),
  Agent: FakeAgent,
}));

const { triggerWebhooks } = await import("./triggerWebhooks");

beforeEach(() => {
  insertMock.mockClear();
  fromMock.mockClear();
  selectMock.mockClear();
  isUrlSafeForWebhookMock.mockReset();
  undiciFetchMock.mockReset();
  selectResult = { data: [{ id: "wh1", url: "https://example.com/hook", secret: "s3cr3t" }] };
});

describe("triggerWebhooks — delivery safety", () => {
  it("blocks delivery and logs the reason without calling fetch when the URL fails delivery-time validation", async () => {
    isUrlSafeForWebhookMock.mockResolvedValue({ safe: false, reason: "Resolves to a private/reserved IP address (10.0.0.1)" });

    await triggerWebhooks("bank_added", { bankId: "b1" });

    expect(undiciFetchMock).not.toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        webhook_id: "wh1",
        success: false,
        error: expect.stringContaining("Blocked at delivery time"),
      })
    );
  });

  it("pins the connection to the validated address by passing a dispatcher built from it", async () => {
    isUrlSafeForWebhookMock.mockResolvedValue({ safe: true, address: "93.184.216.34" });
    undiciFetchMock.mockResolvedValue({ status: 200 });

    await triggerWebhooks("bank_added", { bankId: "b1" });

    expect(undiciFetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = undiciFetchMock.mock.calls[0];
    expect(url).toBe("https://example.com/hook");
    expect(options.dispatcher).toBeTruthy();
    expect(options.redirect).toBe("manual");
  });

  it("records a successful delivery from a 2xx response", async () => {
    isUrlSafeForWebhookMock.mockResolvedValue({ safe: true, address: "93.184.216.34" });
    undiciFetchMock.mockResolvedValue({ status: 204 });

    await triggerWebhooks("bank_added", { bankId: "b1" });

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ webhook_id: "wh1", success: true, response_status: 204 })
    );
  });

  it("records a failed delivery from a non-2xx response", async () => {
    isUrlSafeForWebhookMock.mockResolvedValue({ safe: true, address: "93.184.216.34" });
    undiciFetchMock.mockResolvedValue({ status: 500 });

    await triggerWebhooks("bank_added", { bankId: "b1" });

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ webhook_id: "wh1", success: false, response_status: 500 })
    );
  });

  it("records a failed delivery when fetch throws (e.g. timeout)", async () => {
    isUrlSafeForWebhookMock.mockResolvedValue({ safe: true, address: "93.184.216.34" });
    undiciFetchMock.mockRejectedValue(new Error("The operation was aborted"));

    await triggerWebhooks("bank_added", { bankId: "b1" });

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ webhook_id: "wh1", success: false, error: "The operation was aborted" })
    );
  });

  it("does nothing when there are no active webhooks for the event", async () => {
    selectResult = { data: [] };

    await triggerWebhooks("bank_added", { bankId: "b1" });

    expect(isUrlSafeForWebhookMock).not.toHaveBeenCalled();
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });
});
