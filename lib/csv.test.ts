import { describe, it, expect } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("returns an empty string for no rows", () => {
    expect(toCsv([])).toBe("");
  });

  it("writes a header row and data rows", () => {
    expect(toCsv([{ a: "1", b: "2" }])).toBe("a,b\n1,2");
  });

  it("quotes values containing a comma, quote, or newline", () => {
    expect(toCsv([{ a: "x,y", b: 'say "hi"', c: "line1\nline2" }])).toBe(
      'a,b,c\n"x,y","say ""hi""","line1\nline2"'
    );
  });

  it("quotes a value containing a bare carriage return", () => {
    expect(toCsv([{ a: "line1\rline2" }])).toBe('a\n"line1\rline2"');
  });

  it("quotes a value containing a CRLF sequence", () => {
    expect(toCsv([{ a: "line1\r\nline2" }])).toBe('a\n"line1\r\nline2"');
  });

  it("renders null/undefined as an empty cell", () => {
    expect(toCsv([{ a: null, b: undefined }])).toBe("a,b\n,");
  });

  describe("spreadsheet formula injection", () => {
    it.each([
      ["=HYPERLINK", '=HYPERLINK("http://evil.example","Click")'],
      ["+cmd", "+cmd|'/c calc'!A1"],
      ["-1+1", "-1+1"],
      ["@SUM", "@SUM(1,1)"],
    ])("neutralizes a string cell starting with a formula trigger (%s)", (_label, malicious) => {
      const csv = toCsv([{ name: malicious }]);
      const cell = csv.split("\n")[1];
      // The dangerous leading character must not be the first character of
      // the cell as a spreadsheet app would read it — either directly
      // prefixed with a quote, or (once that pushes the value into needing
      // CSV quoting) the leading char right after the opening double-quote.
      expect(cell.startsWith('"') ? cell[1] : cell[0]).toBe("'");
    });

    it.each([
      ["leading space", "  =SUM(1,1)"],
      ["leading tab", "\t=SUM(1,1)"],
    ])("neutralizes a formula trigger after leading whitespace (%s)", (_label, malicious) => {
      const csv = toCsv([{ name: malicious }]);
      const cell = csv.split("\n")[1];
      // The safety prefix goes at the true start of the cell, not after the
      // whitespace — spreadsheet apps strip leading whitespace before
      // checking the first character, so the quote has to precede it.
      const rawCell = cell.startsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell;
      expect(rawCell[0]).toBe("'");
    });

    it("does not mangle a genuine negative number (non-string value)", () => {
      const csv = toCsv([{ delta: -5 }]);
      expect(csv).toBe("delta\n-5");
    });

    it("does not touch an ordinary string with no formula-triggering leading character", () => {
      const csv = toCsv([{ name: "Chase Bank" }]);
      expect(csv).toBe("name\nChase Bank");
    });

    it("does not treat a leading character elsewhere in the string as dangerous", () => {
      const csv = toCsv([{ name: "Bank = Trust Co." }]);
      expect(csv).toBe("name\nBank = Trust Co.");
    });
  });
});
