import { logDebug } from '@/helpers/browser-logger';
import { cleanup, getTRPCClient } from '@/lib/trpc';
import { type TPublicServerSettings } from '@dodecagon/shared';
import {
  isAuthenticationFailure,
  setPublicServerSettings,
  setServerUpdateState
} from './actions';
import { subscribeToCategories } from './categories/subscriptions';
import { subscribeToChannels } from './channels/subscriptions';
import { subscribeToEmojis } from './emojis/subscriptions';
import { subscribeToMessages } from './messages/subscriptions';
import { subscribeToPlugins } from './plugins/subscriptions';
import { subscribeToRoles } from './roles/subscriptions';
import { subscribeToUsers } from './users/subscriptions';
import { subscribeToVoice } from './voice/subscriptions';

const subscribeToServer = () => {
  const trpc = getTRPCClient();

  const onSettingsUpdateSub = trpc.others.onServerSettingsUpdate.subscribe(
    undefined,
    {
      onData: (settings: TPublicServerSettings) => {
        logDebug('[EVENTS] others.onServerSettingsUpdate', { settings });
        setPublicServerSettings(settings);
      },
      onError: (err) =>
        console.error('onSettingsUpdate subscription error:', err)
    }
  );

  const onUpdateStateSub = trpc.others.onServerUpdateState.subscribe(
    undefined,
    {
      onData: setServerUpdateState,
      onError: (error) => {
        if (isAuthenticationFailure(error)) {
          cleanup();
          return;
        }
        console.error('onServerUpdateState subscription error:', error);
      }
    }
  );

  return () => {
    onSettingsUpdateSub.unsubscribe();
    onUpdateStateSub.unsubscribe();
  };
};

const initSubscriptions = () => {
  const subscriptors = [
    subscribeToChannels,
    subscribeToServer,
    subscribeToEmojis,
    subscribeToRoles,
    subscribeToUsers,
    subscribeToMessages,
    subscribeToVoice,
    subscribeToCategories,
    subscribeToPlugins
  ];

  const unsubscribes = subscriptors.map((subscriptor) => subscriptor());

  return () => {
    unsubscribes.forEach((unsubscribe) => unsubscribe());
  };
};

export { initSubscriptions };
