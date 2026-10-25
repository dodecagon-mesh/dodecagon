import { useShortcutBindings } from '@/features/app/hooks';
import { useTranslation } from 'react-i18next';
import { formatShortcut, type TShortcutId } from './shortcuts';

export const useShortcutHint = (action: TShortcutId, label: string) => {
  const { t } = useTranslation('keybindings');
  const bindings = useShortcutBindings();
  const mac =
    typeof navigator !== 'undefined' && navigator.platform.includes('Mac');
  const shortcut = bindings
    .filter((binding) => binding.action === action && binding.binding !== null)
    .map((binding) => formatShortcut(binding.binding, mac))
    .join(' / ');

  return shortcut ? t('withShortcut', { action: label, shortcut }) : label;
};
