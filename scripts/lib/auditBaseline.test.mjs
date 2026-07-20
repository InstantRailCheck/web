import { describe, it, expect, afterEach } from "vitest";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBaselineKeys, saveBaselineKeys, partitionByBaseline } from "./auditBaseline.mjs";

const TMP_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "_tmp-audit-baseline-test.json");

afterEach(async () => {
  await unlink(TMP_PATH).catch(() => {});
});

describe("loadBaselineKeys", () => {
  it("returns an empty set when the file doesn't exist yet", async () => {
    const keys = await loadBaselineKeys(TMP_PATH);
    expect(keys).toEqual(new Set());
  });

  it("round-trips through saveBaselineKeys", async () => {
    await saveBaselineKeys(TMP_PATH, ["b", "a", "a"]);
    const keys = await loadBaselineKeys(TMP_PATH);
    expect(keys).toEqual(new Set(["a", "b"]));
  });

  it("writes a sorted, deduplicated, human-diffable JSON array", async () => {
    await saveBaselineKeys(TMP_PATH, ["zebra", "apple", "apple"]);
    const raw = await readFile(TMP_PATH, "utf8");
    expect(JSON.parse(raw)).toEqual(["apple", "zebra"]);
  });
});

describe("partitionByBaseline", () => {
  it("splits items into news and known by key membership", () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const baseline = new Set([2]);

    const { news, known } = partitionByBaseline(items, (item) => item.id, baseline);

    expect(news).toEqual([{ id: 1 }, { id: 3 }]);
    expect(known).toEqual([{ id: 2 }]);
  });

  it("treats everything as new when the baseline is empty", () => {
    const items = [{ id: 1 }, { id: 2 }];

    const { news, known } = partitionByBaseline(items, (item) => item.id, new Set());

    expect(news).toEqual(items);
    expect(known).toEqual([]);
  });

  it("preserves item order within each output array", () => {
    const items = [{ id: "c" }, { id: "a" }, { id: "b" }];
    const baseline = new Set(["a", "b"]);

    const { news, known } = partitionByBaseline(items, (item) => item.id, baseline);

    expect(news).toEqual([{ id: "c" }]);
    expect(known).toEqual([{ id: "a" }, { id: "b" }]);
  });
});
