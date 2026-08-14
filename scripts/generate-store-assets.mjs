import { access, mkdir } from 'node:fs/promises';
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
  input('popup-recent-dark.png'),
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
  ['selection.png', '02-select-an-area.png'],
  ['element-selection.png', '03-capture-an-element.png'],
]) {
  await sharp(input(source))
    .resize(1280, 800, { fit: 'cover' })
    .png({ compressionLevel: 9 })
    .toFile(resolve(screenshots, name));
}

const popupLight = await sharp(input('popup-recent.png')).resize({ width: 500 }).png().toBuffer();
const popupDark = await sharp(input('popup-recent-dark.png')).resize({ width: 500 }).png().toBuffer();
const settings = await sharp(input('settings.png')).resize({ height: 700 }).png().toBuffer();
const heroIcon = await sharp(iconSource).resize(52, 52).png().toBuffer();

const clipboardToast = svg(510, 66, `
  <rect x="1" y="1" width="508" height="64" rx="12" fill="#111827" stroke="#465268" stroke-width="2"/>
  <path d="M25 34l7 7 14-17" fill="none" stroke="#55d9a4" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="61" y="40" fill="#f8fafc" font-family="Segoe UI, Arial, sans-serif" font-size="18" font-weight="650">Screenshot complete — copied to clipboard</text>
`);

await sharp(svg(1280, 800, `
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#0c1524"/><stop offset="1" stop-color="#13243a"/></linearGradient>
  </defs>
  <rect width="1280" height="800" fill="url(#bg)"/>
  <circle cx="500" cy="790" r="390" fill="#2d6bed" opacity=".08"/>
  <text x="148" y="98" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="27" font-weight="720">Screenboard</text>
  <text x="80" y="224" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="58" font-weight="760">Take a screenshot.</text>
  <text x="80" y="298" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="64" font-weight="760">It’s copied.</text>
  <text x="80" y="370" fill="#b9c7da" font-family="Segoe UI, Arial, sans-serif" font-size="23">Area, element, visible page, or full page.</text>
  <text x="80" y="409" fill="#b9c7da" font-family="Segoe UI, Arial, sans-serif" font-size="23">The PNG is ready to paste.</text>
  <text x="80" y="522" fill="#78e1b8" font-family="Segoe UI, Arial, sans-serif" font-size="16" font-weight="700" letter-spacing="2">AFTER A SUCCESSFUL CAPTURE</text>
  <rect x="668" y="48" width="552" height="704" rx="34" fill="#17253a" stroke="#2b3e59" stroke-width="2"/>
  <text x="720" y="118" fill="#8fa2bd" font-family="Segoe UI, Arial, sans-serif" font-size="16" font-weight="700" letter-spacing="2">CHOOSE A CAPTURE MODE</text>
`))
  .composite([
    { input: heroIcon, left: 80, top: 60 },
    { input: clipboardToast, left: 80, top: 545 },
    { input: popupLight, left: 694, top: 160 },
  ])
  .png({ compressionLevel: 9 })
  .toFile(resolve(screenshots, '01-copied-to-clipboard.png'));

await sharp(svg(1280, 800, `
  <rect width="1280" height="800" fill="#0f1929"/>
  <text x="80" y="82" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="38" font-weight="750">Light and dark</text>
  <text x="80" y="121" fill="#aebed5" font-family="Segoe UI, Arial, sans-serif" font-size="20">Screenboard follows your system theme.</text>
  <text x="80" y="180" fill="#8fa2bd" font-family="Segoe UI, Arial, sans-serif" font-size="17" font-weight="700" letter-spacing="2">LIGHT</text>
  <text x="700" y="180" fill="#8fa2bd" font-family="Segoe UI, Arial, sans-serif" font-size="17" font-weight="700" letter-spacing="2">DARK</text>
  <rect x="64" y="202" width="532" height="530" rx="28" fill="#e9eef5"/>
  <rect x="684" y="202" width="532" height="530" rx="28" fill="#19283f"/>
`))
  .composite([
    { input: popupLight, left: 80, top: 218 },
    { input: popupDark, left: 700, top: 218 },
  ])
  .png({ compressionLevel: 9 })
  .toFile(resolve(screenshots, '04-popup-and-recents.png'));

await sharp(svg(1280, 800, `
  <defs><linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#0c1422"/><stop offset="1" stop-color="#18314a"/></linearGradient></defs>
  <rect width="1280" height="800" fill="url(#bg)"/>
  <circle cx="180" cy="700" r="430" fill="#0ea56f" opacity=".12"/>
  <rect x="704" y="50" width="526" height="700" rx="34" fill="#ffffff" opacity=".06"/>
  <text x="78" y="190" fill="#61d9ac" font-family="Segoe UI, Arial, sans-serif" font-size="20" font-weight="700" letter-spacing="3">LOCAL BY DEFAULT</text>
  <text x="78" y="278" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="56" font-weight="750">Screenshots stay</text>
  <text x="78" y="344" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="56" font-weight="750">in your browser.</text>
  <text x="78" y="424" fill="#b7c5da" font-family="Segoe UI, Arial, sans-serif" font-size="23">Recent captures and settings are stored locally.</text>
  <text x="78" y="463" fill="#b7c5da" font-family="Segoe UI, Arial, sans-serif" font-size="23">Screenboard does not upload your screenshots.</text>
  <rect x="78" y="535" width="410" height="64" rx="16" fill="#17253a" stroke="#2e4665"/>
  <circle cx="111" cy="567" r="8" fill="#28c98b"/><text x="137" y="576" fill="#edf5ff" font-family="Segoe UI, Arial, sans-serif" font-size="21" font-weight="650">No account · No analytics</text>
`))
  .composite([{ input: settings, left: 729, top: 50 }])
  .png({ compressionLevel: 9 })
  .toFile(resolve(screenshots, '05-settings-and-privacy.png'));

