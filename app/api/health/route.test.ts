import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

type TableResult = { data: unknown; error: { message: string } | null };
let tableResults: Record<string, TableResult> = {};

function fakeQueryBuilder(table: string) {
  const result = tableResults[table] ?? { data: null, error: null };
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.eq = chain;
  builder.order = chain;
  builder.limit = chain;
  builder.maybeSingle = () => Promise.resolve(result);
  // The `banks` connectivity probe uses head:true and never calls
  // maybeSingle() — its promise resolves directly off .select().
  builder.then = (resolve: (v: TableResult) => void) => resolve(result);
  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => fakeQueryBuilder(table),
  }),
}));

const { GET } = await import("./route");

const FRESH = new Date().toISOString();
const STALE_WEEKLY = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
const STALE_MONTHLY = new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString();

function allFresh() {
  tableResults = {
    banks: { data: null, error: null },
    sync_runs: { data: { started_at: FRESH, status: "staged" }, error: null },
    fednow_participants: { data: { updated_at: FRESH }, error: null },
    rtp_participants: { data: { updated_at: FRESH }, error: null },
    zelle_participants: { data: { updated_at: FRESH }, error: null },
    ncua_reference_sync_log: { data: { synced_at: FRESH }, error: null },
  };
}

beforeEach(() => {
  logErrorMock.mockClear();
  allFresh();
});

describe("GET /api/health", () => {
  it("returns 200 status ok when the database is reachable and every sync is within its cadence", async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.database.ok).toBe(true);
  });

  it("returns 503 status degraded when the database probe errors", async () => {
    tableResults.banks = { data: null, error: { message: "connection refused" } };

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.checks.database.ok).toBe(false);
    expect(body.checks.database.detail).toContain("connection refused");
  });

  it("logs when the database probe errors", async () => {
    tableResults.banks = { data: null, error: { message: "connection refused" } };
    await GET();
    expect(logErrorMock).toHaveBeenCalledWith(
      "health check: database probe failed",
      expect.objectContaining({ error: "connection refused" })
    );
  });

  it("flags the institution directory sync as stale past the weekly cadence buffer", async () => {
    tableResults.sync_runs = { data: { started_at: STALE_WEEKLY, status: "staged" }, error: null };

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.checks.institutionDirectorySync.ok).toBe(false);
  });

  it("treats a fresh but still-unapplied 'staged' run as healthy, since --apply is a manual step with no fixed cadence", async () => {
    tableResults.sync_runs = { data: { started_at: FRESH, status: "staged" }, error: null };

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.checks.institutionDirectorySync.ok).toBe(true);
  });

  it("flags a fresh run as unhealthy when its status is guard_blocked", async () => {
    tableResults.sync_runs = { data: { started_at: FRESH, status: "guard_blocked" }, error: null };

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.checks.institutionDirectorySync.ok).toBe(false);
    expect(body.checks.institutionDirectorySync.detail).toContain("requires attention");
  });

  it("flags a fresh run as unhealthy when its status is failed", async () => {
    tableResults.sync_runs = { data: { started_at: FRESH, status: "failed" }, error: null };

    const res = await GET();
    const body = await res.json();

    expect(body.checks.institutionDirectorySync.ok).toBe(false);
  });

  it("flags a rail participant sync as stale past the weekly cadence buffer", async () => {
    tableResults.zelle_participants = { data: { updated_at: STALE_WEEKLY }, error: null };

    const res = await GET();
    const body = await res.json();

    expect(body.checks.zelleSync.ok).toBe(false);
    expect(body.checks.fednowSync.ok).toBe(true);
  });

  it("allows the NCUA sync to be older than the weekly threshold without going stale, since it's monthly", async () => {
    tableResults.ncua_reference_sync_log = { data: { synced_at: STALE_WEEKLY }, error: null };

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.checks.ncuaDirectorySync.ok).toBe(true);
  });

  it("flags the NCUA sync as stale past the monthly cadence buffer", async () => {
    tableResults.ncua_reference_sync_log = { data: { synced_at: STALE_MONTHLY }, error: null };

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.checks.ncuaDirectorySync.ok).toBe(false);
  });

  it("reports a missing sync record as not ok rather than defaulting to healthy", async () => {
    tableResults.sync_runs = { data: null, error: null };

    const res = await GET();
    const body = await res.json();

    expect(body.checks.institutionDirectorySync.ok).toBe(false);
    expect(body.checks.institutionDirectorySync.lastSyncedAt).toBeNull();
  });

  it("sets no-store cache headers so a monitor never sees a cached result", async () => {
    const res = await GET();
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
