import { MessageRenderer } from '@/components/channel-view/text/renderer';
import { UserAvatar } from '@/components/user-avatar';
import { getMessageDatabase } from '@/features/server/messages/database';
import {
  discardMessageDelivery,
  getMessageDeliveryCollection,
  retryMessageDelivery,
  type TMessageDelivery
} from '@/features/server/messages/delivery';
import { serverIdSelector } from '@/features/server/selectors';
import { ownUserIdSelector } from '@/features/server/users/selectors';
import { useStoreSelector } from '@/features/store';
import { useStore } from '@/features/store-context';
import { getPlainTextFromHtml } from '@dodecagon/shared';
import { Button, Spinner } from '@dodecagon/ui';
import { eq, useLiveQuery } from '@tanstack/react-db';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

const DeliveryMessage = memo(({ entry }: { entry: TMessageDelivery }) => {
  const { t } = useTranslation('common');
  const currentStore = useStore();
  const retry = useCallback(() => {
    retryMessageDelivery(entry.scope, entry.id, currentStore);
  }, [entry.scope, entry.id, currentStore]);
  const discard = useCallback(() => {
    discardMessageDelivery(entry.scope, entry.id, currentStore);
  }, [entry.scope, entry.id, currentStore]);
  const failed = entry.status === 'failed';
  return (
    <div
      className="flex gap-3 py-2"
      data-message-delivery={entry.status}
      data-client-request-id={entry.input.clientRequestId}
      data-message-id={entry.message?.id}
    >
      <UserAvatar userId={entry.userId} className="size-8 shrink-0" />
      <div className="min-w-0 flex-1">
        {entry.status === 'confirmed' && entry.message ? (
          <MessageRenderer message={entry.message} />
        ) : (
          <>
            <div className="whitespace-pre-wrap break-words text-sm opacity-70">
              {getPlainTextFromHtml(entry.input.content)}
            </div>
            {entry.attachments.map((file) => (
              <div key={file.id} className="text-sm text-muted-foreground">
                {file.originalName}
              </div>
            ))}
            <div
              className="flex items-center gap-2 text-xs text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              {failed ? (
                <>
                  <span>{entry.error ?? t('failedSendMessage')}</span>
                  <Button variant="ghost" size="sm" onClick={retry}>
                    {t('retry')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={discard}>
                    {t('cancel')}
                  </Button>
                </>
              ) : (
                <>
                  <Spinner size="xs" />
                  <span>{t('sendingMessage')}</span>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
});

export const PendingMessages = memo(
  ({
    channelId,
    parentMessageId
  }: {
    channelId: number;
    parentMessageId?: number;
  }) => {
    const currentStore = useStore();
    // session identity changes replace the collection even when the conversation stays mounted
    useStoreSelector(serverIdSelector);
    useStoreSelector(ownUserIdSelector);
    const collection = getMessageDeliveryCollection(currentStore);
    const conversation = JSON.stringify([channelId, parentMessageId ?? null]);
    const { data: entries } = useLiveQuery({
      client: getMessageDatabase(currentStore),
      query: (q) =>
        q
          .from({ delivery: collection })
          .where(({ delivery }) => eq(delivery.conversation, conversation))
          .orderBy(({ delivery }) => delivery.sequence, 'asc')
    });
    return (
      <div data-pending-messages>
        {entries.map((entry) => (
          <DeliveryMessage key={entry.id} entry={entry} />
        ))}
      </div>
    );
  }
);
