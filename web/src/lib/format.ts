import { formatInZone, formatMoney, LABELS, type FeeDTO } from '@campusflow/shared';
import { useInstitution } from './institution';

export function useTz(): string {
  return useInstitution()?.timezone ?? 'Asia/Kolkata';
}

/** Formatting bound to the institution's timezone — never the viewer's browser zone. */
export function useFormat() {
  const tz = useTz();
  const f = (d: string | Date, p: string) => formatInZone(d, tz, p);
  return {
    tz,
    f,
    date: (d: string | Date) => f(d, 'EEE d MMM yyyy'),
    shortDate: (d: string | Date) => f(d, 'd MMM'),
    dayNum: (d: string | Date) => f(d, 'd'),
    month: (d: string | Date) => f(d, 'MMM'),
    weekday: (d: string | Date) => f(d, 'EEE'),
    time: (d: string | Date) => f(d, 'HH:mm'),
    dateTime: (d: string | Date) => f(d, 'EEE d MMM, HH:mm'),
    range(start: string | Date, end: string | Date) {
      const sameDay = f(start, 'yyyy-MM-dd') === f(end, 'yyyy-MM-dd');
      return sameDay ? `${f(start, 'EEE d MMM')} · ${f(start, 'HH:mm')}–${f(end, 'HH:mm')}` : `${f(start, 'd MMM, HH:mm')} → ${f(end, 'd MMM, HH:mm')}`;
    },
  };
}

export function relativeTime(d: string | Date, now = Date.now()): string {
  const diff = new Date(d).getTime() - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 60_000) return diff < 0 ? 'just now' : 'in under a minute';
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  if (abs < 30 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), 'day');
  return rtf.format(Math.round(diff / (30 * 86_400_000)), 'month');
}

export function feeLabel(fee: FeeDTO, mode: 'individual' | 'team'): string {
  if (fee.amount === 0) return 'Free';
  const per = fee.basis === 'per_participant' ? ' / person' : mode === 'team' ? ' / team' : '';
  return `${formatMoney(fee.amount, fee.currency)}${per}`;
}

export function formatLabel(mode: 'individual' | 'team', teamSize: { min: number; max: number }): string {
  if (mode === 'individual') return 'Individual';
  return teamSize.min === teamSize.max ? `Teams of ${teamSize.max}` : `Teams of ${teamSize.min}–${teamSize.max}`;
}

export function pct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

export const compact = (n: number) => new Intl.NumberFormat('en-IN', { notation: n >= 10_000 ? 'compact' : 'standard' }).format(n);

export { formatMoney, LABELS };
