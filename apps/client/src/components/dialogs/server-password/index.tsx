import { openDialog } from '@/features/dialogs/actions';
import { isAuthenticationFailure, joinServer } from '@/features/server/actions';
import { useForm } from '@/hooks/use-form';
import * as trpc from '@/lib/trpc';
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
import { ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../dialogs';
import type { TDialogBaseProps } from '../types';

type TServerPasswordDialogProps = TDialogBaseProps & {
  handshakeHash: string;
};

const ServerPasswordDialog = memo(
  ({ isOpen, close, handshakeHash }: TServerPasswordDialogProps) => {
    const { t } = useTranslation('dialogs');
    const { r, values, setTrpcErrors, errors } = useForm({
      password: ''
    });
    const [loading, setLoading] = useState(false);

    const onSubmit = useCallback(async () => {
      try {
        setLoading(true);
        const { showWelcomeDialog } = await joinServer(
          handshakeHash,
          values.password
        );

        close();

        if (showWelcomeDialog) {
          setTimeout(() => {
            openDialog(Dialog.WELCOME_PROFILE_SETUP);
          }, 175);
        }
      } catch (error) {
        if (isAuthenticationFailure(error)) {
          trpc.cleanup?.();
          close();
          return;
        }
        setTrpcErrors(error);
      } finally {
        setLoading(false);
      }
    }, [handshakeHash, values.password, close, setTrpcErrors]);

    const onCancel = useCallback(() => {
      // the namespace import keeps the dialog loadable when a test run mocks
      // the trpc module without the cleanup export
      trpc.cleanup?.({ invalidateCredentials: false });
      close();
    }, [close]);

    return (
      <AlertDialog open={isOpen}>
        <AlertDialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0">
          <AlertDialogHeader className="shrink-0 gap-1.5 px-6 pt-6 pb-5">
            <AlertDialogTitle className="text-[20px] leading-7 font-bold tracking-[-0.025em]">
              {t('serverPasswordTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] leading-[19px]">
              {t('serverPasswordDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex min-h-0 flex-col gap-5 overflow-y-auto p-6">
            <p className="text-[13px] leading-4 text-muted-foreground">
              {t('serverPasswordHint')}
            </p>

            <div className="flex flex-col gap-2">
              <label
                htmlFor="server-password"
                className="text-xs leading-4 font-bold uppercase tracking-[0.07em] text-subtle-foreground"
              >
                {t('serverPasswordLabel')}
              </label>
              <AutoFocus>
                <Input
                  id="server-password"
                  {...r('password')}
                  className="h-auto px-[15px] py-[15px] text-[15px] leading-[18px] md:text-[15px]"
                  type="password"
                  error={errors._general}
                />
              </AutoFocus>
            </div>
          </div>

          <AlertDialogFooter className="shrink-0 gap-2.5 bg-nav px-6 py-4">
            <AlertDialogCancel onClick={onCancel}>
              {t('cancel')}
            </AlertDialogCancel>
            <AutoFocus>
              <AlertDialogAction
                onClick={onSubmit}
                disabled={!values.password || loading}
              >
                <ArrowRightOnRectangleIcon className="size-5" />
                {t('serverPasswordBtn')}
              </AlertDialogAction>
            </AutoFocus>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }
);

export { ServerPasswordDialog };
