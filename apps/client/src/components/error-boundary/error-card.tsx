import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  GithubIcon
} from '@dodecagon/ui';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const GITHUB_ISSUES_URL = 'https://github.com/dodecagon-mesh/dodecagon/issues';

type TErrorCardProps = {
  error: unknown;
  // a failure of a loader can be retried in place, a broken render cannot
  onRetry?: () => void;
};

const readError = (error: unknown) =>
  error instanceof Error
    ? { message: error.message, stack: error.stack }
    : { message: String(error), stack: undefined };

const ErrorCard = memo(({ error, onRetry }: TErrorCardProps) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const { message, stack } = readError(error);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setCopied(false);
    }, 3000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [copied]);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6 py-10">
      <Card className="relative z-10 w-full max-w-2xl border-border/70 bg-card/95 shadow-2xl backdrop-blur">
        <CardHeader className="space-y-4 text-center sm:text-left">
          <div className="space-y-2">
            <CardTitle className="text-2xl tracking-tight">
              {t('globalErrorTitle')}
            </CardTitle>
            <CardDescription className="max-w-xl text-sm leading-6 text-muted-foreground">
              {t('globalErrorDescription')}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row">
            {onRetry && (
              <Button className="sm:w-auto" onClick={onRetry}>
                <ArrowPathIcon className="h-4 w-4" />
                {t('retry')}
              </Button>
            )}

            <Button
              variant={onRetry ? 'outline' : 'default'}
              className="sm:w-auto"
              onClick={() => {
                window.location.reload();
              }}
            >
              <ArrowPathIcon className="h-4 w-4" />
              {t('reloadApp')}
            </Button>

            <Button asChild variant="outline" className="sm:w-auto">
              <a
                href={GITHUB_ISSUES_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                <GithubIcon className="h-4 w-4" />
                {t('reportIssueOnGithub')}
              </a>
            </Button>

            <Button
              variant="outline"
              className="sm:w-auto"
              onClick={() => {
                navigator.clipboard.writeText(
                  `${t('errorLabel')}: ${message}\n${t('stackLabel')}: ${stack}`
                );
                setCopied(true);
              }}
            >
              {copied ? t('copied') : t('copyDetails')}
            </Button>
          </div>

          <details className="rounded-xl border border-border/70 bg-background/60 p-4 text-sm">
            <summary className="cursor-pointer font-medium text-foreground">
              {t('errorDetails')}
            </summary>

            <div className="mt-4 space-y-3 text-xs text-muted-foreground">
              <div>
                <span className="font-medium text-foreground">
                  {t('errorLabel')}:
                </span>{' '}
                <span className="wrap-break-word">{message}</span>
              </div>

              {stack && (
                <div>
                  <span className="font-medium text-foreground">
                    {t('stackLabel')}:
                  </span>
                  <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-muted/50 p-3 text-[11px] leading-relaxed text-muted-foreground">
                    {stack}
                  </pre>
                </div>
              )}
            </div>
          </details>

          <div className="flex justify-center text-xs text-muted-foreground sm:justify-between">
            <span>v{VITE_APP_VERSION}</span>
            <a
              href={GITHUB_ISSUES_URL}
              target="_blank"
              className="hidden hover:text-foreground sm:inline"
            >
              {GITHUB_ISSUES_URL}
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
});

export { ErrorCard };
