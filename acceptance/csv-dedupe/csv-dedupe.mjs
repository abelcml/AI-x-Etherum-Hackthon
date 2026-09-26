// CSV dedupe task: reference executor and verifier.
// Scope: comma-separated, UTF-8, first line is the header, no quoted fields.
// See docs/task-labels.md section 5 for the acceptance rules.

import { createHash } from 'node:crypto';

export function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (!lines.length) throw new Error('CSV is empty (no header)');
  const [header, ...body] = lines.map((line) => line.split(','));
  return { header, rows: body };
}

// Canonical form: LF line endings, trailing newline. Hashing this form means
// CRLF vs LF does not change the verdict.
export function serializeCsv({ header, rows }) {
  return [header, ...rows].map((cells) => cells.join(',')).join('\n') + '\n';
}

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// Keep the first row seen for each key value; original order is preserved.
export function dedupeKeepFirst({ header, rows }, key) {
  const col = header.indexOf(key);
  if (col < 0) throw new Error(`key column not found: ${key}`);
  const seen = new Set();
  const kept = rows.filter((row) => {
    if (seen.has(row[col])) return false;
    seen.add(row[col]);
    return true;
  });
  return { header, rows: kept };
}

export function expectedSha256(inputText, key) {
  return sha256(serializeCsv(dedupeKeepFirst(parseCsv(inputText), key)));
}

// Four rules from docs/task-labels.md section 5. Rule 2 is what stops an
// empty-but-valid-looking CSV from passing.
export function verifyCsvDedupe({ inputText, outputText, key, expectedSha }) {
  const input = parseCsv(inputText);
  const output = parseCsv(outputText);
  const reasons = [];

  if (output.header.join(',') !== input.header.join(',')) {
    reasons.push('rule 1: header differs from input');
  }

  const inCol = input.header.indexOf(key);
  const outCol = output.header.indexOf(key);
  if (inCol < 0 || outCol < 0) {
    reasons.push(`key column not found: ${key}`);
  } else {
    const inIds = new Set(input.rows.map((row) => row[inCol]));
    const outIds = output.rows.map((row) => row[outCol]);
    const outIdSet = new Set(outIds);
    const missing = [...inIds].filter((id) => !outIdSet.has(id));
    const extra = [...outIdSet].filter((id) => !inIds.has(id));
    if (missing.length || extra.length) {
      reasons.push(`rule 2: id set differs (missing ${missing.length}, extra ${extra.length})`);
    }
    if (outIdSet.size !== outIds.length) {
      reasons.push(`rule 3: ${outIds.length - outIdSet.size} duplicate id(s) in output`);
    }
  }

  const outputSha256 = sha256(serializeCsv(output));
  if (outputSha256 !== expectedSha.toLowerCase()) {
    reasons.push('rule 4: output hash does not match expected hash');
  }

  return { passed: reasons.length === 0, reasons, outputSha256 };
}
