/** R-D1: the worked example from REQUIREMENTS.md. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getWindow, isInWindow } from '../src/lib/window.js';

test('run Nov 29 15:00 UTC → window Nov 15 00:00 UTC → Nov 29 15:00 UTC', () => {
  const w = getWindow(new Date('2026-11-29T15:00:00Z'));
  assert.equal(w.start.toISOString(), '2026-11-15T00:00:00.000Z');
  assert.equal(w.end.toISOString(), '2026-11-29T15:00:00.000Z');
  assert.ok(isInWindow('2026-11-15T00:00:00Z', w));
  assert.ok(!isInWindow('2026-11-14T23:59:59Z', w));
});
