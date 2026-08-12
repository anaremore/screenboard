import type { FullPageSlice, PageMetrics } from './types';

function destinationOffsets(total: number, viewport: number): number[] {
  if (total <= viewport) return [0];
  const offsets: number[] = [];
  for (let offset = 0; offset < total; offset += viewport) offsets.push(offset);
  return offsets;
}

export function planFullPageSlices(metrics: PageMetrics): FullPageSlice[] {
  const { pageWidth, pageHeight, width: viewportWidth, height: viewportHeight } = metrics;
  if ([pageWidth, pageHeight, viewportWidth, viewportHeight].some((value) => value <= 0)) {
    throw new Error('Page and viewport dimensions must be greater than zero.');
  }

  const xOffsets = destinationOffsets(pageWidth, viewportWidth);
  const yOffsets = destinationOffsets(pageHeight, viewportHeight);
  const maxScrollX = Math.max(0, pageWidth - viewportWidth);
  const maxScrollY = Math.max(0, pageHeight - viewportHeight);
  const slices: FullPageSlice[] = [];

  for (const destinationY of yOffsets) {
    for (const destinationX of xOffsets) {
      const scrollX = Math.min(destinationX, maxScrollX);
      const scrollY = Math.min(destinationY, maxScrollY);
      const width = Math.min(viewportWidth, pageWidth - destinationX);
      const height = Math.min(viewportHeight, pageHeight - destinationY);

      slices.push({
        index: slices.length,
        scrollX,
        scrollY,
        source: {
          x: destinationX - scrollX,
          y: destinationY - scrollY,
          width,
          height,
        },
        destination: { x: destinationX, y: destinationY, width, height },
      });
    }
  }

  return slices;
}
