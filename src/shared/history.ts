import { MAX_HISTORY_BYTES } from './constants';

export interface HistoryCandidate {
  id: string;
  createdAt: number;
  bytes: number;
}

export function historyIdsToDelete(
  captures: HistoryCandidate[],
  maximumCount: number,
  maximumBytes = MAX_HISTORY_BYTES,
): string[] {
  const newestFirst = [...captures].sort((a, b) => b.createdAt - a.createdAt);
  let retainedBytes = 0;
  let retainedCount = 0;
  const deletions: string[] = [];

  newestFirst.forEach((capture) => {
    if (retainedCount >= maximumCount || retainedBytes + capture.bytes > maximumBytes) {
      deletions.push(capture.id);
      return;
    }
    retainedBytes += capture.bytes;
    retainedCount += 1;
  });

  return deletions;
}
