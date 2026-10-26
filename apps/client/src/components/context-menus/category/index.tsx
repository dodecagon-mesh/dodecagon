import { ServerScreen } from '@/components/server-screens/screens';
import { openOverlay, requestConfirmation } from '@/features/overlays/actions';
import { useCategoryById } from '@/features/server/categories/hooks';
import { useCan } from '@/features/server/hooks';
import { getTRPCClient } from '@/lib/trpc';
import { Permission, TestId } from '@dodecagon/shared';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@dodecagon/ui';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

type TCategoryContextMenuProps = {
  children: React.ReactNode;
  categoryId: number;
};

const CategoryContextMenu = memo(
  ({ children, categoryId }: TCategoryContextMenuProps) => {
    const { t } = useTranslation('sidebar');
    const can = useCan();
    const category = useCategoryById(categoryId);

    const onDeleteClick = useCallback(async () => {
      const choice = await requestConfirmation({
        title: t('deleteCategoryTitle'),
        message: t('deleteCategoryMsg'),
        confirmLabel: t('deleteLabel'),
        cancelLabel: t('cancel', { ns: 'common' }),
        variant: 'danger'
      });

      if (!choice) return;

      const trpc = getTRPCClient();

      try {
        await trpc.categories.delete.mutate({ categoryId });
        toast.success(t('categoryDeleted'));
      } catch {
        toast.error(t('failedDeleteCategory'));
      }
    }, [categoryId, t]);

    const onEditClick = useCallback(() => {
      openOverlay({
        kind: 'serverScreen',
        name: ServerScreen.CATEGORY_SETTINGS,
        props: { categoryId }
      });
    }, [categoryId]);

    if (!can(Permission.MANAGE_CATEGORIES)) {
      return <>{children}</>;
    }

    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuLabel>{category?.name}</ContextMenuLabel>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onEditClick}>
            {t('editLabel')}
          </ContextMenuItem>
          <ContextMenuItem
            data-testid={TestId.CATEGORY_MENU_DELETE}
            variant="destructive"
            onClick={onDeleteClick}
          >
            {t('deleteLabel')}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }
);

export { CategoryContextMenu };
