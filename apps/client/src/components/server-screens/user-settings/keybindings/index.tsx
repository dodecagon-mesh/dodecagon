import {
  beginShortcutRecording,
  captureShortcut,
  formatShortcut,
  type TShortcutId,
  type TShortcutValidationError
} from '@/components/hotkeys-controller/shortcuts';
import { SettingsSection } from '@/components/server-screens/settings-shell/section';
import {
  resetAllShortcutBindings,
  resetShortcutBinding,
  setShortcutBinding
} from '@/features/app/actions';
import { useShortcutBindings } from '@/features/app/hooks';
import { Button } from '@dodecagon/ui';
import { memo, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const Keybindings = memo(() => {
  const { t } = useTranslation(['keybindings', 'dialogs', 'sidebar', 'topbar']);
  const bindings = useShortcutBindings();
  const [recording, setRecording] = useState<TShortcutId | null>(null);
  const recordingRef = useRef<TShortcutId | null>(null);
  const releaseRecording = useRef<(() => void) | null>(null);
  const [error, setError] = useState<{
    id: TShortcutId;
    message: string;
  } | null>(null);
  const [status, setStatus] = useState('');
  const instructionsId = useId();
  const errorId = useId();
  const mac =
    typeof navigator !== 'undefined' && navigator.platform.includes('Mac');

  const actionLabel = (id: TShortcutId) => {
    const shortcut = bindings.find((item) => item.id === id);
    const label = shortcut ? t(shortcut.label) : '';
    return id === 'searchAlternative'
      ? t('alternative', { action: label })
      : label;
  };

  const stopRecording = () => {
    recordingRef.current = null;
    releaseRecording.current?.();
    releaseRecording.current = null;
    setRecording(null);
  };

  const showError = (id: TShortcutId, result: TShortcutValidationError) => {
    setError({
      id,
      message:
        result.type === 'duplicate'
          ? t('duplicate', { action: actionLabel(result.conflictingId) })
          : t(result.type)
    });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const id = recordingRef.current;
      if (!id) return;

      // Capture marks every recording event before the guard is released.
      const captured = captureShortcut(event);
      if (event.code === 'Tab') {
        stopRecording();
        setStatus(t('cancelled'));
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (event.code === 'Escape') {
        stopRecording();
        setStatus(t('cancelled'));
        return;
      }
      if ('ignored' in captured) return;
      if ('error' in captured) {
        setError({ id, message: t(captured.error) });
        return;
      }
      const result = setShortcutBinding(id, captured.binding);
      if (result) {
        showError(id, result);
        return;
      }
      setError(null);
      stopRecording();
      setStatus(
        t('saved', {
          action: actionLabel(id),
          shortcut: formatShortcut(captured.binding, mac)
        })
      );
    };
    const onBlur = () => {
      if (!recordingRef.current) return;
      stopRecording();
      setStatus(t('cancelled'));
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', onBlur);
    };
  });

  useEffect(() => () => releaseRecording.current?.(), []);

  return (
    <SettingsSection title={t('title')} description={t('scope')}>
      <p
        id={instructionsId}
        className="text-sm leading-relaxed text-muted-foreground"
      >
        {t('instructions')}
      </p>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {t('physicalKeys')}
      </p>
      <Button
        type="button"
        variant="secondary"
        className="h-auto min-h-10 max-w-full whitespace-normal"
        disabled={recording !== null}
        onClick={() => {
          resetAllShortcutBindings();
          setError(null);
          setStatus(t('allRestored'));
        }}
      >
        {t('resetAll')}
      </Button>
      <p role="status" className="text-sm text-muted-foreground">
        {recording ? t('recording') : status}
      </p>
      <dl className="space-y-5">
        {bindings.map((shortcut) => {
          const action = actionLabel(shortcut.id);
          const active = recording === shortcut.id;
          const rowError = error?.id === shortcut.id ? error.message : null;
          return (
            <div
              key={shortcut.id}
              className="min-w-0 rounded-md border border-line p-3"
            >
              <dt className="break-words text-sm font-semibold">{action}</dt>
              <dd className="mt-2 space-y-3">
                <kbd className="inline-block max-w-full break-words rounded border border-line bg-muted/30 px-2 py-1 text-sm">
                  {formatShortcut(shortcut.binding, mac) || t('unbound')}
                </kbd>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={active ? 'default' : 'secondary'}
                    size="sm"
                    className="h-auto min-h-8 max-w-full whitespace-normal"
                    aria-label={t(active ? 'cancelAction' : 'recordAction', {
                      action
                    })}
                    aria-describedby={`${instructionsId}${rowError ? ` ${errorId}` : ''}`}
                    aria-invalid={rowError ? true : undefined}
                    aria-pressed={active}
                    disabled={recording !== null && !active}
                    onBlur={() => {
                      if (recordingRef.current !== shortcut.id) return;
                      stopRecording();
                      setStatus(t('cancelled'));
                    }}
                    onClick={() => {
                      if (active) {
                        stopRecording();
                        setStatus(t('cancelled'));
                        return;
                      }
                      releaseRecording.current = beginShortcutRecording();
                      recordingRef.current = shortcut.id;
                      setRecording(shortcut.id);
                      setError(null);
                    }}
                  >
                    {t(active ? 'cancel' : 'record')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-auto min-h-8 max-w-full whitespace-normal"
                    aria-label={t('removeAction', { action })}
                    disabled={recording !== null || shortcut.binding === null}
                    onClick={() => {
                      const result = setShortcutBinding(shortcut.id, null);
                      if (result) {
                        showError(shortcut.id, result);
                        return;
                      }
                      setError(null);
                      setStatus(t('removed', { action }));
                    }}
                  >
                    {t('remove')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-auto min-h-8 max-w-full whitespace-normal"
                    aria-label={t('resetAction', { action })}
                    disabled={recording !== null}
                    onClick={() => {
                      const result = resetShortcutBinding(shortcut.id);
                      if (result) {
                        showError(shortcut.id, result);
                        return;
                      }
                      setError(null);
                      setStatus(t('restored', { action }));
                    }}
                  >
                    {t('reset')}
                  </Button>
                </div>
                {rowError && (
                  <p
                    id={errorId}
                    role="alert"
                    className="text-sm text-destructive"
                  >
                    {rowError}
                  </p>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </SettingsSection>
  );
});

export { Keybindings };
