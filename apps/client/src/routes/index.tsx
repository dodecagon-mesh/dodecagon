import {
  getLocalStorageItem,
  getLocalStorageItemBool,
  getSessionStorageItem,
  LocalStorageKey,
  SessionStorageKey
} from '@/helpers/storage';
import { LoadingApp } from '@/screens/loading-app';
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    // the session of the browser lives in its storage, so the server cannot pick
    // the screen of the root: it renders the waiting shell and the browser goes
    // on from there. answering the root with the screen of the sign in showed
    // the form to everyone who already had a session, and the app replaced it a
    // moment later
    if (typeof window === 'undefined') return;

    const hasStoredSession =
      !!getSessionStorageItem(SessionStorageKey.TOKEN) ||
      (getLocalStorageItemBool(LocalStorageKey.AUTO_LOGIN) &&
        !!getLocalStorageItem(LocalStorageKey.AUTO_LOGIN_TOKEN));

    // the address of the server is the screen of the sign in, the app itself
    // lives under its own path
    throw redirect({ to: hasStoredSession ? '/app' : '/connect' });
  },
  // the waiting shell renders the same way on both sides, so the page hydrates
  // without a mismatch while the browser decides where the session belongs
  component: RootWaiting
});

function RootWaiting() {
  return <LoadingApp text="Loading" />;
}
