import { beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  records,
  renderDialog,
  resetRecords,
  trpcModule
} from '../../text-input/__tests__/dialog-harness';

mock.module('@/lib/trpc', trpcModule);

mock.module('@/features/server/actions', () => ({
  isAuthenticationFailure: () => false,
  joinServer: async (handshakeHash: string, password: string) => {
    records.trpc.joinServerCalls.push({ handshakeHash, password });

    return { showWelcomeDialog: false };
  }
}));

mock.module('@/features/dialogs/actions', () => ({
  openDialog: (dialog: unknown) => {
    records.trpc.openDialogCalls.push(dialog);
  }
}));

const { ServerPasswordDialog } = await import('../index');

describe('ServerPasswordDialog', () => {
  beforeEach(() => {
    resetRecords();
  });

  test('keeps the password field masked', () => {
    renderDialog(
      <ServerPasswordDialog
        isOpen
        close={() => {}}
        handshakeHash="handshake-hash"
      />
    );

    expect(records.inputs).toHaveLength(1);
    expect(records.inputs[0].type).toBe('password');
  });

  test('blocks the unlock action while the password is empty', () => {
    renderDialog(
      <ServerPasswordDialog
        isOpen
        close={() => {}}
        handshakeHash="handshake-hash"
      />
    );

    expect(records.actions).toHaveLength(1);
    expect(records.actions[0].disabled).toBe(true);
  });
});
