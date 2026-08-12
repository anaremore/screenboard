import type { Point, Rect, ViewportMetrics } from './types';

export function rectFromPoints(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function clampRect(rect: Rect, bounds: Pick<Rect, 'width' | 'height'>): Rect {
  const x = Math.min(Math.max(rect.x, 0), bounds.width);
  const y = Math.min(Math.max(rect.y, 0), bounds.height);
  const right = Math.min(Math.max(rect.x + rect.width, x), bounds.width);
  const bottom = Math.min(Math.max(rect.y + rect.height, y), bounds.height);

  return { x, y, width: right - x, height: bottom - y };
}

export function mapCssRectToImage(
  rect: Rect,
  viewport: ViewportMetrics,
  image: Pick<Rect, 'width' | 'height'>,
): Rect {
  if (viewport.width <= 0 || viewport.height <= 0 || image.width <= 0 || image.height <= 0) {
    throw new Error('Capture dimensions must be greater than zero.');
  }

  const clamped = clampRect(rect, viewport);
  if (clamped.width <= 0 || clamped.height <= 0) throw new Error('The selected area is outside the viewport.');
  const scaleX = image.width / viewport.width;
  const scaleY = image.height / viewport.height;
  const x = Math.round(clamped.x * scaleX);
  const y = Math.round(clamped.y * scaleY);
  const right = Math.round((clamped.x + clamped.width) * scaleX);
  const bottom = Math.round((clamped.y + clamped.height) * scaleY);

  return clampRect(
    { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) },
    image,
  );
}

export function intersectRect(rect: Rect, bounds: Rect): Rect {
  const left = Math.max(rect.x, bounds.x);
  const top = Math.max(rect.y, bounds.y);
  const right = Math.min(rect.x + rect.width, bounds.x + bounds.width);
  const bottom = Math.min(rect.y + rect.height, bounds.y + bounds.height);

  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}
