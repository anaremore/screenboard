import { describe, expect, it } from 'vitest';
import { historyIdsToDelete } from '../../src/shared/history';

describe('historyIdsToDelete', () => {
  const captures = [
    { id: 'old', createdAt: 1, bytes: 10 },
    { id: 'middle', createdAt: 2, bytes: 20 },
    { id: 'new', createdAt: 3, bytes: 30 },
  ];

  it('deletes the oldest records beyond the count limit', () => {
    expect(historyIdsToDelete(captures, 2, 1_000)).toEqual(['old']);
  });

  it('retains older records that still fit after skipping a record over the byte cap', () => {
    expect(historyIdsToDelete(captures, 10, 45)).toEqual(['middle']);
  });

  it('does not discard older history when the newest record alone exceeds the cap', () => {
    const newest = { id: 'oversized', createdAt: 4, bytes: 1_001 };
    expect(historyIdsToDelete([...captures, newest], 2, 1_000)).toEqual(['oversized', 'old']);
  });

  it('does not charge discarded captures against the count or byte allowance', () => {
    expect(historyIdsToDelete(captures, 2, 25)).toEqual(['new', 'old']);
  });
});
