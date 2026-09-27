import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
export function tempDb(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'visulia-store-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'sessions.db');
}
