import type { ApiErrorBody } from '@campusflow/shared';

/** An error returned by the API, or a network failure (status 0). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  get isNetwork() {
    return this.status === 0;
  }
  /** Per-field validation messages keyed by dotted path. */
  get fields(): Record<string, string> {
    const d = this.details as { fields?: Record<string, string> } | undefined;
    return d?.fields ?? {};
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
  /** Statuses whose JSON body should be returned instead of thrown (e.g. check-in outcomes). */
  acceptStatuses?: number[];
}

export function buildUrl(path: string, query?: Query): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return `/api${path}${s ? `?${s}` : ''}`;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      credentials: 'same-origin',
      signal: opts.signal,
      headers: {
        // Required by the API's CSRF guard on state-changing requests.
        'X-Requested-With': 'campusflow',
        Accept: 'application/json',
        ...(opts.body && !isForm ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body ? (isForm ? (opts.body as FormData) : JSON.stringify(opts.body)) : undefined,
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new ApiError(0, 'network', 'Can’t reach CAMPUSFLOW. Check your connection and try again.');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (res.ok || opts.acceptStatuses?.includes(res.status)) return data as T;
  const body = data as ApiErrorBody | undefined;
  if (res.status >= 500 || !body?.error) {
    throw new ApiError(res.status, body?.error?.code ?? 'server', body?.error?.message ?? 'The server had a problem. Try again shortly.');
  }
  throw new ApiError(res.status, body.error.code, body.error.message, body.error.details);
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
