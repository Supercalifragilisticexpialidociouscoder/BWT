import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from './api';

/** Copy server-side field errors onto react-hook-form fields; returns any message left over. */
export function applyServerErrors<T extends FieldValues>(err: unknown, setError: UseFormSetError<T>, known: string[]): string | null {
  if (!(err instanceof ApiError)) return err instanceof Error ? err.message : 'Something went wrong';
  const fields = err.fields;
  let unmatched = false;
  for (const [path, message] of Object.entries(fields)) {
    if (known.includes(path)) setError(path as Path<T>, { type: 'server', message });
    else unmatched = true;
  }
  if (!Object.keys(fields).length || unmatched) return err.message;
  return null;
}
