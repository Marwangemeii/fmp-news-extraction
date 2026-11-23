import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Writes one JSON object per line. Writes to a temp file first, then renames,
 * so a crash mid-write never leaves a half-written articles.jsonl behind.
 *
 * @param {string} path
 * @param {object[]} records
 */
export async function writeJsonl(path, records) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  const body = records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');
  await writeFile(tmp, body, 'utf8');
  await rename(tmp, path);
}

/**
 * Returns one entry per non-empty line: `{ line, record }` or `{ line, error }`,
 * so the validator can report the exact line that failed to parse.
 *
 * @param {string} path
 */
export async function readJsonl(path) {
  const text = await readFile(path, 'utf8');
  return text
    .split('\n')
    .map((raw, i) => ({ raw, line: i + 1 }))
    .filter(({ raw }) => raw.trim() !== '')
    .map(({ raw, line }) => {
      try {
        return { line, record: JSON.parse(raw) };
      } catch (err) {
        return { line, error: err.message };
      }
    });
}
