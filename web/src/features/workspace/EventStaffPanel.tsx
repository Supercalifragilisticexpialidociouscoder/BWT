import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash } from 'lucide-react';
import { LABELS, type AuditEntryDTO, type EventDetailDTO, type StaffRole, type UserDTO, type Page } from '@campusflow/shared';
import { api, errorMessage } from '../../lib/api';
import { useFormat, relativeTime } from '../../lib/format';
import { Button } from '../../components/ui/Button';
import { Field, FormAlert, Input, Select } from '../../components/ui/Form';
import { EmptyState, LoadingBlock } from '../../components/ui/Feedback';
import { useToast } from '../../components/ui/Toast';

export function StaffPanel({ event: e }: { event: EventDetailDTO }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [rows, setRows] = useState<{ email: string; name: string; role: StaffRole }[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('checkin');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setRows((e.staff ?? []).map((s) => ({ email: s.user.email, name: s.user.name, role: s.role }))), [e.staff]);
  const lookup = useQuery({
    queryKey: ['users', email],
    queryFn: () => api<Page<UserDTO>>('/users', { query: { q: email } }),
    enabled: email.trim().length >= 3,
    staleTime: 30_000,
  });
  const save = useMutation({
    mutationFn: () => api<EventDetailDTO>(`/events/${e.id}/staff`, { method: 'PUT', body: { staff: rows.map(({ email, role }) => ({ email, role })) } }),
    onSuccess: (saved) => {
      qc.setQueryData(['event', e.id], saved);
      setError(null);
      toast({ tone: 'ok', title: 'Staff updated' });
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const dirty = JSON.stringify(rows.map((r) => [r.email, r.role])) !== JSON.stringify((e.staff ?? []).map((s) => [s.user.email, s.role]));
  const add = (addEmail: string, name = '') => {
    const clean = addEmail.trim().toLowerCase();
    if (!clean || rows.some((r) => r.email === clean)) return;
    setRows((r) => [...r, { email: clean, name, role }]);
    setEmail('');
  };

  return (
    <div className="mt-8 max-w-3xl space-y-8">
      <p className="text-sm text-paper-2">
        <strong className="font-medium text-paper">Event managers</strong> can edit the event, verify payments and correct attendance. <strong className="font-medium text-paper">Check-in volunteers</strong> can only scan tickets and see the live dashboard for this event. Members of {e.organization.name} with organizer access manage it automatically.
      </p>
      <ul className="divide-y divide-line rounded-[var(--radius-md)] border border-line">
        {rows.length === 0 && <li className="px-4 py-5 text-sm text-paper-3">No additional staff.</li>}
        {rows.map((r, i) => (
          <li key={r.email} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-paper">{r.name || r.email}</p>
              {r.name && <p className="text-xs text-paper-3">{r.email}</p>}
            </div>
            <div className="flex items-center gap-2">
              <Select aria-label={`Role for ${r.email}`} className="!w-auto !py-1.5 !text-[13px]" value={r.role} onChange={(ev) => setRows((all) => all.map((x, j) => (j === i ? { ...x, role: ev.target.value as StaffRole } : x)))}>
                <option value="checkin">{LABELS.staffRole.checkin}</option>
                <option value="manager">{LABELS.staffRole.manager}</option>
              </Select>
              <Button size="sm" variant="ghost" aria-label={`Remove ${r.email}`} onClick={() => setRows((all) => all.filter((_, j) => j !== i))} icon={<Trash className="size-3.5" />} />
            </div>
          </li>
        ))}
      </ul>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <Field label="Add by email" hint="They need a CAMPUSFLOW account.">
          {({ id }) => <Input id={id} type="email" value={email} onChange={(ev) => setEmail(ev.target.value)} onKeyDown={(ev) => ev.key === 'Enter' && (ev.preventDefault(), add(email))} list="staff-suggestions" />}
        </Field>
        <datalist id="staff-suggestions">
          {(lookup.data?.items ?? []).map((u) => (
            <option key={u.id} value={u.email}>
              {u.name}
            </option>
          ))}
        </datalist>
        <Select aria-label="Role" className="sm:!w-auto" value={role} onChange={(ev) => setRole(ev.target.value as StaffRole)}>
          <option value="checkin">Check-in volunteer</option>
          <option value="manager">Event manager</option>
        </Select>
        <Button onClick={() => add(email, lookup.data?.items.find((u) => u.email === email.trim().toLowerCase())?.name)} icon={<Plus className="size-4" />}>
          Add
        </Button>
      </div>
      <FormAlert>{error}</FormAlert>
      <div className="flex gap-2">
        <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
          Save staff list
        </Button>
        {dirty && (
          <Button variant="ghost" onClick={() => setRows((e.staff ?? []).map((s) => ({ email: s.user.email, name: s.user.name, role: s.role })))}>
            Discard
          </Button>
        )}
      </div>
    </div>
  );
}

export function ActivityPanel({ event: e }: { event: EventDetailDTO }) {
  const fmt = useFormat();
  const q = useQuery({ queryKey: ['audit', e.id], queryFn: () => api<AuditEntryDTO[]>(`/events/${e.id}/audit`) });
  if (q.isPending) return <div className="mt-8"><LoadingBlock /></div>;
  if (!q.data?.length) return <div className="mt-8"><EmptyState title="No activity yet" /></div>;
  return (
    <ol className="mt-8 max-w-3xl divide-y divide-line border-y border-line">
      {q.data.map((a) => (
        <li key={a.id} className="grid gap-1 py-3 sm:grid-cols-[150px_1fr]">
          <time dateTime={a.at} className="tnum text-xs text-paper-3" title={fmt.dateTime(a.at)}>
            {relativeTime(a.at)}
          </time>
          <div>
            <p className="text-sm text-paper">{a.summary}</p>
            <p className="text-xs text-paper-3">
              {a.actor?.name ?? 'System'} · <span className="font-mono">{a.action}</span>
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
