import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mediaDirectory = join(root, 'public', 'assets', 'question-media');
const versionedDirectory = join(mediaDirectory, 'versioned');
const supported = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

await mkdir(versionedDirectory, { recursive: true });
const entries = await readdir(mediaDirectory, { withFileTypes: true });
const sources = entries
  .filter(entry => entry.isFile() && supported.has(extname(entry.name).toLowerCase()))
  .sort((a, b) => a.name.localeCompare(b.name));

const assets = [];
for (const entry of sources) {
  const sourcePath = join(mediaDirectory, entry.name);
  const bytes = await readFile(sourcePath);
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const extension = extname(entry.name).toLowerCase();
  const stem = basename(entry.name, extname(entry.name)).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'image';
  const versionedName = `${stem}.${hash}${extension}`;
  const versionedPath = join(versionedDirectory, versionedName);
  await copyFile(sourcePath, versionedPath);
  assets.push({
    id: hash,
    name: entry.name,
    path: `/assets/question-media/versioned/${versionedName}`,
    bytes: bytes.byteLength,
    extension: extension.slice(1),
  });
}

const manifest = { schemaVersion: 1, generatedAt: new Date().toISOString(), assets };
await writeFile(join(mediaDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Question media manifest: ${assets.length} asset(s) from ${relative(root, mediaDirectory)}`);
