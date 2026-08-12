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

  it('deletes records that push retained history past the byte cap', () => {
    expect(historyIdsToDelete(captures, 10, 45)).toEqual(['middle', 'old']);
  });
});
