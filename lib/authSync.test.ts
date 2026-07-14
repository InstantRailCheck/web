import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

const { computeBanDuration, sanitizeProviderError, reconcileAuthSync } = await import("./authSync");

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("computeBanDuration", () => {
  it("returns the long stand-in duration for permanently_banned", () => {
    expect(computeBanDuration("permanently_banned", null)).toBe("876000h");
  });

  it("returns 'none' for active", () => {
    expect(computeBanDuration("active", null)).toBe("none");
  });

  it("returns 'none' for restricted (never touches sign-in)", () => {
    expect(computeBanDuration("restricted", null)).toBe("none");
  });

  it("returns the remaining whole hours (rounded up) for an unexpired temporary ban", () => {
    const banExpiresAt = new Date(Date.now() + 90 * 60_000).toISOString(); // 1.5 hours out
    expect(computeBanDuration("temporarily_banned", banExpiresAt)).toBe("2h");
  });

  it("reconciles an already-expired temporary ban to 'none' rather than a negative/zero duration", () => {
    const banExpiresAt = new Date(Date.now() - 60_000).toISOString();
    expect(computeBanDuration("temporarily_banned", banExpiresAt)).toBe("none");
  });
});

describe("sanitizeProviderError", () => {
  it("redacts an email address", () => {
    expect(sanitizeProviderError("failed for user@example.com")).not.toContain("user@example.com");
  });

  it("redacts a credential-bearing URL", () => {
    const result = sanitizeProviderError("request to https://admin:hunter2@api.example.com/v1 failed");
    expect(result).not.toContain("hunter2");
  });

  it("redacts a long token-like string", () => {
    const result = sanitizeProviderError("bad token opaque-provider-token-abcdefghijklmnopqrstuvwxyz123456");
    expect(result).not.toContain("opaque-provider-token-abcdefghijklmnopqrstuvwxyz123456");
  });

  it("strips control characters", () => {
    expect(sanitizeProviderError("line1\x00line2")).not.toContain("\x00");
  });

  it("caps length at 300 characters", () => {
    expect(sanitizeProviderError("x".repeat(1000)).length).toBeLessThanOrEqual(300);
  });
});

describe("reconcileAuthSync", () => {
  type MockRow = {
    status: string;
    ban_expires_at: string | null;
    transition_id: string;
    auth_sync_status?: string;
    auth_sync_error?: string | null;
  };

  function createMockAdmin(initialRow: MockRow | null, updateUserById: ReturnType<typeof vi.fn>) {
    let row = initialRow;
    const admin = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: row ? { ...row } : null }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: () => ({
            eq: (_col: string, val: string) => {
              if (row && row.transition_id === val) row = { ...row, ...(patch as Partial<MockRow>) };
              return Promise.resolve({ data: null, error: null });
            },
          }),
        }),
      }),
      auth: { admin: { updateUserById } },
    };
    return { admin, getRow: () => row };
  }

  it("returns synced immediately when the user has never been moderated (no row)", async () => {
    const updateUserById = vi.fn();
    const { admin } = createMockAdmin(null, updateUserById);
    const result = await reconcileAuthSync(admin as never, "user-1");
    expect(result).toEqual({ synced: true });
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("applies the desired duration and marks the row synced on success", async () => {
    const updateUserById = vi.fn(() => Promise.resolve({ error: null }));
    const { admin, getRow } = createMockAdmin(
      { status: "permanently_banned", ban_expires_at: null, transition_id: "t1" },
      updateUserById
    );

    const result = await reconcileAuthSync(admin as never, "user-1");

    expect(result).toEqual({ synced: true });
    expect(updateUserById).toHaveBeenCalledWith("user-1", { ban_duration: "876000h" });
    expect(getRow()?.auth_sync_status).toBe("synced");
  });

  it("records a sanitized, truncated error and reports the warning on Auth failure", async () => {
    const updateUserById = vi.fn(() => Promise.resolve({ error: { message: "boom user@example.com" } }));
    const { admin, getRow } = createMockAdmin(
      { status: "restricted", ban_expires_at: null, transition_id: "t1" },
      updateUserById
    );

    const result = await reconcileAuthSync(admin as never, "user-1");

    expect(result.synced).toBe(false);
    expect(getRow()?.auth_sync_status).toBe("pending");
    expect(getRow()?.auth_sync_error).not.toContain("user@example.com");
    expect(logErrorMock).toHaveBeenCalled();
  });

  // The exact scenario from lib/authSync.ts's own comment: an older
  // transition's Auth call is still in flight when a newer transition
  // lands and completes first. The SAME original invocation (not a
  // separate later call) must detect the mismatch and re-apply the
  // newer desired state itself before returning.
  it("self-heals within the same invocation when a newer transition supersedes a still-in-flight call", async () => {
    let row: MockRow = { status: "permanently_banned", ban_expires_at: null, transition_id: "transition-A" };
    const calls: string[] = [];
    const firstCall = createDeferred<{ error: null }>();

    const updateUserById = vi.fn((_userId: string, { ban_duration }: { ban_duration: string }) => {
      calls.push(ban_duration);
      if (calls.length === 1) return firstCall.promise;
      return Promise.resolve({ error: null });
    });

    const admin = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: { ...row } }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: () => ({
            eq: (_col: string, val: string) => {
              if (row.transition_id === val) row = { ...row, ...(patch as Partial<MockRow>) };
              return Promise.resolve({ data: null, error: null });
            },
          }),
        }),
      }),
      auth: { admin: { updateUserById } },
    };

    const reconcilePromise = reconcileAuthSync(admin as never, "user-1");

    // Wait for the first (in-flight) Auth call to actually start before
    // simulating a newer transition landing.
    await vi.waitFor(() => expect(updateUserById).toHaveBeenCalledTimes(1));

    // Transition B supersedes A: reactivated, and (as B's own independent
    // reconcile would have already done) marked synced with "none".
    row = { status: "active", ban_expires_at: null, transition_id: "transition-B" };

    // Now let A's slow call finally resolve.
    firstCall.resolve({ error: null });

    const result = await reconcilePromise;

    expect(result).toEqual({ synced: true });
    // The same invocation issued a SECOND call reapplying B's desired
    // state, not just discarding A's stale write.
    expect(calls).toEqual(["876000h", "none"]);
    expect(row.transition_id).toBe("transition-B");
    expect(row.auth_sync_status).toBe("synced");
  });
});
