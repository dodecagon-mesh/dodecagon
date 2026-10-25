import { store } from '@/features/store';
import { UserStatus, type TJoinedPublicUser } from '@dodecagon/shared';
import {
  reconcileUserMessages,
  reportMessageDatabaseError
} from '../messages/database';
import { serverSliceActions } from '../slice';
import { userByIdSelector } from './selectors';

export const addUser = (user: TJoinedPublicUser) => {
  store.dispatch(serverSliceActions.addUser(user));
};

export const updateUser = (
  userId: number,
  user: Partial<TJoinedPublicUser>
) => {
  store.dispatch(serverSliceActions.updateUser({ userId, user }));
};

export const wipeUser = (userId: number) => {
  store.dispatch(serverSliceActions.wipeUser({ userId }));
  reconcileUserMessages(store, userId).catch(reportMessageDatabaseError);
};

export const reassignUser = (userId: number, targetUser: number) => {
  store.dispatch(
    serverSliceActions.reassignUser({ userId, deletedUserId: targetUser })
  );
  reconcileUserMessages(store, userId, targetUser).catch(
    reportMessageDatabaseError
  );
};

export const handleUserJoin = (user: TJoinedPublicUser) => {
  const state = store.getState();
  const foundUser = userByIdSelector(state, user.id);

  if (foundUser) {
    updateUser(user.id, { ...user, status: UserStatus.ONLINE });
  } else {
    addUser(user);
  }
};
