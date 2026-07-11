import AdmZip from "adm-zip";

export function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    header.forEach((key, i) => (row[key] = values[i]));
    return row;
  });
}

export function readZipCsvEntry(zipBuffer, entryName) {
  const zip = new AdmZip(zipBuffer);
  const entry = zip.getEntry(entryName);
  if (!entry) throw new Error(`Missing file in ZIP: ${entryName}`);
  return parseCsv(entry.getData().toString("utf8"));
}