const smallIcon = await sharp(iconSource).resize(82, 82).png().toBuffer();
await sharp(svg(440, 280, '<defs><linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#0c1524"/><stop offset="1" stop-color="#152b45"/></linearGradient></defs><rect width="440" height="280" fill="url(#bg)"/>'))
  .composite([
    { input: svg(440, 280, '<path d="M24 70V28h42M374 28h42v42M24 210v42h42M374 252h42v-42" fill="none" stroke="#4c83f3" stroke-width="3" stroke-linecap="round"/><text x="133" y="112" fill="#fff" font-family="Segoe UI, Arial, sans-serif" font-size="35" font-weight="750">Screenboard</text><text x="220" y="184" fill="#dce7f7" font-family="Segoe UI, Arial, sans-serif" font-size="24" font-weight="650" text-anchor="middle">Screenshots to clipboard.</text>') },
    { input: smallIcon, left: 38, top: 64 },
  ])
  .png({ compressionLevel: 9 })
  .toFile(output('small-promo-440x280.png'));

const marqueePopup = await sharp(input('popup-recent.png')).resize({ width: 390 }).png().toBuffer();
const marqueeIcon = await sharp(iconSource).resize(84, 84).png().toBuffer();
await sharp(svg(1400, 560, '<rect width="1400" height="560" fill="#0f1929"/>'))
  .composite([
    { input: svg(1400, 560, '<text x="154" y="151" fill="#fff" font-family="Segoe UI, Arial, sans-serif" font-size="58" font-weight="760">Screenboard</text><text x="76" y="264" fill="#f2f6ff" font-family="Segoe UI, Arial, sans-serif" font-size="43" font-weight="730">Take a screenshot.</text><text x="76" y="318" fill="#f2f6ff" font-family="Segoe UI, Arial, sans-serif" font-size="43" font-weight="730">It’s copied.</text><text x="76" y="375" fill="#b8c8de" font-family="Segoe UI, Arial, sans-serif" font-size="24">Area, element, visible page, or full page.</text><circle cx="84" cy="428" r="7" fill="#2dd69b"/><text x="107" y="437" fill="#dce7f7" font-family="Segoe UI, Arial, sans-serif" font-size="21">No account. No upload.</text><rect x="900" y="60" width="430" height="440" rx="32" fill="#17253a"/>') },
    { input: marqueeIcon, left: 54, top: 112 },
    { input: marqueePopup, left: 920, top: 84 },
  ])
  .png({ compressionLevel: 9 })
  .toFile(output('marquee-promo-1400x560.png'));

const headerIcon = await sharp(iconSource).resize(96, 96).png().toBuffer();
await sharp(svg(1600, 400, '<rect width="1600" height="400" fill="#0f1929"/>'))
  .composite([
    { input: svg(1600, 400, '<text x="650" y="178" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="74" font-weight="760">Screenboard</text><text x="800" y="282" fill="#c0ccdd" font-family="Segoe UI, Arial, sans-serif" font-size="34" font-weight="600" text-anchor="middle">Screenshots, straight to your clipboard.</text>') },
    { input: headerIcon, left: 526, top: 102 },
  ])
  .png({ compressionLevel: 9 })
  .toFile(resolve('docs/images/screenboard-header.png'));

const productPopupLight = await sharp(input('popup-recent.png')).resize({ width: 580 }).png().toBuffer();
const productPopupDark = await sharp(input('popup-recent-dark.png')).resize({ width: 580 }).png().toBuffer();
await sharp(svg(1320, 680, '<rect width="660" height="680" fill="#eef2f7"/><rect x="660" width="660" height="680" fill="#0f1929"/><text x="48" y="55" fill="#52617a" font-family="Segoe UI, Arial, sans-serif" font-size="18" font-weight="700" letter-spacing="2">LIGHT</text><text x="708" y="55" fill="#8fa2bd" font-family="Segoe UI, Arial, sans-serif" font-size="18" font-weight="700" letter-spacing="2">DARK</text>'))
  .composite([
    { input: productPopupLight, left: 40, top: 76 },
    { input: productPopupDark, left: 700, top: 76 },
  ])
  .png({ compressionLevel: 9 })
  .toFile(resolve('docs/images/screenboard-product.png'));

const expectedAssets = [
  [output('icon-128.png'), 128, 128],
  [output('small-promo-440x280.png'), 440, 280],
  [output('marquee-promo-1400x560.png'), 1400, 560],
  [resolve(screenshots, '01-copied-to-clipboard.png'), 1280, 800],
  [resolve(screenshots, '02-select-an-area.png'), 1280, 800],
  [resolve(screenshots, '03-capture-an-element.png'), 1280, 800],
  [resolve(screenshots, '04-popup-and-recents.png'), 1280, 800],
  [resolve(screenshots, '05-settings-and-privacy.png'), 1280, 800],
  [resolve('docs/images/screenboard-header.png'), 1600, 400],
  [resolve('docs/images/screenboard-product.png'), 1320, 680],
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
