import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

const source = resolve('dist');
const destination = resolve('release');
const manifestText = await readFile(join(source, 'manifest.json'), 'utf8');
assert.equal(manifestText, await readFile('public/manifest.json', 'utf8'), 'Build the unchanged production manifest before packaging');
const manifest = JSON.parse(manifestText);
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
assert.equal(manifest.version, pkg.version, 'Package and manifest versions must match');
assert.deepEqual(manifest.host_permissions ?? [], [], 'Release must not contain the E2E host grants');
assert.ok(!manifest.permissions.includes('tabs'), 'Release must not contain the E2E tabs permission');

async function files(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    assert.ok(!entry.isSymbolicLink(), 'Release input may not contain symlinks');
    const relative = prefix + entry.name;
    if (entry.isDirectory()) paths.push(...await files(join(directory, entry.name), `${relative}/`));
    else if (entry.isFile()) paths.push(relative);
  }
  return paths.sort();
}

// ZIP32 with fixed 1980 timestamps and sorted UTF-8 paths: no platform metadata,
// absolute paths, filesystem timestamps, or external zip utility affect the archive.
const paths = await files(source);
assert.ok(paths.length > 0 && paths.length < 65536);
const localParts = [];
const centralParts = [];
let offset = 0;
for (const path of paths) {
  const name = Buffer.from(path);
  const data = await readFile(join(source, path));
  const compressed = deflateRawSync(data, { level: 9 });
  const checksum = crc32(data);
  assert.ok(data.length < 0xffffffff && offset < 0xffffffff, 'Release exceeds ZIP32 limits');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x800, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(0x21, 12);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  localParts.push(local, name, compressed);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  local.copy(central, 6, 4, 30);
  central.writeUInt32LE(offset, 42);
  centralParts.push(central, name);
  offset += local.length + name.length + compressed.length;
}
const directory = Buffer.concat(centralParts);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(paths.length, 8);
end.writeUInt16LE(paths.length, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);
const archive = Buffer.concat([...localParts, directory, end]);
const filename = `screenboard-${manifest.version}.zip`;
await mkdir(destination, { recursive: true });
await writeFile(join(destination, filename), archive);
const hash = createHash('sha256').update(archive).digest('hex');
await writeFile(join(destination, `${filename}.sha256`), `${hash}  ${filename}\n`);
console.log(`Packaged ${paths.length} production files: release/${filename} (${archive.length} bytes)\nSHA-256 ${hash}`);
