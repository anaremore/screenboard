import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';

const source = resolve('assets/icon-source.svg');

for (const size of [16, 32, 48, 128]) {
  const output = resolve(`public/icons/icon-${size}.png`);
  await mkdir(dirname(output), { recursive: true });
  await sharp(source).resize(size, size).png().toFile(output);
}
