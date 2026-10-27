// a sentry dsn is public by design: the browser needs it to report an error
// before anyone signs in. every deployment therefore hands its own dsn to its
// own pages, and a binary must never carry the dsn of the project it was built
// in — a fork runs on servers that report to their own tracker.
//
// the browser writes to the client project; a deployment with a single project
// reuses the server dsn
const readPublicSentryDsn = (
  env: Record<string, string | undefined>
): string | null => {
  const dsn = env.SENTRY_CLIENT_DSN?.trim() || env.SENTRY_DSN?.trim();

  if (!dsn) return null;

  try {
    const url = new URL(dsn);

    return url.protocol === 'https:' || url.protocol === 'http:' ? dsn : null;
  } catch {
    return null;
  }
};

export { readPublicSentryDsn };
