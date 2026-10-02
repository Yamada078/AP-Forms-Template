import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const sources = [
  'schema.sql',
  'migrations/0001_publish_system.sql',
  // schema.sql already includes respondent_meta, so 0002 is not repeated.
  'migrations/0003_integration_foundation.sql',
  'migrations/0004_application_form_access.sql',
  'migrations/0005_question_bank_foundation.sql',
  'migrations/0006_question_pack_foundation.sql',
  'migrations/0007_assessment_runtime_results.sql',
  'migrations/0008_question_activity_media.sql',
  'migrations/0009_question_pack_integration.sql',
];

export async function buildBootstrapSchema() {
  const parts = await Promise.all(sources.map(async source => {
    const sql = await readFile(new URL(`../${source}`, import.meta.url), 'utf8');
    return `-- ${source}\n${sql.trim()}\n`;
  }));
  return '-- AP+forms: initialize an empty database once.\n-- For existing databases, use the required additive migrations instead.\n\n' + parts.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = new URL('../database/', import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL('bootstrap.sql', directory), await buildBootstrapSchema(), 'utf8');
  console.log('Generated database/bootstrap.sql for a new database.');
}
