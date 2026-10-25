import type { TJoinedMessage } from '@dodecagon/shared';
import { describe, expect, test } from 'bun:test';
import { buildMessageRows } from '../message-history-helpers';

const message = (
  id: number,
  overrides: Partial<TJoinedMessage> = {}
): TJoinedMessage => ({
  id,
  channelId: 1,
  content: `Message ${id}`,
  clientRequestId: null,
  userId: 1,
  pluginId: null,
  parentMessageId: null,
  replyToMessageId: null,
  editable: true,
  metadata: null,
  createdAt: Date.UTC(2026, 9, 20, 12, 0, id),
  updatedAt: null,
  pinned: false,
  pinnedAt: null,
  pinnedBy: null,
  editedAt: null,
  editedBy: null,
  files: [],
  reactions: [],
  ...overrides
});

describe('message history rows', () => {
  test('a long author group still has one virtual row per message', () => {
    const messages = Array.from({ length: 5000 }, (_, index) =>
      message(index + 1, { createdAt: 1000 + index })
    );
    const rows = buildMessageRows(messages);

    expect(rows).toHaveLength(5000);
    expect(rows[0].startsGroup).toBe(true);
    expect(rows[1].startsGroup).toBe(false);
    expect(rows[4999].endsGroup).toBe(true);
    expect(rows.filter((row) => row.startsGroup)).toHaveLength(1);
    expect(rows.filter((row) => row.startsDay)).toHaveLength(1);
  });

  test('reply context, author, one minute and day boundaries retain their headers', () => {
    const rows = buildMessageRows([
      message(1),
      message(2),
      message(3, { replyToMessageId: 1 }),
      message(4),
      message(5, { userId: 2 }),
      message(6, { userId: 2, createdAt: Date.UTC(2026, 9, 20, 12, 2) }),
      message(7, { userId: 2, createdAt: Date.UTC(2026, 9, 21, 12) })
    ]);

    expect(rows.map((row) => row.startsGroup)).toEqual([
      true,
      false,
      true,
      true,
      true,
      true,
      true
    ]);
    expect(rows.map((row) => row.startsDay)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      true
    ]);
  });

  test('different plugins and user authors never share a header', () => {
    const rows = buildMessageRows([
      message(1, { pluginId: 'one', userId: null }),
      message(2, { pluginId: 'two', userId: null }),
      message(3, { pluginId: 'two', userId: null }),
      message(4, { userId: null })
    ]);

    expect(rows.map((row) => row.startsGroup)).toEqual([
      true,
      true,
      false,
      true
    ]);
  });

  test('append reuses unchanged row identities and updates only the old group tail', () => {
    const messages = [message(1), message(2), message(3)];
    const before = buildMessageRows(messages);
    const after = buildMessageRows([...messages, message(4)], before);

    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[2]).not.toBe(before[2]);
    expect(after[2].endsGroup).toBe(false);
    expect(after[3].endsGroup).toBe(true);
  });

  test('prepend recomputes the former first message header without replacing other rows', () => {
    const messages = [message(2), message(3), message(4)];
    const before = buildMessageRows(messages);
    const after = buildMessageRows([message(1), ...messages], before);

    expect(after[1].startsGroup).toBe(false);
    expect(after[1].startsDay).toBe(false);
    expect(after[2]).toBe(before[1]);
    expect(after[3]).toBe(before[2]);
  });
});
