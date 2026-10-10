import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useFieldArray, useForm, get, type FieldErrors } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowUpRight, ImageUp, Plus, ScanLine, Trash, X } from 'lucide-react';
import clsx from 'clsx';
import {
  COMMON_FACILITIES,
  EventInputSchema,
  facilityLabel,
  utcToZonedInput,
  zonedInputToUtc,
  type EventDetailDTO,
  type FeeBasis,
  type OrganizationDTO,
} from '@campusflow/shared';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useInstitutionRequired } from '../../lib/institution';
import { useSession } from '../../lib/session';
import { useFormat } from '../../lib/format';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/Form';
import { ConfirmDialog } from '../../components/ui/Dialog';
import { ErrorState, LoadingBlock } from '../../components/ui/Feedback';
import { StatusPill } from '../../components/ui/Status';
import { Tabs } from '../../components/ui/Tabs';
import { useToast } from '../../components/ui/Toast';
import { EventPoster } from '../../components/EventPoster';
import { VenuePanel } from './EventVenuePanel';
import { StaffPanel, ActivityPanel } from './EventStaffPanel';

interface FormValues {
  title: string;
  organization: string;
  category: string;
  summary: string;
  description: string;
  eligibility: string;
  rulesText: string;
  startsAt: string;
  endsAt: string;
  registrationOpensAt: string;
  registrationDeadline: string;
  mode: 'individual' | 'team';
  teamSize: { min: number; max: number };
  capacity: string;
  fee: { amount: string; basis: FeeBasis };
  paymentInstructions: string;
  requiresApproval: boolean;
  allowedDepartments: string[];
  expectedAttendance: string;
  requiredFacilities: string[];
  checkInOpensMinutesBefore: number;
  schedule: { startsAt: string; endsAt: string; title: string; location: string }[];
}

type Tab = 'details' | 'registration' | 'schedule' | 'venue' | 'staff' | 'activity';

function toForm(e: EventDetailDTO, tz: string): FormValues {
  return {
    title: e.title,
    organization: e.organization.id,
    category: e.category,
    summary: e.summary,
    description: e.description,
    eligibility: e.eligibility,
    rulesText: e.rules.join('\n'),
    startsAt: utcToZonedInput(e.startsAt, tz),
    endsAt: utcToZonedInput(e.endsAt, tz),
    registrationOpensAt: e.registrationOpensAt ? utcToZonedInput(e.registrationOpensAt, tz) : '',
    registrationDeadline: utcToZonedInput(e.registrationDeadline, tz),
    mode: e.mode,
    teamSize: e.teamSize,
    capacity: e.capacity === null ? '' : String(e.capacity),
    fee: { amount: e.fee.amount ? String(e.fee.amount / 100) : '', basis: e.fee.basis },
    paymentInstructions: e.paymentInstructions,
    requiresApproval: e.requiresApproval,
    allowedDepartments: e.allowedDepartments,
    expectedAttendance: e.expectedAttendance ? String(e.expectedAttendance) : '',
    requiredFacilities: e.requiredFacilities,
    checkInOpensMinutesBefore: e.checkInOpensMinutesBefore,
    schedule: e.schedule.map((s) => ({ startsAt: utcToZonedInput(s.startsAt, tz), endsAt: utcToZonedInput(s.endsAt, tz), title: s.title, location: s.location })),
  };
}

function blank(tz: string, defaults: { teamSizeMin: number; teamSizeMax: number; checkInOpensMinutesBefore: number }, org: string): FormValues {
  const day = (offset: number, hm: string) => {
    const d = new Date(Date.now() + offset * 864e5);
    return `${utcToZonedInput(d, tz).slice(0, 10)}T${hm}`;
  };
  return {
    title: '',
    organization: org,
    category: '',
    summary: '',
    description: '',
    eligibility: '',
    rulesText: '',
    startsAt: day(14, '10:00'),
    endsAt: day(14, '16:00'),
    registrationOpensAt: '',
    registrationDeadline: day(12, '20:00'),
    mode: 'individual',
    teamSize: { min: defaults.teamSizeMin, max: defaults.teamSizeMax },
    capacity: '',
    fee: { amount: '', basis: 'per_registration' },
    paymentInstructions: '',
    requiresApproval: false,
    allowedDepartments: [],
    expectedAttendance: '',
    requiredFacilities: [],
    checkInOpensMinutesBefore: defaults.checkInOpensMinutesBefore,
    schedule: [],
  };
}

