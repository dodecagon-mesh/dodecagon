import { Dialog } from '@/components/dialogs/dialogs';
import { openOverlay } from '@/features/overlays/actions';
import { useCan } from '@/features/server/hooks';
import { Permission, TestId } from '@dodecagon/shared';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@dodecagon/ui';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

type TSidebarContextMenuProps = {
  children: React.ReactNode;
};

const SidebarContextMenu = memo(({ children }: TSidebarContextMenuProps) => {
  const { t } = useTranslation('sidebar');
  const can = useCan();

  const onAddCategoryClick = useCallback(() => {
    openOverlay({ kind: 'dialog', name: Dialog.CREATE_CATEGORY });
  }, []);

  if (!can(Permission.MANAGE_CATEGORIES)) {
    return <>{children}</>;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          data-testid={TestId.SIDEBAR_MENU_ADD_CATEGORY}
          onClick={onAddCategoryClick}
        >
          {t('addCategory')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

export { SidebarContextMenu };
