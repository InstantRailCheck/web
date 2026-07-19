import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { submitUrlsToIndexNow, INDEXNOW_KEY } from "./indexNow";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
});

describe("submitUrlsToIndexNow", () => {
  it("does nothing when given no URLs", async () => {
    await submitUrlsToIndexNow([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs the correct IndexNow request shape", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });

    await submitUrlsToIndexNow(["https://www.instantrailcheck.com/banks/chase"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.indexnow.org/indexnow");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      host: "www.instantrailcheck.com",
      key: INDEXNOW_KEY,
      keyLocation: `https://www.instantrailcheck.com/${INDEXNOW_KEY}.txt`,
      urlList: ["https://www.instantrailcheck.com/banks/chase"],
    });
  });

  it("never throws on a non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(submitUrlsToIndexNow(["https://www.instantrailcheck.com/banks/chase"])).resolves.toBeUndefined();
  });

  it("never throws when the request itself fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network error"));
    await expect(submitUrlsToIndexNow(["https://www.instantrailcheck.com/banks/chase"])).resolves.toBeUndefined();
  });
});

describe("INDEXNOW_KEY", () => {
  it("matches the published key file's content exactly, so the two can never silently drift apart", () => {
    const keyFileContent = readFileSync(path.join(process.cwd(), "public", `${INDEXNOW_KEY}.txt`), "utf-8").trim();
    expect(keyFileContent).toBe(INDEXNOW_KEY);
  });
});