function toPayload(v: FormValues, tz: string) {
  const at = (s: string) => (s ? zonedInputToUtc(s, tz).toISOString() : '');
  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  return {
    title: v.title,
    organization: v.organization,
    category: v.category,
    summary: v.summary,
    description: v.description,
    eligibility: v.eligibility,
    rules: v.rulesText
      .split('\n')
      .map((r) => r.trim())
      .filter(Boolean),
    startsAt: at(v.startsAt),
    endsAt: at(v.endsAt),
    registrationOpensAt: v.registrationOpensAt ? at(v.registrationOpensAt) : null,
    registrationDeadline: at(v.registrationDeadline),
    mode: v.mode,
    teamSize: { min: Number(v.teamSize.min), max: Number(v.teamSize.max) },
    capacity: num(v.capacity),
    fee: { amount: Math.round((Number(v.fee.amount) || 0) * 100), currency: 'INR', basis: v.fee.basis },
    paymentInstructions: v.paymentInstructions,
    requiresApproval: v.requiresApproval,
    allowedDepartments: v.allowedDepartments,
    expectedAttendance: num(v.expectedAttendance),
    requiredFacilities: v.requiredFacilities,
    checkInOpensMinutesBefore: Number(v.checkInOpensMinutesBefore),
    schedule: v.schedule.map((s) => ({ startsAt: at(s.startsAt), endsAt: at(s.endsAt), title: s.title, location: s.location })),
  };
}

const FIELD_TAB: [RegExp, Tab][] = [
  [/^(schedule)/, 'schedule'],
  [/^(mode|teamSize|capacity|fee|paymentInstructions|requiresApproval|allowedDepartments|registration|checkIn)/, 'registration'],
];
const tabFor = (path: string): Tab => FIELD_TAB.find(([rx]) => rx.test(path))?.[1] ?? 'details';
const formPath = (p: string) => (p === 'rules' ? 'rulesText' : p);

