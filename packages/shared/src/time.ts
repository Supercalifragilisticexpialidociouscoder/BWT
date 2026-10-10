import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';

/**
 * All instants are stored in UTC. Wall-clock values (form inputs, venue opening hours,
 * calendar grids) are interpreted in the institution's configured IANA timezone.
 */

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** Convert a `YYYY-MM-DDTHH:mm` wall-clock value in `tz` to a UTC Date. */
export function zonedInputToUtc(local: string, tz: string): Date {
  const m = LOCAL_INPUT.exec(local);
  if (!m) throw new Error(`Invalid local date-time: ${local}`);
  const [, y, mo, d, h, mi] = m;
  const zoned = new TZDate(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), 0, tz);
  return new Date(zoned.getTime());
}

/** Convert a UTC instant into a `YYYY-MM-DDTHH:mm` wall-clock value in `tz` (for datetime-local inputs). */
export function utcToZonedInput(date: Date | string, tz: string): string {
  return format(new TZDate(new Date(date).getTime(), tz), "yyyy-MM-dd'T'HH:mm");
}

export function inZone(date: Date | string | number, tz: string): TZDate {
  return new TZDate(new Date(date).getTime(), tz);
}

export function formatInZone(date: Date | string | number, tz: string, pattern: string): string {
  return format(inZone(date, tz), pattern);
}

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hours: number;
  minutes: number;
  weekday: number; // 0 = Sunday
  minutesOfDay: number;
}

export function zonedParts(date: Date | string | number, tz: string): ZonedParts {
  const z = inZone(date, tz);
  return {
    year: z.getFullYear(),
    month: z.getMonth() + 1,
    day: z.getDate(),
    hours: z.getHours(),
    minutes: z.getMinutes(),
    weekday: z.getDay(),
    minutesOfDay: z.getHours() * 60 + z.getMinutes(),
  };
}

/** Calendar-day key (YYYY-MM-DD) of an instant in `tz`. */
export function zonedDayKey(date: Date | string | number, tz: string): string {
  return formatInZone(date, tz, 'yyyy-MM-dd');
}

export function parseHHmm(value: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) throw new Error(`Invalid time: ${value}`);
  return Number(m[1]) * 60 + Number(m[2]);
}
