import { openOverlay } from '@/features/overlays/actions';
import {
  useCategories,
  useCategoryById
} from '@/features/server/categories/hooks';
import {
  useCan,
  useCategoryUnreadData,
  useHasVisibleChannelsInCategory
} from '@/features/server/hooks';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Permission, TestId } from '@dodecagon/shared';
import { IconButton } from '@dodecagon/ui';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  PlusIcon
} from '@heroicons/react/24/outline';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CategoryContextMenu } from '../context-menus/category';
import { Dialog } from '../dialogs/dialogs';
import { Protect } from '../protect';
import { UnreadCount } from '../unread-count';
import { Channels } from './channels';
import { categoryDndId } from './helpers';
import { useCategoryExpanded } from './hooks';
import { SidebarDnd } from './sidebar-dnd';
import { useCategoryAutoExpand } from './use-sidebar-dnd';

type TCategoryProps = {
  categoryId: number;
};

const Category = memo(({ categoryId }: TCategoryProps) => {
  const { t } = useTranslation('sidebar');
  const can = useCan();
  const hasVisibleChannelsInCategory =
    useHasVisibleChannelsInCategory(categoryId);
  const { expand, expanded, toggleExpanded } = useCategoryExpanded(categoryId);

  useCategoryAutoExpand(categoryId, expanded, expand);

  const category = useCategoryById(categoryId);
  const { unreadCount, hasUnreadMentions } = useCategoryUnreadData(categoryId);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: categoryDndId(categoryId),
    data: { type: 'category', categoryId }
  });

  const onCreateChannelClick = useCallback(() => {
    openOverlay({
      kind: 'dialog',
      name: Dialog.CREATE_CHANNEL,
      props: { categoryId }
    });
  }, [categoryId]);

  if (
    !category ||
    (!hasVisibleChannelsInCategory &&
      !can([Permission.MANAGE_CHANNELS, Permission.MANAGE_CATEGORIES]))
  ) {
    return null;
  }

  const ChevronIcon = expanded ? ChevronDownIcon : ChevronRightIcon;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform && { ...transform, x: 0 }),
        transition,
        opacity: isDragging ? 0.5 : 1
      }}
      className="mb-3"
      data-testid={TestId.CATEGORY_ITEM}
      data-category-id={category.id}
    >
      <div className="mb-0.5 flex h-7 w-full items-center px-2.5 text-[13px] font-semibold leading-[18px] tracking-[0.06em] text-muted-foreground uppercase">
        <div className="flex w-full items-center gap-1.5">
          <IconButton
            variant="ghost"
            size="xs"
            className="-ml-1.5"
            icon={ChevronIcon}
            onClick={toggleExpanded}
            title={expanded ? t('collapseCategory') : t('expandCategory')}
          />
          <CategoryContextMenu categoryId={category.id}>
            <span
              {...attributes}
              {...listeners}
              className="cursor-grab active:cursor-grabbing flex min-w-0 flex-1 items-center gap-2"
            >
              <span className="truncate">{category.name}</span>
              {!expanded && unreadCount > 0 && (
                <UnreadCount
                  count={unreadCount}
                  hasMention={hasUnreadMentions}
                  className="ml-0"
                />
              )}
            </span>
          </CategoryContextMenu>
        </div>

        <Protect permission={Permission.MANAGE_CHANNELS}>
          <IconButton
            data-testid={TestId.CATEGORY_ADD_CHANNEL}
            variant="ghost"
            size="sm"
            className="-mr-1.5 [&_svg]:size-[18px]"
            icon={PlusIcon}
            onClick={onCreateChannelClick}
            title={t('createChannel')}
          />
        </Protect>
      </div>

      {expanded && !isDragging && <Channels categoryId={category.id} />}
    </div>
  );
});

const Categories = memo(() => {
  const categories = useCategories();

  return (
    <div className="flex-1 overflow-y-auto px-2 py-3">
      <SidebarDnd>
        {categories.map((category) => (
          <Category key={category.id} categoryId={category.id} />
        ))}
      </SidebarDnd>
    </div>
  );
});

export { Categories };
