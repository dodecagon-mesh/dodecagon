// the desktop bridge flattens every console argument to text before it reaches
// renderer.log, so an object argument arrives as "[object Object]" and the
// reason a call failed is gone. values are described here first, where their
// fields and their errors survive.

const MAX_DEPTH = 3;
const MAX_ENTRIES = 20;
const MAX_STRING = 300;
const MAX_TEXT = 2000;

type TErrorLike = {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  cause?: unknown;
  data?: unknown;
};

const isErrorLike = (value: object): value is TErrorLike =>
  typeof (value as TErrorLike).message === 'string';

const className = (value: object): string => {
  const name = Object.getPrototypeOf(value)?.constructor?.name;

  return typeof name === 'string' && name.length > 0 ? name : 'Object';
};

const clip = (value: string): string =>
  value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;

// a tRPC failure carries its machine readable reason in data.code, a plain
// error carries it in code
const errorCode = (error: TErrorLike): string | undefined => {
  if (typeof error.code === 'string') return error.code;

  const data = error.data as { code?: unknown } | undefined;

  return typeof data?.code === 'string' ? data.code : undefined;
};

const describeObject = (
  value: object,
  depth: number,
  seen: WeakSet<object>
): unknown => {
  if (seen.has(value)) return '[Circular]';

  // a transport, a media stream or a react element would cost more than the
  // line is worth, and the depth limit keeps a deep graph cheap to print
  if (depth >= MAX_DEPTH) return `[${className(value)}]`;

  seen.add(value);

  try {
    if (value instanceof Error || isErrorLike(value)) {
      const error = value as TErrorLike;
      const code = errorCode(error);

      return {
        name:
          typeof error.name === 'string' && error.name.length > 0
            ? error.name
            : className(value),
        message:
          typeof error.message === 'string'
            ? clip(error.message)
            : String(error.message),
        ...(code ? { code } : {}),
        ...(error.cause === undefined
          ? {}
          : { cause: describeObject(error.cause as object, depth + 1, seen) })
      };
    }

    if (Array.isArray(value)) {
      return value
        .slice(0, MAX_ENTRIES)
        .map((item) => describe(item, depth + 1, seen));
    }

    return Object.fromEntries(
      Object.entries(value)
        .slice(0, MAX_ENTRIES)
        .map(([key, item]) => [key, describe(item, depth + 1, seen)])
    );
  } finally {
    // a value reached twice is reported once as itself and once as a
    // reference, the way a console shows it
    seen.delete(value);
  }
};

const describe = (
  value: unknown,
  depth: number,
  seen: WeakSet<object>
): unknown => {
  if (typeof value === 'string') return clip(value);
  if (value === null || value === undefined) return value;
  if (typeof value === 'object') return describeObject(value, depth, seen);
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`;
  }
  if (typeof value === 'symbol') return String(value);

  return value;
};

// one console argument becomes one line in renderer.log, so the text has to
// stay short enough to survive the bridge and to read after the fact
const toLogText = (value: unknown): string => {
  try {
    const described = describe(value, 0, new WeakSet());

    if (described === undefined) return 'undefined';
    if (typeof described === 'string') return clip(described);

    const text = JSON.stringify(described);

    if (typeof text !== 'string') return String(described);

    return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
  } catch {
    // a console call must never throw and hide the failure it reports
    return '[unserializable]';
  }
};

export { toLogText };
