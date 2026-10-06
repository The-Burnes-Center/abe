// ---------- CSV export ----------

export type CSVRow = Array<string | number>;

export function downloadCSV(filename: string, rows: CSVRow[]) {
  const escape = (v: string | number) => {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const csv = rows.map((r) => r.map(escape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Builds `<prefix>-<from>_to_<to>.csv` from a response's range metadata. */
export function rangeFilename(prefix: string, range?: { from: string; to: string }): string {
  return `${prefix}-${range?.from ?? "from"}_to_${range?.to ?? "to"}.csv`;
}
