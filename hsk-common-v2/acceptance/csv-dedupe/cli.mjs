// Usage:
//   node cli.mjs expected <input.csv> <key>                  poster: publish this hash
//   node cli.mjs run      <input.csv> <key> <output.csv>     reference executor
//   node cli.mjs verify   <input.csv> <output.csv> <key> <expectedSha256>

import { readFileSync, writeFileSync } from 'node:fs';
import {
  dedupeKeepFirst, expectedSha256, parseCsv, serializeCsv, verifyCsvDedupe,
} from './csv-dedupe.mjs';

const [cmd, ...args] = process.argv.slice(2);
const read = (path) => readFileSync(path, 'utf8');

if (cmd === 'expected') {
  const [input, key] = args;
  console.log(expectedSha256(read(input), key));
} else if (cmd === 'run') {
  const [input, key, output] = args;
  writeFileSync(output, serializeCsv(dedupeKeepFirst(parseCsv(read(input)), key)));
  console.log(`wrote ${output}`);
} else if (cmd === 'verify') {
  const [input, output, key, expectedSha] = args;
  const verdict = verifyCsvDedupe({
    inputText: read(input), outputText: read(output), key, expectedSha,
  });
  console.log(JSON.stringify(verdict, null, 2));
  process.exitCode = verdict.passed ? 0 : 1;
} else {
  console.error('commands: expected | run | verify (see header of cli.mjs)');
  process.exitCode = 2;
}
