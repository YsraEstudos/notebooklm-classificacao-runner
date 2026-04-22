import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const notebookFixture = readFileSync(join(here, 'fixtures', 'notebooklm-live.html'), 'utf8');

export function mountNotebookFixture() {
  document.body.innerHTML = notebookFixture;
  return document.body;
}
