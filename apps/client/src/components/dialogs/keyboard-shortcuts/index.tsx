import { formatShortcut } from '@/components/hotkeys-controller/shortcuts';
import { useShortcutBindings } from '@/features/app/hooks';
import { useOnEsc } from '@/hooks/use-on-esc';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@dodecagon/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TDialogBaseProps } from '../types';

const KeyboardShortcutsDialog = memo(({ isOpen, close }: TDialogBaseProps) => {
  const { t } = useTranslation(['dialogs', 'sidebar', 'topbar', 'keybindings']);
  const shortcuts = useShortcutBindings();
  useOnEsc(close);
  const isMac =
    typeof navigator !== 'undefined' && navigator.platform.includes('Mac');

  return (
    <Dialog open={isOpen}>
      <DialogContent
        close={close}
        onInteractOutside={close}
        className="max-h-[90dvh] overflow-y-auto overscroll-contain sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle>{t('keyboardShortcutsTitle')}</DialogTitle>
          <DialogDescription>{t('keybindings:scope')}</DialogDescription>
        </DialogHeader>
        <dl className="space-y-2">
          {shortcuts.map((shortcut) => {
            const key = formatShortcut(shortcut.binding, isMac);
            const label =
              shortcut.id === 'searchAlternative'
                ? t('keybindings:alternative', { action: t(shortcut.label) })
                : t(shortcut.label);

            return (
              <div
                key={shortcut.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/30 px-3 py-2"
              >
                <dt className="min-w-0 break-words text-sm">{label}</dt>
                <dd className="max-w-full break-words">
                  <kbd className="rounded border border-line bg-background px-2 py-1 text-xs font-medium">
                    {key || t('keybindings:unbound')}
                  </kbd>
                </dd>
              </div>
            );
          })}
        </dl>
      </DialogContent>
    </Dialog>
  );
});

export { KeyboardShortcutsDialog };
