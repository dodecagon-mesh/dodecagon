import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AutoFocus,
  Input
} from '@dodecagon/ui';
import { CheckIcon } from '@heroicons/react/24/outline';
import { memo, useCallback, useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import type { TDialogBaseProps } from '../types';

type TTextInputDialogProps = TDialogBaseProps & {
  onCancel?: () => void;
  onConfirm?: (text: string | undefined) => void;
  title?: string;
  message?: string;
  label?: string;
  helper?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  allowEmpty?: boolean;
  isModalOpen: boolean;
  type?: 'text' | 'password';
  finalFocus?: React.RefObject<HTMLElement | null>;
};

const TextInputDialog = memo(
  ({
    isOpen,
    close,
    onCancel,
    onConfirm,
    title,
    message,
    label,
    helper,
    confirmLabel,
    cancelLabel,
    allowEmpty,
    type,
    finalFocus
  }: TTextInputDialogProps) => {
    const { t } = useTranslation('dialogs');
    const [value, setValue] = useState<string | undefined>(undefined);

    const onSubmit = useCallback(() => {
      onConfirm?.(value);
    }, [onConfirm, value]);

    const onCancelClick = useCallback(() => {
      onCancel?.();
      close();
    }, [onCancel, close]);

    const onOpenChange = useCallback<
      NonNullable<ComponentProps<typeof AlertDialog>['onOpenChange']>
    >(
      (open, eventDetails) => {
        if (!open && eventDetails.reason === 'escape-key') onCancelClick();
      },
      [onCancelClick]
    );

    const fieldLabel = label ?? t('textInputLabel');

    return (
      <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
        <AlertDialogContent
          finalFocus={finalFocus}
          className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0"
        >
          <AlertDialogHeader className="shrink-0 gap-1.5 px-6 pt-6 pb-5">
            <AlertDialogTitle className="text-[20px] leading-7 font-bold tracking-[-0.025em]">
              {title}
            </AlertDialogTitle>
            {message && (
              <AlertDialogDescription className="text-[13px] leading-[19px]">
                {message}
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>

          <div className="flex min-h-0 flex-col gap-5 overflow-y-auto p-6">
            <div className="flex flex-col gap-2">
              {fieldLabel && (
                <label
                  htmlFor="text-input-value"
                  className="text-xs leading-4 font-bold uppercase tracking-[0.07em] text-subtle-foreground"
                >
                  {fieldLabel}
                </label>
              )}
              <AutoFocus>
                <Input
                  id="text-input-value"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onEnter={onSubmit}
                  className="h-auto px-[15px] py-[15px] text-[15px] leading-[18px] md:text-[15px]"
                  type={type}
                  autoFocus
                />
              </AutoFocus>
            </div>

            {helper && (
              <p className="text-[13px] leading-4 text-muted-foreground">
                {helper}
              </p>
            )}
          </div>

          <AlertDialogFooter className="shrink-0 gap-2.5 bg-nav px-6 py-4">
            <AlertDialogCancel onClick={onCancelClick}>
              {cancelLabel ?? t('cancel')}
            </AlertDialogCancel>
            <AutoFocus>
              <AlertDialogAction
                onClick={onSubmit}
                disabled={!allowEmpty && !value}
              >
                <CheckIcon className="size-5" />
                {confirmLabel ?? t('confirm')}
              </AlertDialogAction>
            </AutoFocus>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }
);

export { TextInputDialog };
