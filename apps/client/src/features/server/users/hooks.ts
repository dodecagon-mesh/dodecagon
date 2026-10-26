import { useStoreSelector, type IRootState } from '@/features/store';
import {
  filteredUsersSelector,
  isOwnUserSelector,
  ownUserHasRoleSelector,
  ownUserIdSelector,
  ownUserPasswordSetSelector,
  ownUserRoleIdsSelector,
  ownUserSelector,
  userByIdSelector,
  usernamesSelector,
  usersSelector,
  userStatusSelector
} from './selectors';

export const useUsers = () => useStoreSelector(usersSelector);

export const useOwnUserId = () => useStoreSelector(ownUserIdSelector);

export const useOwnUserPasswordSet = () =>
  useStoreSelector(ownUserPasswordSetSelector);

export const useIsOwnUser = (userId: number | null) =>
  useStoreSelector((state: IRootState) =>
    userId !== null ? isOwnUserSelector(state, userId) : false
  );

export const useUserById = (userId: number | null) =>
  useStoreSelector((state: IRootState) =>
    userId !== null ? userByIdSelector(state, userId) : undefined
  );

export const useOwnPublicUser = () => useStoreSelector(ownUserSelector);

export const useUserStatus = (userId: number) =>
  useStoreSelector((state: IRootState) => userStatusSelector(state, userId));

export const useUsernames = () => useStoreSelector(usernamesSelector);

export const useFilteredUsers = () => useStoreSelector(filteredUsersSelector);

export const useOwnUserRoleIds = () => useStoreSelector(ownUserRoleIdsSelector);

export const useOwnUserHasRole = (roleId: number) =>
  useStoreSelector((state: IRootState) =>
    ownUserHasRoleSelector(state, roleId)
  );
