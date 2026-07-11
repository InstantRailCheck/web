import { describe, it, expect } from "vitest";
import { replaceTableSafely } from "./syncTableReplace.mjs";

function fakeSupabase({ existingRows = [], insertBehavior = () => ({ error: null }), deleteImpl } = {}) {
  let rows = [...existingRows];
  const deleteCalls = [];
  const insertCalls = [];

  const from = () => ({
    select: () => ({
      then: (resolve) => resolve({ data: rows.map((r) => ({ updated_at: r.updated_at })), error: null }),
    }),
    insert: (chunk) => {
      insertCalls.push(chunk);
      const result = insertBehavior(chunk, insertCalls.length);
      if (!result.error) rows.push(...chunk);
      return Promise.resolve(result);
    },
    delete: () => ({
      eq: (col, val) => {
        deleteCalls.push({ type: "eq", col, val });
        rows = rows.filter((r) => r[col] !== val);
        return deleteImpl?.("eq", col, val) ?? Promise.resolve({ error: null });
      },
      lt: (col, val) => {
        deleteCalls.push({ type: "lt", col, val });
        rows = rows.filter((r) => !(r[col] < val));
        return deleteImpl?.("lt", col, val) ?? Promise.resolve({ error: null });
      },
    }),
  });

  return { supabase: { from }, getRows: () => rows, deleteCalls, insertCalls };
}

describe("replaceTableSafely", () => {
  it("inserts new rows and removes the previous generation on success", async () => {
    const { supabase, getRows } = fakeSupabase({
      existingRows: [{ id: "old1", updated_at: "2020-01-01T00:00:00.000Z" }],
    });

    await replaceTableSafely(supabase, "t", [{ id: "new1" }, { id: "new2" }]);

    const rows = getRows();
    expect(rows.map((r) => r.id).sort()).toEqual(["new1", "new2"]);
  });

  it("aborts without touching the table when the new count drops below the retention floor", async () => {
    const existingRows = Array.from({ length: 100 }, (_, i) => ({ id: `old${i}`, updated_at: "2020-01-01T00:00:00.000Z" }));
    const { supabase, getRows, insertCalls } = fakeSupabase({ existingRows });

    await expect(replaceTableSafely(supabase, "t", [{ id: "new1" }])).rejects.toThrow(/looks like a parsing failure/);

    expect(insertCalls).toHaveLength(0);
    expect(getRows()).toHaveLength(100); // untouched
  });

  it("does not abort when the new count is a real but modest decrease (above the retention floor)", async () => {
    const existingRows = Array.from({ length: 100 }, (_, i) => ({ id: `old${i}`, updated_at: "2020-01-01T00:00:00.000Z" }));
    const { supabase, getRows } = fakeSupabase({ existingRows });
    const newRecords = Array.from({ length: 90 }, (_, i) => ({ id: `new${i}` }));

    await replaceTableSafely(supabase, "t", newRecords);

    expect(getRows()).toHaveLength(90);
  });

  it("cleans up this run's partial rows on a mid-insert failure, leaving the previous generation intact", async () => {
    const existingRows = [
      { id: "old1", updated_at: "2020-01-01T00:00:00.000Z" },
      { id: "old2", updated_at: "2020-01-01T00:00:00.000Z" },
    ];
    let calls = 0;
    const { supabase, getRows } = fakeSupabase({
      existingRows,
      insertBehavior: () => {
        calls++;
        if (calls === 2) return { error: new Error("network blip") };
        return { error: null };
      },
    });

    // chunkSize 1 forces multiple insert() calls so the 2nd one can fail
    // after the 1st already succeeded, reproducing a genuine partial insert.
    const newRecords = [{ id: "new1" }, { id: "new2" }, { id: "new3" }];
    await expect(
      replaceTableSafely(supabase, "t", newRecords, { minRetentionFraction: 0, chunkSize: 1 })
    ).rejects.toThrow("network blip");

    const rows = getRows();
    // Only the previous generation remains — no leftover partial rows from
    // the failed run, and nothing from the old generation was ever removed.
    expect(rows.map((r) => r.id).sort()).toEqual(["old1", "old2"]);
  });

  it("bases the retention check on the largest generation, not raw row count (robust to leftover orphaned rows)", async () => {
    // Simulates a previous run whose own cleanup-on-failure also failed:
    // one full good generation (50 rows) plus a small orphaned leftover
    // generation (5 rows) with an different (earlier) stamp. A raw count
    // would see 55 and require 44 new rows to pass 80%; the largest-
    // generation baseline should require only 40 (80% of 50).
    const existingRows = [
      ...Array.from({ length: 50 }, (_, i) => ({ id: `good${i}`, updated_at: "2020-06-01T00:00:00.000Z" })),
      ...Array.from({ length: 5 }, (_, i) => ({ id: `orphan${i}`, updated_at: "2020-01-01T00:00:00.000Z" })),
    ];
    const { supabase, getRows } = fakeSupabase({ existingRows });

    const newRecords = Array.from({ length: 42 }, (_, i) => ({ id: `new${i}` })); // 42/50 = 84%, passes; 42/55 = 76%, would fail a raw-count check

    await replaceTableSafely(supabase, "t", newRecords);

    expect(getRows().map((r) => r.id).every((id) => id.startsWith("new"))).toBe(true);
  });
});
