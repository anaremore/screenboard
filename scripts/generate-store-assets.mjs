import { access, copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const results = resolve('test-results');
const screenshots = resolve('store-assets/screenshots');
const iconSource = resolve('assets/icon-source.svg');

const input = (name) => resolve(results, name);
const output = (name) => resolve('store-assets', name);

const required = [
  iconSource,
  input('capture-complete.png'),
  input('selection.png'),
  input('element-selection.png'),
  input('popup-recent.png'),
  input('settings.png'),
];

for (const path of required) await access(path);
await mkdir(screenshots, { recursive: true });
await mkdir(resolve('docs/images'), { recursive: true });

const svg = (width, height, content) => Buffer.from(`
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    ${content}
  </svg>
`);

const icon = await sharp(iconSource).resize(96, 96).png().toBuffer();
await sharp({ create: { width: 128, height: 128, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: icon, left: 16, top: 16 }])
  .png({ compressionLevel: 9 })
  .toFile(output('icon-128.png'));

for (const [source, name] of [
  ['capture-complete.png', '01-copied-to-clipboard.png'],
  ['selection.png', '02-select-an-area.png'],
  ['element-selection.png', '03-capture-an-element.png'],
]) {
  await sharp(input(source))
    .resize(1280, 800, { fit: 'cover' })
    .png({ compressionLevel: 9 })
    .toFile(resolve(screenshots, name));
}

const popup = await sharp(input('popup-recent.png')).resize({ width: 470 }).png().toBuffer();
const settings = await sharp(input('settings.png')).resize({ height: 700 }).png().toBuffer();

await sharp(svg(1280, 800, `
  <defs><linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#0d1524"/><stop offset="1" stop-color="#17243a"/></linearGradient></defs>
  <rect width="1280" height="800" fill="url(#bg)"/>
  <circle cx="1120" cy="105" r="360" fill="#2563eb" opacity=".16"/>
  <rect x="730" y="84" width="500" height="632" rx="34" fill="#ffffff" opacity=".07"/>
  <text x="84" y="194" fill="#78a7ff" font-family="Segoe UI, Arial, sans-serif" font-size="20" font-weight="700" letter-spacing="3">SCREENBOARD</text>
  <text x="84" y="282" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="60" font-weight="750">Capture. Copy. Paste.</text>
  <text x="84" y="424" fill="#b7c5da" font-family="Segoe UI, Arial, sans-serif" font-size="25">Choose area, element, visible, or full page.</text>
  <text x="84" y="461" fill="#b7c5da" font-family="Segoe UI, Arial, sans-serif" font-size="25">Recent captures stay on this device.</text>
  <circle cx="96" cy="548" r="7" fill="#28c98b"/><text x="118" y="556" fill="#dce7f7" font-family="Segoe UI, Arial, sans-serif" font-size="21">Copied automatically as PNG.</text>
`))
  .composite([{ input: popup, left: 745, top: 153 }])
  .png({ compressionLevel: 9 })
  .toFile(resolve(screenshots, '04-popup-and-recents.png'));

await sharp(svg(1280, 800, `
  <defs><linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#0c1422"/><stop offset="1" stop-color="#18314a"/></linearGradient></defs>
  <rect width="1280" height="800" fill="url(#bg)"/>
  <circle cx="180" cy="700" r="430" fill="#0ea56f" opacity=".12"/>
  <rect x="704" y="50" width="526" height="700" rx="34" fill="#ffffff" opacity=".06"/>
  <text x="78" y="190" fill="#61d9ac" font-family="Segoe UI, Arial, sans-serif" font-size="20" font-weight="700" letter-spacing="3">PRIVATE BY DESIGN</text>
  <text x="78" y="278" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="60" font-weight="750">Your screenshots</text>
  <text x="78" y="346" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="60" font-weight="750">stay in Chrome.</text>
  <text x="78" y="424" fill="#b7c5da" font-family="Segoe UI, Arial, sans-serif" font-size="24">Control automatic saves and local history.</text>
  <text x="78" y="463" fill="#b7c5da" font-family="Segoe UI, Arial, sans-serif" font-size="24">Nothing is sent to an external service.</text>
  <rect x="78" y="535" width="410" height="64" rx="16" fill="#17253a" stroke="#2e4665"/>
  <circle cx="111" cy="567" r="8" fill="#28c98b"/><text x="137" y="576" fill="#edf5ff" font-family="Segoe UI, Arial, sans-serif" font-size="21" font-weight="650">Local-first capture history</text>
`))
  .composite([{ input: settings, left: 729, top: 50 }])
  .png({ compressionLevel: 9 })
  .toFile(resolve(screenshots, '05-settings-and-privacy.png'));

const smallIcon = await sharp(iconSource).resize(68, 68).png().toBuffer();
await sharp(svg(440, 280, '<rect width="440" height="280" fill="#0f1929"/>'))
  .composite([
    { input: svg(440, 280, '<rect x="24" y="22" width="392" height="236" rx="26" fill="#131f32" stroke="#31445f"/><text x="112" y="90" fill="#fff" font-family="Segoe UI, Arial, sans-serif" font-size="36" font-weight="750">Screenboard</text><text x="38" y="166" fill="#e6effd" font-family="Segoe UI, Arial, sans-serif" font-size="22" font-weight="650">Screenshots, straight</text><text x="38" y="197" fill="#e6effd" font-family="Segoe UI, Arial, sans-serif" font-size="22" font-weight="650">to your clipboard.</text><circle cx="42" cy="226" r="5" fill="#2dd69b"/><text x="56" y="232" fill="#aebed5" font-family="Segoe UI, Arial, sans-serif" font-size="14">Nothing is uploaded</text>') },
    { input: smallIcon, left: 36, top: 38 },
  ])
  .png({ compressionLevel: 9 })
  .toFile(output('small-promo-440x280.png'));

const marqueePopup = await sharp(input('popup-recent.png')).resize({ width: 390 }).png().toBuffer();
const marqueeIcon = await sharp(iconSource).resize(84, 84).png().toBuffer();
await sharp(svg(1400, 560, '<rect width="1400" height="560" fill="#0f1929"/>'))
  .composite([
    { input: svg(1400, 560, '<text x="154" y="181" fill="#fff" font-family="Segoe UI, Arial, sans-serif" font-size="68" font-weight="760">Screenboard</text><text x="76" y="290" fill="#f2f6ff" font-family="Segoe UI, Arial, sans-serif" font-size="40" font-weight="700">Capture. Copy. Paste.</text><text x="76" y="346" fill="#b8c8de" font-family="Segoe UI, Arial, sans-serif" font-size="25">Area, element, visible, or full page.</text><circle cx="84" cy="405" r="7" fill="#2dd69b"/><text x="107" y="414" fill="#dce7f7" font-family="Segoe UI, Arial, sans-serif" font-size="21">Screenshots stay on this device.</text><rect x="900" y="60" width="430" height="440" rx="32" fill="#17253a"/>') },
    { input: marqueeIcon, left: 54, top: 112 },
    { input: marqueePopup, left: 920, top: 84 },
  ])
  .png({ compressionLevel: 9 })
  .toFile(output('marquee-promo-1400x560.png'));

const headerPopup = await sharp(input('popup-recent.png')).resize({ width: 500 }).png().toBuffer();
const headerIcon = await sharp(iconSource).resize(96, 96).png().toBuffer();
await sharp(svg(1920, 720, '<rect width="1920" height="720" fill="#0f1929"/>'))
  .composite([
    { input: svg(1920, 720, '<text x="238" y="227" fill="#fff" font-family="Segoe UI, Arial, sans-serif" font-size="78" font-weight="760">Screenboard</text><text x="116" y="362" fill="#f4f7ff" font-family="Segoe UI, Arial, sans-serif" font-size="44" font-weight="680">Screenshots, straight to your clipboard.</text><text x="116" y="424" fill="#b9c7db" font-family="Segoe UI, Arial, sans-serif" font-size="26">Area, element, visible, or full page.</text><circle cx="124" cy="494" r="8" fill="#2dd69b"/><text x="150" y="503" fill="#dce7f7" font-family="Segoe UI, Arial, sans-serif" font-size="23">Nothing is uploaded.</text><rect x="1210" y="58" width="560" height="604" rx="32" fill="#17253a"/>') },
    { input: headerIcon, left: 116, top: 150 },
    { input: headerPopup, left: 1240, top: 88 },
  ])
  .png({ compressionLevel: 9 })
  .toFile(resolve('docs/images/screenboard-header.png'));

await copyFile(input('popup-recent.png'), resolve('docs/images/screenboard-product.png'));

const popupMetadata = await sharp(input('popup-recent.png')).metadata();

const expectedAssets = [
  [output('icon-128.png'), 128, 128],
  [output('small-promo-440x280.png'), 440, 280],
  [output('marquee-promo-1400x560.png'), 1400, 560],
  [resolve(screenshots, '01-copied-to-clipboard.png'), 1280, 800],
  [resolve(screenshots, '02-select-an-area.png'), 1280, 800],
  [resolve(screenshots, '03-capture-an-element.png'), 1280, 800],
  [resolve(screenshots, '04-popup-and-recents.png'), 1280, 800],
  [resolve(screenshots, '05-settings-and-privacy.png'), 1280, 800],
  [resolve('docs/images/screenboard-header.png'), 1920, 720],
  [resolve('docs/images/screenboard-product.png'), popupMetadata.width, popupMetadata.height],
];

for (const [path, width, height] of expectedAssets) {
  const metadata = await sharp(path).metadata();
  if (metadata.width !== width || metadata.height !== height) {
    throw new Error(`${path} is ${metadata.width} × ${metadata.height}; expected ${width} × ${height}.`);
  }
}

if (!(await sharp(output('icon-128.png')).metadata()).hasAlpha) {
  throw new Error('The 128 × 128 store icon must preserve its transparent safety margin.');
}

console.log(`Generated and validated ${expectedAssets.length} Chrome Web Store and README images.`);
