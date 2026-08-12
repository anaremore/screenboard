const pad = (value: number) => String(value).padStart(2, '0');

export function createCaptureFilename(date = new Date()): string {
  const stamp = [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
  return `screenboard-${stamp}.png`;
}
