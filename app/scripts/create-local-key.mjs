import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const path = new URL('../.dev.vars', import.meta.url);
try {
  await writeFile(path, `TEAM_KEY=${randomBytes(32).toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
  console.log('Created .dev.vars. Use the TEAM_KEY in this local file to sign in.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('.dev.vars already exists; the existing key was kept.');
}
