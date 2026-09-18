/**
 * CSV writing for admin exports.
 *
 * Exports are opened in Excel and Google Sheets, which evaluate any cell
 * starting with =, +, - or @ as a formula. A user whose bio reads
 * `=HYPERLINK("http://evil","click")` would otherwise become a live link in
 * an operator's spreadsheet, so every such field is prefixed with a quote.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function escapeCell(value) {
  if (value === null || value === undefined) return '';
  let s = Array.isArray(value) ? value.join('; ') : String(value);
  if (value instanceof Date) s = value.toISOString();
  if (FORMULA_LEAD.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function toRow(values) {
  return values.map(escapeCell).join(',');
}

/**
 * Starts a streamed CSV response. Never build the whole file in memory: an
 * export of every user is unbounded by definition.
 */
function startCsv(res, filename, columns) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  // BOM so Excel reads the file as UTF-8 rather than the local codepage.
  res.write('﻿');
  res.write(`${toRow(columns)}\n`);
}

function writeRows(res, rows, pick) {
  if (!rows.length) return;
  res.write(`${rows.map((row) => toRow(pick(row))).join('\n')}\n`);
}

module.exports = { escapeCell, toRow, startCsv, writeRows };
