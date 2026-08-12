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
  const deletions: string[] = [];

  newestFirst.forEach((capture, index) => {
    retainedBytes += capture.bytes;
    if (index >= maximumCount || retainedBytes > maximumBytes) deletions.push(capture.id);
  });

  return deletions;
}
