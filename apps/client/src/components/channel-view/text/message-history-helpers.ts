import type { TJoinedMessage } from '@dodecagon/shared';
import { isSameDay } from 'date-fns';

export type TMessageHistoryRow = {
  message: TJoinedMessage;
  group: TJoinedMessage[];
  startsGroup: boolean;
  endsGroup: boolean;
  startsDay: boolean;
  previous?: TJoinedMessage;
  next?: TJoinedMessage;
};

const sharesGroup = (previous: TJoinedMessage, next: TJoinedMessage) => {
  if (previous.replyToMessageId || next.replyToMessageId) return false;
  if (previous.pluginId !== next.pluginId) return false;
  if (!next.pluginId && previous.userId !== next.userId) return false;

  return (
    Math.abs(next.createdAt - previous.createdAt) < 60_000 &&
    isSameDay(new Date(previous.createdAt), new Date(next.createdAt))
  );
};

export const buildMessageRows = (
  messages: TJoinedMessage[],
  previousRows: TMessageHistoryRow[] = []
): TMessageHistoryRow[] => {
  const previousById = new Map(
    previousRows.map((row) => [row.message.id, row])
  );

  return messages.map((message, index) => {
    const previous = messages[index - 1];
    const next = messages[index + 1];
    const cached = previousById.get(message.id);

    if (
      cached?.message === message &&
      cached.previous === previous &&
      cached.next === next
    ) {
      return cached;
    }

    const startsGroup = !previous || !sharesGroup(previous, message);
    const endsGroup = !next || !sharesGroup(message, next);
    const startsDay =
      !previous ||
      !isSameDay(new Date(previous.createdAt), new Date(message.createdAt));

    return {
      message,
      group: [message],
      startsGroup,
      endsGroup,
      startsDay,
      previous,
      next
    };
  });
};
