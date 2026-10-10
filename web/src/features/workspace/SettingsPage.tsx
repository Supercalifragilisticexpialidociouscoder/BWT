import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Trash } from 'lucide-react';
import { LABELS, ORGANIZATION_KINDS, USER_ROLES, type InstitutionDTO, type OrganizationDTO, type OrganizationKind, type Page, type UserDTO, type UserRole } from '@campusflow/shared';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useInstitutionRequired } from '../../lib/institution';
import { Button } from '../../components/ui/Button';
import { Checkbox, Field, FormAlert, Input, Select, Textarea } from '../../components/ui/Form';
import { Dialog } from '../../components/ui/Dialog';
import { EmptyState, LoadingBlock, PageHeader } from '../../components/ui/Feedback';
import { Tabs } from '../../components/ui/Tabs';
import { useToast } from '../../components/ui/Toast';

type Tab = 'institution' | 'organizations' | 'people';

export function SettingsPage() {
  const { access } = useSession();
  const [tab, setTab] = useState<Tab>('institution');
  if (!access.isAdmin) return <EmptyState title="Administrators only" body="Institution settings, organizations and roles are managed by platform administrators." />;
  return (
    <div className="space-y-6">
      <PageHeader kicker="Campus" title="Settings" description="Configuration that every event, form and report on this deployment uses." />
      <Tabs label="Settings sections" value={tab} onChange={setTab} items={[{ value: 'institution', label: 'Institution' }, { value: 'organizations', label: 'Organizations' }, { value: 'people', label: 'People & roles' }]} />
      {tab === 'institution' && <InstitutionForm />}
      {tab === 'organizations' && <Organizations />}
      {tab === 'people' && <People />}
    </div>
  );
}

