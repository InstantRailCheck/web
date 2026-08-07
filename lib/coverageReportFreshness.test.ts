import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

type SyncRunFixture = { finished_at: string; status: string };
let syncRuns: { fdic: SyncRunFixture[]; both: SyncRunFixture[] } = { fdic: [], both: [] };
let syncRunsError = false;

type ParticipantTable = "fednow_participants" | "rtp_participants" | "zelle_participants";
let participantUpdatedAt: Record<ParticipantTable, string | null> = {
  fednow_participants: null,
  rtp_participants: null,
  zelle_participants: null,
};
let participantErrorTable: ParticipantTable | null = null;

type BankFixtureRow = {
  is_active: boolean;
  source_authority: "fdic" | "ncua" | null;
  state: string | null;
  total_assets: number | null;
  fednow_participant: boolean | null;
  rtp_participant: boolean | null;
  zelle_participant: boolean | null;
};
let bankRows: BankFixtureRow[] = [];
let banksError = false;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "sync_runs") {
        return {
          select: () => ({
            eq: (_col1: string, scope: "fdic" | "both") => ({
              eq: (_col2: string, status: string) => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: () => {
                      if (syncRunsError) return Promise.resolve({ data: null, error: { message: "sync_runs db error" } });
                      const matching = syncRuns[scope]
                        .filter((r) => r.status === status)
                        .sort((a, b) => b.finished_at.localeCompare(a.finished_at));
                      return Promise.resolve({ data: matching[0] ?? null, error: null });
                    },
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "fednow_participants" || table === "rtp_participants" || table === "zelle_participants") {
        return {
          select: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: () => {
                  if (participantErrorTable === table) {
                    return Promise.resolve({ data: null, error: { message: `${table} db error` } });
                  }
                  const value = participantUpdatedAt[table as ParticipantTable];
                  return Promise.resolve({ data: value ? { updated_at: value } : null, error: null });
                },
              }),
            }),
          }),
        };
      }
      if (table === "banks") {
        return {
          select: () => ({
            order: () => ({
              order: () => ({
                range: (offset: number, end: number) => {
                  if (banksError) return Promise.resolve({ data: null, error: { message: "banks db error" } });
                  return Promise.resolve({ data: bankRows.slice(offset, end + 1), error: null });
                },
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

const { fetchCoverageFreshnessLogged, fetchCoverageReportLogged } = await import("./coverageReportFreshness");

beforeEach(() => {
  syncRuns = { fdic: [], both: [] };
  syncRunsError = false;
  participantUpdatedAt = { fednow_participants: null, rtp_participants: null, zelle_participants: null };
  participantErrorTable = null;
  bankRows = [];
  banksError = false;
});

describe("fetchCoverageFreshnessLogged", () => {
  it("uses finished_at from the latest applied sync_runs row", async () => {
    syncRuns.fdic = [{ finished_at: "2026-07-20T00:00:00Z", status: "applied" }];
    const result = await fetchCoverageFreshnessLogged();
    expect(result.institutionDirectoryAsOf).toBe("2026-07-20T00:00:00Z");
  });

  it("ignores a fresher 'staged' row in favor of an older 'applied' row", async () => {
    syncRuns.fdic = [
      { finished_at: "2026-08-01T00:00:00Z", status: "staged" },
      { finished_at: "2026-07-18T00:00:00Z", status: "applied" },
    ];
    const result = await fetchCoverageFreshnessLogged();
    expect(result.institutionDirectoryAsOf).toBe("2026-07-18T00:00:00Z");
  });

  it("takes the later of the fdic-scope and both-scope applied runs for institutionDirectoryAsOf", async () => {
    syncRuns.fdic = [{ finished_at: "2026-08-01T00:00:00Z", status: "applied" }];
    syncRuns.both = [{ finished_at: "2026-07-18T00:00:00Z", status: "applied" }];
    expect((await fetchCoverageFreshnessLogged()).institutionDirectoryAsOf).toBe("2026-08-01T00:00:00Z");

    syncRuns.fdic = [{ finished_at: "2026-07-01T00:00:00Z", status: "applied" }];
    syncRuns.both = [{ finished_at: "2026-07-30T00:00:00Z", status: "applied" }];
    expect((await fetchCoverageFreshnessLogged()).institutionDirectoryAsOf).toBe("2026-07-30T00:00:00Z");
  });

  it("takes the max updated_at across all three rail-participant tables", async () => {
    participantUpdatedAt = {
      fednow_participants: "2026-07-10T00:00:00Z",
      rtp_participants: "2026-07-25T00:00:00Z",
      zelle_participants: "2026-07-15T00:00:00Z",
    };
    const result = await fetchCoverageFreshnessLogged();
    expect(result.railSourceListsDownloadedAt).toBe("2026-07-25T00:00:00Z");
  });

  it("returns null for both fields when no applied run or participant data exists yet", async () => {
    const result = await fetchCoverageFreshnessLogged();
    expect(result).toEqual({ institutionDirectoryAsOf: null, railSourceListsDownloadedAt: null });
  });

  it("logs and rethrows on a sync_runs failure instead of returning null", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    syncRunsError = true;

    await expect(fetchCoverageFreshnessLogged()).rejects.toThrow("sync_runs db error");
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("logs and rethrows on a participant-table failure instead of returning null", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    participantErrorTable = "zelle_participants";

    await expect(fetchCoverageFreshnessLogged()).rejects.toThrow("zelle_participants db error");
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});

describe("fetchCoverageReportLogged", () => {
  it("fetches all banks and delegates to computeCoverageReport", async () => {
    bankRows = [
      {
        is_active: true,
        source_authority: "fdic",
        state: "CA",
        total_assets: 500_000_000,
        fednow_participant: true,
        rtp_participant: null,
        zelle_participant: false,
      },
    ];
    const result = await fetchCoverageReportLogged();
    expect(result.totalActive).toBe(1);
    expect(result.overall.fednow.confirmed).toBe(1);
  });

  it("logs and rethrows when the banks fetch fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    banksError = true;

    await expect(fetchCoverageReportLogged()).rejects.toThrow("banks db error");
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
