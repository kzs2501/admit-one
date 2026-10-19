/**
 * CSV, as spreadsheets need it (RFC 4180): fields quoted when they hold a comma, a
 * quote or a line break, quotes doubled, CRLF between records, and a UTF-8 byte-order
 * mark so Excel reads "₹" and accented names correctly.
 *
 * Text from buyers is guarded against formula injection (OWASP, "CSV Injection"): a
 * cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return would run as a
 * formula when opened, so it's prefixed with `'`. Numbers aren't guarded — a
 * spreadsheet should read them as numbers — so callers say which cells are text.
 */

/** A cell the CSV writes as-is (a number, a date, a code) or guards (anything a buyer typed). */
export type CsvCell = number | string | { text: string };

const FORMULA_START = /^[=+\-@\t\r]/;

export const guardFormula = (text: string) => (FORMULA_START.test(text) ? `'${text}` : text);

const quote = (field: string) => (/[",\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field);

const fieldOf = (cell: CsvCell) => (typeof cell === "object" ? quote(guardFormula(cell.text)) : quote(String(cell)));

export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]) {
  return `﻿${[header.map(quote), ...rows.map((row) => row.map(fieldOf))].map((record) => record.join(",")).join("\r\n")}\r\n`;
}
