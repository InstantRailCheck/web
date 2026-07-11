import { describe, it, expect } from "vitest";
import AdmZip from "adm-zip";
import { parseCsv, readZipCsvEntry } from "./zipCsv.mjs";

function buildZip(files) {
  const zip = new AdmZip();
  for (const [name, contents] of Object.entries(files)) {
    zip.addFile(name, Buffer.from(contents, "utf8"));
  }
  return zip.toBuffer();
}

describe("parseCsv", () => {
  it("parses a simple header + rows into objects", () => {
    const rows = parseCsv("Name,City\nAcme Credit Union,Springfield\nWidget FCU,Shelbyville");
    expect(rows).toEqual([
      { Name: "Acme Credit Union", City: "Springfield" },
      { Name: "Widget FCU", City: "Shelbyville" },
    ]);
  });

  it("handles quoted fields containing commas and escaped quotes", () => {
    const rows = parseCsv('Name,Note\n"Acme, Inc.","She said ""hi"""');
    expect(rows).toEqual([{ Name: "Acme, Inc.", Note: 'She said "hi"' }]);
  });

  it("skips blank lines", () => {
    const rows = parseCsv("Name,City\nAcme,Springfield\n\nWidget,Shelbyville\n");
    expect(rows).toHaveLength(2);
  });
});

describe("readZipCsvEntry", () => {
  it("reads and parses a named entry from a real zip built with the installed adm-zip", () => {
    const buffer = buildZip({
      "FOICU.txt": "CU_NUMBER,CU_NAME\n1001,Acme Credit Union\n1002,Widget FCU",
    });

    const rows = readZipCsvEntry(buffer, "FOICU.txt");
    expect(rows).toEqual([
      { CU_NUMBER: "1001", CU_NAME: "Acme Credit Union" },
      { CU_NUMBER: "1002", CU_NAME: "Widget FCU" },
    ]);
  });

  it("reads the correct entry when the zip contains multiple files", () => {
    const buffer = buildZip({
      "FOICU.txt": "CU_NUMBER,CU_NAME\n1001,Acme Credit Union",
      "TradeNames.txt": "CU_NUMBER,TradeName\n1001,Acme CU",
    });

    expect(readZipCsvEntry(buffer, "TradeNames.txt")).toEqual([{ CU_NUMBER: "1001", TradeName: "Acme CU" }]);
  });

  it("throws a clear error when the named entry is missing", () => {
    const buffer = buildZip({ "FOICU.txt": "CU_NUMBER,CU_NAME\n1001,Acme Credit Union" });

    expect(() => readZipCsvEntry(buffer, "FS220.txt")).toThrow("Missing file in ZIP: FS220.txt");
  });
});
