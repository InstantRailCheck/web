export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";

  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];

  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvValue(row[h])).join(","));
  }

  return lines.join("\n");
}

// A cell whose content starts with =, +, -, or @ (optionally after leading
// whitespace, which spreadsheet apps typically strip before checking) can
// execute as a formula when the CSV is opened in Excel/Sheets/LibreOffice —
// quoting alone (below) only protects against the value being misparsed as
// multiple CSV fields, not against this. Only applies to actual string
// values (bank names, addresses, etc., some of which are user-influenced
// via addBank()) — a genuine number must stay numeric, not get a leading
// apostrophe that turns it into text.
const FORMULA_INJECTION_PATTERN = /^\s*[=+\-@]/;

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  let str = String(value);
  if (typeof value === "string" && FORMULA_INJECTION_PATTERN.test(str)) {
    str = `'${str}`;
  }
  if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}
