import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

type TableResult = { data: unknown; error: { message: string } | null };
let tableResults: Record<string, TableResult> = {};

// sync_runs is queried twice (source_scope='fdic' and 'both'), so the fake
// builder keys on table+scope once .eq("source_scope", ...) is called,
// rather than on table name alone.
function fakeQueryBuilder(table: string) {
  let key = table;
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = (column: string, value: string) => {
    if (table === "sync_runs" && column === "source_scope") key = `sync_runs:${value}`;
    return builder;
  };
  builder.order = () => builder;
  builder.limit = () => builder;
  const resolved = () => tableResults[key] ?? { data: null, error: null };
  builder.maybeSingle = () => Promise.resolve(resolved());
  // The `banks` connectivity probe uses head:true and never calls
  // maybeSingle() — its promise resolves directly off .select().
  builder.then = (resolve: (v: TableResult) => void) => resolve(resolved());
  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => fakeQueryBuilder(table),
  }),
}));

const { GET } = await import("./route");

const TOKEN = "test-token-123";
const FRESH = new Date().toISOString();
const STALE_WEEKLY = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
const STALE_MONTHLY = new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString();

function makeRequest(headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }) {
  return new NextRequest("https://api.instantrailcheck.com/health", { headers });
}

function allFresh() {
  tableResults = {
    banks: { data: null, error: null },
    "sync_runs:fdic": { data: { started_at: FRESH, status: "staged" }, error: null },
    "sync_runs:both": { data: { started_at: FRESH, status: "applied" }, error: null },
    fednow_participants: { data: { updated_at: FRESH }, error: null },
    rtp_participants: { data: { updated_at: FRESH }, error: null },
    zelle_participants: { data: { updated_at: FRESH }, error: null },
    ncua_reference_sync_log: { data: { synced_at: FRESH }, error: null },
  };
}

beforeEach(() => {
  logErrorMock.mockClear();
  allFresh();
  vi.stubEnv("HEALTH_CHECK_TOKEN", TOKEN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/health authorization", () => {
  it("returns 401 with no Authorization header", async () => {
    const res = await GET(makeRequest({}));
    expect(res.status).toBe(401);
  });

  it("returns 401 when the bearer token doesn't match", async () => {
    const res = await GET(makeRequest({ authorization: "Bearer wrong-token" }));
    expect(res.status).toBe(401);
  });

  it("fails closed (401) when HEALTH_CHECK_TOKEN isn't configured at all", async () => {
    vi.stubEnv("HEALTH_CHECK_TOKEN", "");
    const res = await GET(makeRequest({ authorization: `Bearer ${TOKEN}` }));
    expect(res.status).toBe(401);
  });

  it("never queries the database for an unauthorized request", async () => {
    await GET(makeRequest({}));
    expect(logErrorMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/health", () => {
  it("returns 200 status ok when the database is reachable and every sync is within its cadence", async () => {
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.database.ok).toBe(true);
  });

  it("returns 503 status degraded when the database probe errors", async () => {
    tableResults.banks = { data: null, error: { message: "connection refused" } };

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.checks.database.ok).toBe(false);
  });

  it("keeps the raw database error message out of the public response", async () => {
    tableResults.banks = { data: null, error: { message: "connection refused" } };

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(JSON.stringify(body)).not.toContain("connection refused");
  });

  it("logs the raw database error message server-side", async () => {
    tableResults.banks = { data: null, error: { message: "connection refused" } };
    await GET(makeRequest());
    expect(logErrorMock).toHaveBeenCalledWith(
      "health check: database probe failed",
      expect.objectContaining({ error: "connection refused" })
    );
  });

  it("flags the FDIC directory sync as stale past the weekly cadence buffer", async () => {
    tableResults["sync_runs:fdic"] = { data: { started_at: STALE_WEEKLY, status: "staged" }, error: null };

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.checks.fdicDirectorySync.ok).toBe(false);
  });

  it("treats a fresh but still-unapplied 'staged' run as healthy, since --apply is a manual step with no fixed cadence", async () => {
    tableResults["sync_runs:fdic"] = { data: { started_at: FRESH, status: "staged" }, error: null };

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.checks.fdicDirectorySync.ok).toBe(true);
  });

  it("flags a fresh run as unhealthy when its status is guard_blocked", async () => {
    tableResults["sync_runs:fdic"] = { data: { started_at: FRESH, status: "guard_blocked" }, error: null };

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.checks.fdicDirectorySync.ok).toBe(false);
    expect(body.checks.fdicDirectorySync.detail).toContain("requires attention");
  });

  it("flags a fresh run as unhealthy when its status is failed", async () => {
    tableResults["sync_runs:fdic"] = { data: { started_at: FRESH, status: "failed" }, error: null };

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.checks.fdicDirectorySync.ok).toBe(false);
  });

  it("flags a run stuck in 'running' or 'applying' as unhealthy rather than defaulting to ok", async () => {
    tableResults["sync_runs:fdic"] = { data: { started_at: FRESH, status: "running" }, error: null };
    const res1 = await GET(makeRequest());
    expect((await res1.json()).checks.fdicDirectorySync.ok).toBe(false);

    tableResults["sync_runs:fdic"] = { data: { started_at: FRESH, status: "applying" }, error: null };
    const res2 = await GET(makeRequest());
    expect((await res2.json()).checks.fdicDirectorySync.ok).toBe(false);
  });

  it("reports a missing FDIC sync run as not ok rather than defaulting to healthy", async () => {
    tableResults["sync_runs:fdic"] = { data: null, error: null };

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.checks.fdicDirectorySync.ok).toBe(false);
    expect(body.checks.fdicDirectorySync.lastSyncedAt).toBeNull();
  });

  it("checks the monthly 'both'-scope directory run independently, so a fresh weekly FDIC run can't mask a stale/broken monthly run", async () => {
    tableResults["sync_runs:both"] = { data: { started_at: STALE_MONTHLY, status: "guard_blocked" }, error: null };
    // fdic stays fresh/healthy from allFresh()

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.checks.fdicDirectorySync.ok).toBe(true);
    expect(body.checks.fullDirectorySync.ok).toBe(false);
  });

  it("allows the monthly 'both'-scope run to be older than the weekly threshold without going stale", async () => {
    tableResults["sync_runs:both"] = { data: { started_at: STALE_WEEKLY, status: "applied" }, error: null };

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.checks.fullDirectorySync.ok).toBe(true);
  });

  it("flags a rail participant sync as stale past the weekly cadence buffer", async () => {
    tableResults.zelle_participants = { data: { updated_at: STALE_WEEKLY }, error: null };

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.checks.zelleSync.ok).toBe(false);
    expect(body.checks.fednowSync.ok).toBe(true);
  });

  it("allows the NCUA reference log to be older than the weekly threshold without going stale, since it's monthly", async () => {
    tableResults.ncua_reference_sync_log = { data: { synced_at: STALE_WEEKLY }, error: null };

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.checks.ncuaDirectorySync.ok).toBe(true);
  });

  it("flags the NCUA reference log as stale past the monthly cadence buffer", async () => {
    tableResults.ncua_reference_sync_log = { data: { synced_at: STALE_MONTHLY }, error: null };

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.checks.ncuaDirectorySync.ok).toBe(false);
  });

  it("sets no-store cache headers so a monitor never sees a cached result", async () => {
    const res = await GET(makeRequest());
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
