import { ErrorBoundary as BaseErrorBoundary } from '@/components/error-boundary';
import { captureError } from '@/helpers/sentry';
import { memo, type ReactNode } from 'react';
import { ErrorCard } from './error-card';

type TGlobalErrorBoundaryProps = {
  children: ReactNode;
};

const GlobalErrorBoundary = memo(({ children }: TGlobalErrorBoundaryProps) => {
  return (
    <BaseErrorBoundary
      fallback={(error) => <ErrorCard error={error} />}
      onError={(error) => captureError(error, { area: 'react' })}
    >
      {children}
    </BaseErrorBoundary>
  );
});

export { GlobalErrorBoundary };
