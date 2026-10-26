// Renders the store backed hooks twice, with a state change none of them read
// in between, and prints what happened to the derived values. The test runs this
// in its own process: it needs the browser globals and the react dom client.
import { useIsAppLoading } from '@/features/app/hooks';
import { appSliceActions } from '@/features/app/slice';
import { useCategories } from '@/features/server/categories/hooks';
import {
  useChannelById,
  useChannels,
  useChannelsByCategoryId
} from '@/features/server/channels/hooks';
import { channelByIdSelector } from '@/features/server/channels/selectors';
import { useRoleById } from '@/features/server/roles/hooks';
import { serverInitialState } from '@/features/server/slice';
import { useFilteredUsers, useUserById } from '@/features/server/users/hooks';
import { createStore } from '@/features/store';
import { StoreProvider } from '@/features/store-context';
import { renderInDom } from '@/test-utils/dom-render';
import {
  ChannelType,
  UserStatus,
  type TCategory,
  type TChannel,
  type TJoinedPublicUser,
  type TJoinedRole
} from '@dodecagon/shared';

const CHANNEL_ID = 1;
const CATEGORY_ID = 1;
const USER_ID = 2;
const ROLE_ID = 1;

const buildChannel = (id: number, categoryId: number, position: number) =>
  ({
    id,
    categoryId,
    position,
    name: `channel-${id}`,
    type: ChannelType.TEXT,
    private: false
  }) as unknown as TChannel;

const buildCategory = (id: number, position: number) =>
  ({ id, name: `category-${id}`, position }) as unknown as TCategory;

const buildUser = (id: number, name: string, status: UserStatus) =>
  ({
    id,
    name,
    status,
    banned: false,
    roleIds: [ROLE_ID]
  }) as unknown as TJoinedPublicUser;

const buildRole = (id: number) =>
  ({ id, name: `role-${id}`, permissions: [] }) as unknown as TJoinedRole;

const store = createStore();

store.setState({
  server: {
    ...serverInitialState,
    ownUserId: 1,
    categories: [buildCategory(1, 0), buildCategory(2, 1)],
    channels: [
      buildChannel(1, 1, 0),
      buildChannel(2, 1, 1),
      buildChannel(3, 2, 0)
    ],
    users: [
      buildUser(1, 'alice', UserStatus.ONLINE),
      buildUser(USER_ID, 'bob', UserStatus.ONLINE)
    ],
    roles: [buildRole(ROLE_ID)]
  }
});

const renders: Array<Array<[string, unknown]>> = [];
let stableProbeRenders = 0;

// the app loading flag is the only thing the dispatch changes: every other
// value here belongs to the server slice, so a new reference means the hook
// rebuilt a value the state did not change
const Probe = () => {
  const appLoading = useIsAppLoading();
  const channels = useChannels();
  const channel = useChannelById(CHANNEL_ID);
  const categoryChannels = useChannelsByCategoryId(CATEGORY_ID);
  const categories = useCategories();
  const filteredUsers = useFilteredUsers();
  const user = useUserById(USER_ID);
  const role = useRoleById(ROLE_ID);

  renders.push([
    ['channels', channels],
    ['channel', channel],
    ['categoryChannels', categoryChannels],
    ['categories', categories],
    ['filteredUsers', filteredUsers],
    ['user', user],
    ['role', role]
  ]);

  return <span data-testid="app-loading">{String(appLoading)}</span>;
};

// reads nothing the dispatch changes, so react has to leave it alone
const StableProbe = () => {
  const channel = useChannelById(CHANNEL_ID);

  stableProbeRenders += 1;

  return <span data-testid="stable-channel">{channel?.name}</span>;
};

let recomputationsBefore = 0;

await renderInDom(
  <StoreProvider value={store}>
    <Probe />
    <StableProbe />
  </StoreProvider>,
  () => {
    recomputationsBefore = channelByIdSelector.recomputations();
    store.dispatch(appSliceActions.setAppLoading(false));
  }
);

const recomputationsAfter = channelByIdSelector.recomputations();

const identical = renders.every((entry, index) => {
  if (index === 0) return true;

  const previous = renders[index - 1];

  return entry.every(([, value], position) =>
    Object.is(value, previous[position][1])
  );
});

console.log(
  `__RESULT__${JSON.stringify({
    renders: renders.length,
    identical,
    stableProbeRenders,
    recomputationsBefore,
    recomputationsAfter
  })}`
);
