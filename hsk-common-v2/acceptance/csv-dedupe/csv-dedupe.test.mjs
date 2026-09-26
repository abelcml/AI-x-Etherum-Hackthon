import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  dedupeKeepFirst, expectedSha256, parseCsv, serializeCsv, verifyCsvDedupe,
} from './csv-dedupe.mjs';

const input = readFileSync(new URL('./sample.csv', import.meta.url), 'utf8');
const expectedSha = expectedSha256(input, 'id');
const good = serializeCsv(dedupeKeepFirst(parseCsv(input), 'id'));
const verify = (outputText) => verifyCsvDedupe({ inputText: input, outputText, key: 'id', expectedSha });

test('keep-first dedupe keeps the first row per id, in order', () => {
  const { rows } = dedupeKeepFirst(parseCsv(input), 'id');
  assert.deepEqual(rows.map((r) => r[1]), ['Alice', 'Bob', 'Carol', 'Dave', 'Eve']);
});

test('correct output passes all four rules', () => {
  assert.equal(verify(good).passed, true);
});

test('CRLF line endings do not change the verdict', () => {
  assert.equal(verify(good.replace(/\n/g, '\r\n')).passed, true);
});

test('header-only output fails (the hole in the original rule)', () => {
  const v = verify('id,name,city\n');
  assert.equal(v.passed, false);
  assert.ok(v.reasons.some((r) => r.startsWith('rule 2')));
});

test('dropping a row fails rule 2', () => {
  const v = verify(good.split('\n').filter((l) => !l.startsWith('5,')).join('\n'));
  assert.ok(v.reasons.some((r) => r.startsWith('rule 2')));
});

test('keeping the last occurrence instead of the first fails rule 4 only', () => {
  const last = 'id,name,city\n1,Alice Dup,Perth\n2,Bob Dup,Hobart\n3,Carol Dup,Darwin\n4,Dave,Adelaide\n5,Eve,Canberra\n';
  const v = verify(last);
  assert.deepEqual(v.reasons.map((r) => r.slice(0, 6)), ['rule 4']);
});

test('leftover duplicate fails rule 3', () => {
  const v = verify(good + '1,Alice Dup,Perth\n');
  assert.ok(v.reasons.some((r) => r.startsWith('rule 3')));
});

test('changed header fails rule 1', () => {
  const v = verify(good.replace('id,name,city', 'id,name'));
  assert.ok(v.reasons.some((r) => r.startsWith('rule 1')));
});
