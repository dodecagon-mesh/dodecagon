import type { ErrorComponentProps } from '@tanstack/react-router';
import { useRouter } from '@tanstack/react-router';
import { ErrorCard } from './error-card';

// an error of a loader or of a route component stays inside the app: the screen
// offers a retry of the loaders and a reload, instead of the bare screen of the
// router that leaves no way back
const RouteError = ({ error, reset }: ErrorComponentProps) => {
  const router = useRouter();

  return (
    <ErrorCard
      error={error}
      onRetry={() => {
        void router.invalidate().then(() => reset?.());
      }}
    />
  );
};

export { RouteError };
