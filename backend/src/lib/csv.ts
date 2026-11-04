import { parseAmount, validateAmount } from "./money";
import { CATEGORIES, validateDate, type Category } from "./transactions";

export const MAX_ROWS = 10_000;

/** RFC 4180: quoted fields, "" escapes, embedded commas/newlines, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(field), (field = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field), rows.push(row), (row = []), (field = "");
    } else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

export interface ImportRow {
  line: number;
  date: string;
  description: string;
  amountMinor: number;
  category?: Category;
  raw: string[];
}

export function parseImport(text: string, now = new Date()): { rows: ImportRow[]; rejections: { row: number; reason: string }[] } {
  const all = parseCsv(text.replace(/^﻿/, ""));
  if (!all.length) throw new Error("File is empty");
  const header = all[0].map((h) => h.trim().toLowerCase());
  const hasCategory = header.length === 4 && header[3] === "category";
  if (header[0] !== "date" || header[1] !== "description" || header[2] !== "amount" || (header.length === 4 && !hasCategory) || header.length > 4)
    throw new Error("Header must be: date,description,amount[,category]");
  if (all.length - 1 > MAX_ROWS) throw new Error(`File has more than ${MAX_ROWS} rows`);

  const rows: ImportRow[] = [];
  const rejections: { row: number; reason: string }[] = [];
  all.slice(1).forEach((raw, i) => {
    const line = i + 2;
    const [date, description, amount, category] = raw.map((f) => f.trim());
    const reject = (reason: string) => rejections.push({ row: line, reason });
    const dateErr = validateDate(date, now);
    if (dateErr) return reject(dateErr);
    if (!description || description.length > 200) return reject("description must be 1–200 chars");
    let amountMinor: number;
    try {
      amountMinor = parseAmount(amount ?? "");
    } catch {
      return reject(`invalid amount "${amount ?? ""}"`);
    }
    const amtErr = validateAmount(amountMinor);
    if (amtErr) return reject(amtErr);
    if (category && !CATEGORIES.includes(category.toLowerCase() as Category)) return reject(`unknown category "${category}"`);
    rows.push({ line, date, description, amountMinor, category: category ? (category.toLowerCase() as Category) : undefined, raw });
  });
  return { rows, rejections };
}