function InstitutionForm() {
  const inst = useInstitutionRequired();
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState(() => structuredClone(inst));
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => setV(structuredClone(inst)), [inst]);
  const save = useMutation({
    mutationFn: () => api<InstitutionDTO>('/institution', { method: 'PUT', body: { name: v.name, shortName: v.shortName, timezone: v.timezone, departments: v.departments, categories: v.categories, defaults: v.defaults, requirements: v.requirements, branding: v.branding } }),
    onSuccess: (saved) => {
      qc.setQueryData(['institution'], saved);
      setErrors({});
      toast({ tone: 'ok', title: 'Settings saved' });
    },
    onError: (err) => setErrors(err instanceof ApiError ? { ...err.fields, _: err.message } : { _: errorMessage(err) }),
  });
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [v.timezone];

  return (
    <form className="max-w-4xl space-y-10 pb-10" onSubmit={(e) => (e.preventDefault(), save.mutate())} noValidate>
      <section className="grid gap-5 sm:grid-cols-2">
        <Field label="Institution name" error={errors.name}>{({ id }) => <Input id={id} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
        <Field label="Short name" error={errors.shortName}>{({ id }) => <Input id={id} value={v.shortName} onChange={(e) => setV({ ...v, shortName: e.target.value })} />}</Field>
        <Field label="Timezone" hint="All event times, opening hours and reports use this zone." error={errors.timezone}>
          {({ id }) => (
            <Select id={id} value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Tagline" error={errors['branding.tagline']}>{({ id }) => <Input id={id} value={v.branding.tagline} onChange={(e) => setV({ ...v, branding: { ...v.branding, tagline: e.target.value } })} />}</Field>
      </section>

      <section>
        <h2 className="display-sm mb-4">Registration defaults</h2>
        <div className="grid gap-5 sm:grid-cols-4">
          <Field label="Min team size" error={errors['defaults.teamSizeMin']}>{({ id }) => <Input id={id} type="number" min={1} value={v.defaults.teamSizeMin} onChange={(e) => setV({ ...v, defaults: { ...v.defaults, teamSizeMin: Number(e.target.value) } })} />}</Field>
          <Field label="Max team size" error={errors['defaults.teamSizeMax']}>{({ id }) => <Input id={id} type="number" min={1} value={v.defaults.teamSizeMax} onChange={(e) => setV({ ...v, defaults: { ...v.defaults, teamSizeMax: Number(e.target.value) } })} />}</Field>
          <Field label="Currency">{({ id }) => <Input id={id} value={v.defaults.currency} maxLength={3} onChange={(e) => setV({ ...v, defaults: { ...v.defaults, currency: e.target.value.toUpperCase() } })} />}</Field>
          <Field label="Check-in opens (min before)">{({ id }) => <Input id={id} type="number" min={0} value={v.defaults.checkInOpensMinutesBefore} onChange={(e) => setV({ ...v, defaults: { ...v.defaults, checkInOpensMinutesBefore: Number(e.target.value) } })} />}</Field>
        </div>
        <div className="mt-5 space-y-2">
          <p className="text-[13px] font-medium text-paper-2">Participants must provide</p>
          {(['rollNumber', 'department', 'phone'] as const).map((k) => (
            <Checkbox key={k} label={{ rollNumber: 'Roll number', department: 'Department', phone: 'Phone number' }[k]} checked={v.requirements[k]} onChange={(e) => setV({ ...v, requirements: { ...v.requirements, [k]: e.target.checked } })} />
          ))}
        </div>
      </section>

      <ListEditor
        title="Departments"
        error={errors.departments}
        rows={v.departments.map((d) => [d.code, d.name])}
        labels={['Code', 'Name']}
        onChange={(rows) => setV({ ...v, departments: rows.map(([code, name]) => ({ code: code!, name: name! })) })}
      />
      <ListEditor
        title="Event categories"
        error={errors.categories}
        rows={v.categories.map((c) => [c.slug, c.name])}
        labels={['Slug', 'Name']}
        hint="Categories used by existing events cannot be removed."
        onChange={(rows) => setV({ ...v, categories: rows.map(([slug, name]) => ({ slug: slug!, name: name! })) })}
      />
      {errors._ && <FormAlert>{errors._}</FormAlert>}
      <Button type="submit" variant="primary" loading={save.isPending}>
        Save settings
      </Button>
    </form>
  );
}

function ListEditor({ title, rows, labels, onChange, hint, error }: { title: string; rows: string[][]; labels: [string, string]; onChange: (rows: string[][]) => void; hint?: string; error?: string }) {
  return (
    <section>
      <h2 className="display-sm">{title}</h2>
      {hint && <p className="mt-1 text-xs text-paper-3">{hint}</p>}
      <ul className="mt-4 space-y-2">
        {rows.map((r, i) => (
          <li key={i} className="grid grid-cols-[120px_1fr_auto] gap-2">
            <Input aria-label={`${labels[0]} ${i + 1}`} value={r[0]} onChange={(e) => onChange(rows.map((x, j) => (j === i ? [e.target.value, x[1]!] : x)))} className="!py-1.5 font-mono !text-[13px]" />
            <Input aria-label={`${labels[1]} ${i + 1}`} value={r[1]} onChange={(e) => onChange(rows.map((x, j) => (j === i ? [x[0]!, e.target.value] : x)))} className="!py-1.5 !text-[13px]" />
            <Button variant="ghost" size="sm" aria-label={`Remove ${r[1]}`} onClick={() => onChange(rows.filter((_, j) => j !== i))} icon={<Trash className="size-3.5" />} />
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-xs text-bad">{error}</p>}
      <Button size="sm" className="mt-3" icon={<Plus className="size-3.5" />} onClick={() => onChange([...rows, ['', '']])}>
        Add
      </Button>
    </section>
  );
}

function Organizations() {
  const qc = useQueryClient();
  const orgs = useQuery({ queryKey: ['organizations'], queryFn: () => api<OrganizationDTO[]>('/organizations') });
  const [editing, setEditing] = useState<OrganizationDTO | 'new' | null>(null);
  const [form, setForm] = useState({ name: '', kind: 'club' as OrganizationKind, description: '' });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (editing && editing !== 'new') setForm({ name: editing.name, kind: editing.kind, description: editing.description });
    else setForm({ name: '', kind: 'club', description: '' });
    setError(null);
  }, [editing]);
  const save = useMutation({
    mutationFn: () => api(editing === 'new' ? '/organizations' : `/organizations/${(editing as OrganizationDTO).id}`, { method: editing === 'new' ? 'POST' : 'PUT', body: form }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organizations'] });
      setEditing(null);
    },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <div className="max-w-3xl space-y-4">
      <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
        Add organization
      </Button>
      {orgs.isPending ? (
        <LoadingBlock rows={3} />
      ) : (
        <ul className="divide-y divide-line rounded-[var(--radius-md)] border border-line">
          {orgs.data?.map((o) => (
            <li key={o.id} className="flex items-start justify-between gap-4 px-4 py-3">
              <div>
                <p className="text-paper">
                  {o.name} <span className="kicker ml-1 !text-[10px] text-paper-3">{LABELS.organizationKind[o.kind]}</span>
                </p>
                {o.description && <p className="text-xs text-paper-3">{o.description}</p>}
              </div>
              <Button size="sm" variant="ghost" onClick={() => setEditing(o)}>
                Edit
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add organization' : 'Edit organization'}
        size="sm"
        footer={
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="Name">{({ id }) => <Input id={id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
          <Field label="Type">
            {({ id }) => (
              <Select id={id} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as OrganizationKind })}>
                {ORGANIZATION_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {LABELS.organizationKind[k]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Description">{({ id }) => <Textarea id={id} rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />}</Field>
          <FormAlert>{error}</FormAlert>
        </div>
      </Dialog>
    </div>
  );
}

function People() {
  const { user: me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setTerm(q), 250);
    return () => window.clearTimeout(t);
  }, [q]);
  const users = useQuery({ queryKey: ['users', 'admin', term], queryFn: () => api<Page<UserDTO>>('/users', { query: { q: term } }) });
  const orgs = useQuery({ queryKey: ['organizations'], queryFn: () => api<OrganizationDTO[]>('/organizations') });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { role?: UserRole; organizations?: string[] } }) => api<UserDTO>(`/users/${id}`, { method: 'PATCH', body }),
    onSuccess: (u) => {
      qc.invalidateQueries({ queryKey: ['users', 'admin'] });
      toast({ tone: 'ok', title: `${u.name}: ${LABELS.role[u.role]}` });
    },
    onError: (err) => toast({ tone: 'bad', title: 'Not changed', body: errorMessage(err) }),
  });
  return (
    <div className="space-y-4">
      <label className="relative block max-w-md">
        <span className="sr-only">Search people</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-paper-3" />
        <input className="field !py-2 !pl-9 !text-[13px]" placeholder="Name, email or roll number" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {users.isPending ? (
        <LoadingBlock />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-md)] border border-line">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <thead className="kicker border-b border-line bg-ink-900 text-paper-3">
              <tr>
                <th className="px-4 py-2.5 font-medium">Person</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">Organizations (organizers)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.data?.items.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-2.5">
                    <span className="text-paper">{u.name}</span>
                    {!u.claimed && <span className="kicker ml-2 !text-[9px] text-paper-3">imported</span>}
                    <span className="block text-xs text-paper-3">
                      {u.email}
                      {u.rollNumber && ` · ${u.rollNumber}`}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <select
                      aria-label={`Role for ${u.name}`}
                      className="field !w-auto !py-1 !text-[13px]"
                      value={u.role}
                      disabled={u.id === me?.id}
                      onChange={(e) => update.mutate({ id: u.id, body: { role: e.target.value as UserRole } })}
                    >
                      {USER_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {LABELS.role[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5">
                    {u.role === 'organizer' ? (
                      <div className="flex flex-wrap gap-1.5">
                        {orgs.data?.map((o) => (
                          <label key={o.id} className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[11.5px] text-paper-2 has-[:checked]:border-signal has-[:checked]:text-paper">
                            <input
                              type="checkbox"
                              className="accent-[var(--color-signal)]"
                              checked={u.organizations.includes(o.id)}
                              onChange={(e) => update.mutate({ id: u.id, body: { organizations: e.target.checked ? [...u.organizations, o.id] : u.organizations.filter((x) => x !== o.id) } })}
                            />
                            {o.name}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-paper-3">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-paper-3">
        Showing {users.data?.items.length ?? 0} of {users.data?.total ?? 0}. Event-specific staff (managers and check-in volunteers) are assigned on each event’s Staff tab.
      </p>
    </div>
  );
}