export function EventEditorPage() {
  const { id } = useParams();
  const isNew = !id;
  const inst = useInstitutionRequired();
  const { user, access } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'details';
  const setTab = (t: Tab) => setParams((p) => ({ ...Object.fromEntries(p), tab: t }), { replace: true });

  const event = useQuery({ queryKey: ['event', id], queryFn: () => api<EventDetailDTO>(`/events/${id}`), enabled: !isNew });
  const orgs = useQuery({ queryKey: ['organizations'], queryFn: () => api<OrganizationDTO[]>('/organizations'), staleTime: 300_000 });
  const myOrgs = (orgs.data ?? []).filter((o) => access.isAdmin || user?.organizations.includes(o.id));

  const form = useForm<FormValues>({ defaultValues: blank(inst.timezone, inst.defaults, '') });
  const { register, handleSubmit, reset, watch, setError, clearErrors, control, formState } = form;
  const schedule = useFieldArray({ control, name: 'schedule' });
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (event.data) reset(toForm(event.data, inst.timezone));
  }, [event.data, inst.timezone, reset]);
  useEffect(() => {
    if (isNew && myOrgs.length && !form.getValues('organization')) form.setValue('organization', myOrgs[0]!.id);
  }, [isNew, myOrgs, form]);

  const applyIssues = (fields: Record<string, string>) => {
    let first: string | null = null;
    for (const [path, message] of Object.entries(fields)) {
      const p = formPath(path);
      setError(p as never, { type: 'validate', message });
      first ??= p;
    }
    if (first) setTab(tabFor(first));
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    clearErrors();
    const payload = toPayload(values, inst.timezone);
    const parsed = EventInputSchema.safeParse(payload);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) fields[issue.path.join('.')] ??= issue.message;
      applyIssues(fields);
      setFormError('Some fields need attention — they are highlighted.');
      return;
    }
    try {
      const saved = await api<EventDetailDTO>(isNew ? '/events' : `/events/${id}`, { method: isNew ? 'POST' : 'PUT', body: payload });
      qc.setQueryData(['event', saved.id], saved);
      qc.invalidateQueries({ queryKey: ['workspace'] });
      qc.invalidateQueries({ queryKey: ['events'] });
      toast({ tone: 'ok', title: isNew ? 'Draft created' : 'Changes saved', body: isNew ? 'Publish it when the details are ready.' : undefined });
      if (isNew) navigate(`/workspace/events/${saved.id}?event=${saved.id}`, { replace: true });
      else reset(toForm(saved, inst.timezone));
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) applyIssues(err.fields);
      setFormError(errorMessage(err));
    }
  });

  if (!isNew && event.isError) return <ErrorState error={event.error} onRetry={() => event.refetch()} />;
  if (!isNew && !event.data) return <LoadingBlock rows={6} />;
  const e = event.data;
  if (e && !e.viewer.canManage) return <ErrorState error={new Error('Only this event’s organizers can edit it.')} />;

  const mode = watch('mode');
  const feeAmount = watch('fee.amount');
  const err = (path: string) => (get(formState.errors as FieldErrors, path) as { message?: string } | undefined)?.message;

  const tabs: { value: Tab; label: string }[] = [
    { value: 'details', label: 'Details' },
    { value: 'registration', label: 'Registration' },
    { value: 'schedule', label: `Schedule${schedule.fields.length ? ` · ${schedule.fields.length}` : ''}` },
    ...(!isNew
      ? ([
          { value: 'venue', label: `Venue${e?.allocations.length ? ` · ${e.allocations.length}` : ''}` },
          { value: 'staff', label: `Staff${e?.staff?.length ? ` · ${e.staff.length}` : ''}` },
          { value: 'activity', label: 'Activity' },
        ] as const)
      : []),
  ];
  const formTab = tab === 'details' || tab === 'registration' || tab === 'schedule';

  return (
    <div>
      <Link to="/workspace/events" className="inline-flex items-center gap-1.5 text-sm text-paper-3 hover:text-paper">
        <ArrowLeft className="size-4" /> Events
      </Link>
      <header className="mt-4 flex flex-col gap-4 border-b border-line pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <p className="kicker text-paper-3">{isNew ? 'New event' : e?.organization.name}</p>
            {e && <StatusPill kind="event" value={e.status} />}
          </div>
          <h1 className="display-md mt-2 truncate">{isNew ? 'Create an event' : e?.title}</h1>
        </div>
        {e && <StatusActions event={e} />}
      </header>

      <Tabs label="Event sections" value={tab} onChange={setTab} items={tabs} className="mt-5" />

      {formTab && (
        <form onSubmit={onSubmit} noValidate className="pb-28">
          <div className={clsx('mt-8 space-y-8', tab !== 'details' && 'hidden')}>
            <Grid>
              <Field label="Title" required error={err('title')} className="lg:col-span-2">
                {({ id: fid, describedBy, invalid }) => <Input id={fid} aria-describedby={describedBy} aria-invalid={invalid} {...register('title')} />}
              </Field>
              <Field label="Organized by" required error={err('organization')}>
                {({ id: fid, describedBy, invalid }) => (
                  <Select id={fid} aria-describedby={describedBy} aria-invalid={invalid} {...register('organization')}>
                    <option value="">Choose…</option>
                    {myOrgs.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Category" required error={err('category')}>
                {({ id: fid, describedBy, invalid }) => (
                  <Select id={fid} aria-describedby={describedBy} aria-invalid={invalid} {...register('category')}>
                    <option value="">Choose…</option>
                    {inst.categories.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="One-line summary" required hint="Shown in the directory. 10–280 characters." error={err('summary')} className="lg:col-span-2">
                {({ id: fid, describedBy, invalid }) => <Textarea id={fid} rows={2} maxLength={280} aria-describedby={describedBy} aria-invalid={invalid} {...register('summary')} />}
              </Field>
            </Grid>
            <Grid>
              <Field label="Starts" required hint={`Local time (${inst.timezone})`} error={err('startsAt')}>
                {({ id: fid, describedBy, invalid }) => <Input id={fid} type="datetime-local" aria-describedby={describedBy} aria-invalid={invalid} {...register('startsAt')} />}
              </Field>
              <Field label="Ends" required error={err('endsAt')}>
                {({ id: fid, describedBy, invalid }) => <Input id={fid} type="datetime-local" aria-describedby={describedBy} aria-invalid={invalid} {...register('endsAt')} />}
              </Field>
            </Grid>
            <Field label="Description" hint="Plain text. Separate paragraphs with a blank line." error={err('description')}>
              {({ id: fid, describedBy }) => <Textarea id={fid} rows={8} aria-describedby={describedBy} {...register('description')} />}
            </Field>
            <Grid>
              <Field label="Eligibility" error={err('eligibility')}>
                {({ id: fid }) => <Textarea id={fid} rows={3} {...register('eligibility')} />}
              </Field>
              <Field label="Rules" hint="One rule per line." error={err('rulesText')}>
                {({ id: fid }) => <Textarea id={fid} rows={5} {...register('rulesText')} />}
              </Field>
            </Grid>
            {e && <CoverUpload event={e} />}
          </div>

          <div className={clsx('mt-8 space-y-8', tab !== 'registration' && 'hidden')}>
            <fieldset>
              <legend className="mb-3 text-[13px] font-medium text-paper-2">How do people register?</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {(['individual', 'team'] as const).map((m) => (
                  <label
                    key={m}
                    className={clsx(
                      'flex cursor-pointer gap-3 rounded-[var(--radius-md)] border p-4 transition-colors',
                      mode === m ? 'border-signal bg-signal/[0.05]' : 'border-line hover:border-line-strong',
                      e && e.activeRegistrations > 0 && mode !== m && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <input type="radio" value={m} className="mt-1 accent-[var(--color-signal)]" disabled={Boolean(e && e.activeRegistrations > 0 && mode !== m)} {...register('mode')} />
                    <span>
                      <span className="block text-paper">{m === 'individual' ? 'Individually' : 'As teams'}</span>
                      <span className="block text-sm text-paper-3">
                        {m === 'individual' ? 'Each person registers and gets a ticket.' : 'A leader creates the team; members join with a code. Every member gets a ticket.'}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              {err('mode') && <p className="mt-2 text-xs text-bad">{err('mode')}</p>}
            </fieldset>
            <Grid cols={4}>
              {mode === 'team' && (
                <>
                  <Field label="Minimum team size" error={err('teamSize.min')}>
                    {({ id: fid, invalid }) => <Input id={fid} type="number" min={1} max={50} aria-invalid={invalid} {...register('teamSize.min', { valueAsNumber: true })} />}
                  </Field>
                  <Field label="Maximum team size" error={err('teamSize.max')}>
                    {({ id: fid, invalid }) => <Input id={fid} type="number" min={2} max={50} aria-invalid={invalid} {...register('teamSize.max', { valueAsNumber: true })} />}
                  </Field>
                </>
              )}
              <Field label={`Capacity (${mode === 'team' ? 'teams' : 'people'})`} hint="Leave empty for no limit." error={err('capacity')}>
                {({ id: fid, invalid }) => <Input id={fid} type="number" min={1} inputMode="numeric" aria-invalid={invalid} {...register('capacity')} />}
              </Field>
              <Field label="Expected attendance" hint="Used for room allocation." error={err('expectedAttendance')}>
                {({ id: fid, invalid }) => <Input id={fid} type="number" min={1} inputMode="numeric" aria-invalid={invalid} {...register('expectedAttendance')} />}
              </Field>
            </Grid>
            <Grid cols={4}>
              <Field label="Registration opens" hint="Optional — open now if empty." error={err('registrationOpensAt')}>
                {({ id: fid, invalid }) => <Input id={fid} type="datetime-local" aria-invalid={invalid} {...register('registrationOpensAt')} />}
              </Field>
              <Field label="Registration deadline" required error={err('registrationDeadline')}>
                {({ id: fid, invalid }) => <Input id={fid} type="datetime-local" aria-invalid={invalid} {...register('registrationDeadline')} />}
              </Field>
              <Field label="Check-in opens" hint="Minutes before the start." error={err('checkInOpensMinutesBefore')}>
                {({ id: fid, invalid }) => <Input id={fid} type="number" min={0} max={1440} aria-invalid={invalid} {...register('checkInOpensMinutesBefore', { valueAsNumber: true })} />}
              </Field>
            </Grid>
            <Grid cols={4}>
              <Field label="Fee (₹)" hint="0 or empty for free events." error={err('fee.amount')}>
                {({ id: fid, invalid }) => <Input id={fid} type="number" min={0} step="1" inputMode="decimal" aria-invalid={invalid} {...register('fee.amount')} />}
              </Field>
              <Field label="Fee applies" error={err('fee.basis')}>
                {({ id: fid }) => (
                  <Select id={fid} disabled={!Number(feeAmount)} {...register('fee.basis')}>
                    <option value="per_registration">{mode === 'team' ? 'Per team' : 'Per registration'}</option>
                    <option value="per_participant">Per participant</option>
                  </Select>
                )}
              </Field>
              <Field label="Payment instructions" hint="UPI ID, account, what to write in the note." error={err('paymentInstructions')} className="sm:col-span-2">
                {({ id: fid }) => <Textarea id={fid} rows={2} disabled={!Number(feeAmount)} {...register('paymentInstructions')} />}
              </Field>
            </Grid>
            <Checkbox label="Organizers approve each registration" hint="Registrations stay pending until approved (after payment, if any)." {...register('requiresApproval')} />
            <fieldset>
              <legend className="mb-2 text-[13px] font-medium text-paper-2">Restrict to departments</legend>
              <p className="mb-3 text-xs text-paper-3">Leave all unchecked to open the event to everyone.</p>
              <div className="flex flex-wrap gap-2">
                {inst.departments.map((d) => (
                  <label key={d.code} className="flex cursor-pointer items-center gap-2 rounded-full border border-line px-3 py-1 text-[12.5px] text-paper-2 has-[:checked]:border-signal has-[:checked]:text-paper">
                    <input type="checkbox" value={d.code} className="accent-[var(--color-signal)]" {...register('allowedDepartments')} />
                    {d.code}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-[13px] font-medium text-paper-2">Required facilities</legend>
              <div className="flex flex-wrap gap-2">
                {COMMON_FACILITIES.map((f) => (
                  <label key={f} className="flex cursor-pointer items-center gap-2 rounded-full border border-line px-3 py-1 text-[12.5px] text-paper-2 has-[:checked]:border-signal has-[:checked]:text-paper">
                    <input type="checkbox" value={f} className="accent-[var(--color-signal)]" {...register('requiredFacilities')} />
                    {facilityLabel(f)}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <div className={clsx('mt-8 space-y-4', tab !== 'schedule' && 'hidden')}>
            <p className="text-sm text-paper-2">Optional agenda shown on the event page. Times must fall within the event.</p>
            {schedule.fields.length === 0 && <p className="rounded-[var(--radius-md)] border border-dashed border-line-strong px-5 py-6 text-sm text-paper-3">No agenda items yet.</p>}
            <ol className="space-y-3">
              {schedule.fields.map((f, i) => (
                <li key={f.id} className="grid gap-3 rounded-[var(--radius-md)] border border-line p-4 sm:grid-cols-[1fr_1fr_1.4fr_1fr_auto] sm:items-end">
                  <Field label="Starts" error={err(`schedule.${i}.startsAt`)}>
                    {({ id: fid, invalid }) => <Input id={fid} type="datetime-local" aria-invalid={invalid} {...register(`schedule.${i}.startsAt`)} />}
                  </Field>
                  <Field label="Ends" error={err(`schedule.${i}.endsAt`)}>
                    {({ id: fid, invalid }) => <Input id={fid} type="datetime-local" aria-invalid={invalid} {...register(`schedule.${i}.endsAt`)} />}
                  </Field>
                  <Field label="Title" error={err(`schedule.${i}.title`)}>
                    {({ id: fid, invalid }) => <Input id={fid} aria-invalid={invalid} {...register(`schedule.${i}.title`)} />}
                  </Field>
                  <Field label="Location">{({ id: fid }) => <Input id={fid} {...register(`schedule.${i}.location`)} />}</Field>
                  <Button variant="ghost" onClick={() => schedule.remove(i)} aria-label={`Remove agenda item ${i + 1}`} icon={<Trash className="size-4" />} />
                </li>
              ))}
            </ol>
            <Button
              icon={<Plus className="size-4" />}
              onClick={() => {
                const v = form.getValues();
                const last = v.schedule[v.schedule.length - 1];
                schedule.append({ startsAt: last?.endsAt || v.startsAt, endsAt: last?.endsAt || v.startsAt, title: '', location: '' });
              }}
            >
              Add agenda item
            </Button>
          </div>

          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-ink-950/95 backdrop-blur-md lg:left-[var(--shell-sidebar)]">
            <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-10">
              <div className="min-w-0 flex-1 text-sm">{formError ? <span className="text-bad">{formError}</span> : <span className="text-paper-3">{formState.isDirty ? 'Unsaved changes' : isNew ? 'New drafts are private until published.' : 'All changes saved'}</span>}</div>
              <div className="flex gap-2">
                {formState.isDirty && !isNew && (
                  <Button variant="ghost" onClick={() => e && reset(toForm(e, inst.timezone))}>
                    Discard
                  </Button>
                )}
                <Button type="submit" variant="primary" loading={formState.isSubmitting} disabled={!isNew && !formState.isDirty}>
                  {isNew ? 'Create draft' : 'Save changes'}
                </Button>
              </div>
            </div>
          </div>
        </form>
      )}
      {e && tab === 'venue' && <VenuePanel event={e} />}
      {e && tab === 'staff' && <StaffPanel event={e} />}
      {e && tab === 'activity' && <ActivityPanel event={e} />}
    </div>
  );
}

function Grid({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 4 }) {
  return <div className={clsx('grid gap-5', cols === 2 ? 'lg:grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-4')}>{children}</div>;
}

function StatusActions({ event: e }: { event: EventDetailDTO }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState<'cancel' | null>(null);
  const change = useMutation({
    mutationFn: (status: string) => api<EventDetailDTO>(`/events/${e.id}/status`, { method: 'POST', body: { status } }),
    onSuccess: (saved) => {
      qc.setQueryData(['event', saved.id], saved);
      qc.invalidateQueries({ queryKey: ['workspace'] });
      qc.invalidateQueries({ queryKey: ['events'] });
      toast({ tone: 'ok', title: saved.status === 'published' ? 'Published — it’s now in the directory' : saved.status === 'draft' ? 'Unpublished' : `Event ${saved.status}` });
    },
    onError: (err) => toast({ tone: 'bad', title: 'Status not changed', body: errorMessage(err) }),
  });
  return (
    <div className="flex flex-wrap items-center gap-2">
      {e.status !== 'draft' && (
        <ButtonLink to={`/events/${e.slug}`} size="sm" variant="ghost" iconRight={<ArrowUpRight className="size-3.5" />}>
          Public page
        </ButtonLink>
      )}
      {e.status === 'published' && (
        <ButtonLink to={`/live/${e.id}`} size="sm" icon={<ScanLine className="size-3.5" />}>
          Live check-in
        </ButtonLink>
      )}
      {e.status === 'draft' && (
        <Button size="sm" variant="primary" loading={change.isPending && change.variables === 'published'} onClick={() => change.mutate('published')}>
          Publish
        </Button>
      )}
      {e.status === 'published' && (
        <Button
          size="sm"
          disabled={e.activeRegistrations > 0}
          title={e.activeRegistrations > 0 ? 'Events with active registrations can be cancelled, not unpublished' : undefined}
          loading={change.isPending && change.variables === 'draft'}
          onClick={() => change.mutate('draft')}
        >
          Unpublish
        </Button>
      )}
      {(e.status === 'draft' || e.status === 'published') && (
        <Button size="sm" variant="danger" onClick={() => setConfirm('cancel')} icon={<X className="size-3.5" />}>
          Cancel event
        </Button>
      )}
      <ConfirmDialog
        open={confirm === 'cancel'}
        onClose={() => setConfirm(null)}
        title={`Cancel “${e.title}”?`}
        description={`The event stays visible as cancelled, check-in is disabled and its venue bookings are released. ${e.activeRegistrations} active registration${e.activeRegistrations === 1 ? '' : 's'} will see the cancellation. This cannot be undone.`}
        confirmLabel="Cancel event"
        onConfirm={async () => {
          await change.mutateAsync('cancelled');
        }}
      />
    </div>
  );
}

function CoverUpload({ event: e }: { event: EventDetailDTO }) {
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const preview = useMemo(() => ({ ...e }), [e]);
  const upload = async (file: File) => {
    if (file.size > 3 * 1024 * 1024) {
      toast({ tone: 'bad', title: 'Image too large', body: 'Use an image under 3 MB.' });
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.append('cover', file);
      const saved = await api<EventDetailDTO>(`/events/${e.id}/cover`, { method: 'POST', body });
      qc.setQueryData(['event', e.id], saved);
      toast({ tone: 'ok', title: 'Cover image updated' });
    } catch (err) {
      toast({ tone: 'bad', title: 'Upload failed', body: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4 border-t border-line pt-8 sm:flex-row sm:items-start">
      <EventPoster event={preview} className="aspect-[3/4] w-32 shrink-0 rounded-[var(--radius-sm)]" size="sm" />
      <div className="space-y-2">
        <p className="text-[13px] font-medium text-paper-2">Cover image</p>
        <p className="max-w-md text-xs text-paper-3">JPEG, PNG or WebP under 3 MB. Without one, CAMPUSFLOW draws a poster from the event’s category and date.</p>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(ev) => ev.target.files?.[0] && upload(ev.target.files[0])} />
        <div className="flex gap-2">
          <Button size="sm" loading={busy} icon={<ImageUp className="size-3.5" />} onClick={() => input.current?.click()}>
            {e.coverUrl ? 'Replace image' : 'Upload image'}
          </Button>
          {e.coverUrl && (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                const saved = await api<EventDetailDTO>(`/events/${e.id}/cover`, { method: 'DELETE' });
                qc.setQueryData(['event', e.id], saved);
              }}
            >
              Remove
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

