import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, FileText, Plus, Trash, Upload, X } from 'lucide-react';
import {
  DOCUMENT_FORMATS,
  DOCUMENT_SCOPES,
  LABELS,
  utcToZonedInput,
  zonedInputToUtc,
  type DocumentConfigDTO,
  type DocumentFormat,
  type DocumentScope,
  type DocumentType,
  type EventDetailDTO,
} from '@campusflow/shared';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useInstitutionRequired } from '../../lib/institution';
import { Button } from '../../components/ui/Button';
import { Checkbox, Field, FormAlert, Input, Select, Textarea } from '../../components/ui/Form';
import { ErrorState, LoadingBlock } from '../../components/ui/Feedback';
import { useToast } from '../../components/ui/Toast';
import { megabytes, templateUrl } from './RegistrationDocuments';

/**
 * Event → Documents: what participants must provide, and whether organizers approve participation.
 * A fixed set of fields per requirement (no form builder). CAMPUSFLOW supplies no official wording:
 * organizers describe the document in their institution's words and may attach the official form.
 */

interface Draft {
  uid: string;
  key?: string;
  type: DocumentType;
  name: string;
  description: string;
  required: boolean;
  appliesTo: DocumentScope;
  deadline: string;
  formats: DocumentFormat[];
  reviewRequired: boolean;
  active: boolean;
  submissions: number;
  template: DocumentConfigDTO['requirements'][number]['template'];
}

const PRESETS: Record<DocumentType, Pick<Draft, 'name' | 'appliesTo' | 'formats'>> = {
  permission_letter: { name: LABELS.documentType.permission_letter, appliesTo: 'each_member', formats: ['pdf'] },
  guardian_undertaking: { name: LABELS.documentType.guardian_undertaking, appliesTo: 'each_member', formats: ['pdf', 'jpg', 'png'] },
  other: { name: '', appliesTo: 'registrant', formats: ['pdf'] },
};

const DESCRIPTION_HINT: Record<DocumentType, string> = {
  permission_letter: 'Say who must sign it and what it must state, in your institution’s own words — CAMPUSFLOW adds no wording.',
  guardian_undertaking: 'Describe what the parent or guardian is agreeing to, in your institution’s own words, or attach the official form below.',
  other: 'What the document is and what organizers will check.',
};

let uidSeq = 0;
const uid = () => `r${++uidSeq}`;

export function DocumentsPanel({ event: e }: { event: EventDetailDTO }) {
  const inst = useInstitutionRequired();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['documents-config', e.id], queryFn: () => api<DocumentConfigDTO>(`/events/${e.id}/documents/config`) });
  const [approval, setApproval] = useState(false);
  const [gate, setGate] = useState(false);
  const [rows, setRows] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const loadedFrom = useRef<DocumentConfigDTO | null>(null);

  const fromServer = (c: DocumentConfigDTO) => {
    loadedFrom.current = c;
    setApproval(c.approvalRequired);
    setGate(c.checkInRequiresApproval);
    setRows(
      c.requirements.map((r) => ({
        uid: uid(),
        key: r.key,
        type: r.type,
        name: r.name,
        description: r.description,
        required: r.required,
        appliesTo: r.appliesTo,
        deadline: r.deadline ? utcToZonedInput(r.deadline, inst.timezone) : '',
        formats: r.formats,
        reviewRequired: r.reviewRequired,
        active: r.active,
        submissions: r.submissions,
        template: r.template,
      })),
    );
  };
  useEffect(() => {
    if (q.data && q.data !== loadedFrom.current) fromServer(q.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  if (q.isError) return <div className="mt-8"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  if (!q.data) return <div className="mt-8"><LoadingBlock rows={4} /></div>;
  const config = q.data;

  const payload = () => ({
    approvalRequired: approval,
    checkInRequiresApproval: approval && gate,
    requirements: rows.map((r) => ({
      ...(r.key ? { key: r.key } : {}),
      type: r.type,
      name: r.name.trim(),
      description: r.description.trim(),
      required: r.required,
      appliesTo: e.mode === 'individual' ? 'each_member' : r.appliesTo,
      deadline: r.deadline ? zonedInputToUtc(r.deadline, inst.timezone).toISOString() : null,
      formats: r.formats,
      reviewRequired: r.reviewRequired,
      active: r.active,
    })),
  });
  const original = JSON.stringify({
    approvalRequired: config.approvalRequired,
    checkInRequiresApproval: config.checkInRequiresApproval,
    requirements: config.requirements.map((r) => ({
      key: r.key,
      type: r.type,
      name: r.name,
      description: r.description,
      required: r.required,
      appliesTo: e.mode === 'individual' ? 'each_member' : r.appliesTo,
      deadline: r.deadline ? new Date(r.deadline).toISOString() : null,
      formats: r.formats,
      reviewRequired: r.reviewRequired,
      active: r.active,
    })),
  });
  const dirty = JSON.stringify(payload()) !== original;

  const update = (i: number, patch: Partial<Draft>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = (type: DocumentType) => {
    const preset = PRESETS[type];
    setRows((all) => [
      ...all,
      { uid: uid(), type, name: preset.name, description: '', required: true, appliesTo: preset.appliesTo, deadline: '', formats: preset.formats, reviewRequired: true, active: true, submissions: 0, template: null },
    ]);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const saved = await api<DocumentConfigDTO>(`/events/${e.id}/documents/config`, { method: 'PUT', body: payload() });
      qc.setQueryData(['documents-config', e.id], saved);
      fromServer(saved);
      qc.invalidateQueries({ queryKey: ['event', e.id] });
      qc.invalidateQueries({ queryKey: ['registrations', e.id] });
      toast({ tone: 'ok', title: 'Document settings saved', body: 'Every registration’s participation status was updated.' });
    } catch (err) {
      if (err instanceof ApiError) setFieldErrors(err.fields);
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  const fieldError = (i: number, f: string) => fieldErrors[`requirements.${i}.${f}`];

  return (
    <div className="mt-8 max-w-3xl space-y-10 pb-28">
      {!config.storageAvailable && (
        <FormAlert tone="warn">The server can’t write to its private document storage right now. You can change these settings, but participants won’t be able to upload until storage is available again.</FormAlert>
      )}

      <section className="space-y-4">
        <h2 className="display-sm">Participation approval</h2>
        <p className="max-w-prose text-sm text-paper-2">
          Separate from registration: it never changes seats, teams, payments or tickets. Registering never approves participation — an organizer does, after checking documents.
        </p>
        <Checkbox
          label="Organizers approve each registration’s participation"
          hint="Once every required document is approved, an organizer approves or declines participation explicitly. Replacing a document later withdraws the approval until it is given again."
          checked={approval}
          onChange={(ev) => {
            setApproval(ev.target.checked);
            if (!ev.target.checked) setGate(false);
          }}
        />
        <Checkbox
          label="Only admit approved participants at check-in"
          hint={approval ? 'The scanner refuses entry until participation is approved and tells volunteers why — without showing any documents.' : 'Needs participation approval turned on.'}
          checked={approval && gate}
          disabled={!approval}
          onChange={(ev) => setGate(ev.target.checked)}
        />
        {fieldErrors.checkInRequiresApproval && <FormAlert>{fieldErrors.checkInRequiresApproval}</FormAlert>}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="display-sm">Documents participants provide</h2>
          <p className="mt-2 max-w-prose text-sm text-paper-2">
            Files up to {megabytes(config.maxBytes)}, stored privately — only the participant and this event’s organizers can open them. CAMPUSFLOW doesn’t supply official wording: describe each document in your institution’s words and attach the official form as a template if you have one.
          </p>
        </div>

        {rows.length === 0 && <p className="rounded-[var(--radius-md)] border border-dashed border-line px-4 py-6 text-sm text-paper-3">No documents requested.</p>}

        <ol className="space-y-4">
          {rows.map((r, i) => (
            <li key={r.uid} className={`rounded-[var(--radius-md)] border border-line ${r.active ? '' : 'opacity-70'}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-ink-900 px-4 py-2.5">
                <p className="kicker text-paper-3">
                  {LABELS.documentType[r.type]}
                  {!r.active && ' · inactive'}
                  {r.submissions > 0 && ` · ${r.submissions} submitted`}
                </p>
                {r.submissions > 0 ? (
                  <Button size="sm" variant="ghost" icon={r.active ? <Archive className="size-3.5" /> : <ArchiveRestore className="size-3.5" />} onClick={() => update(i, { active: !r.active })}>
                    {r.active ? 'Stop requesting' : 'Request again'}
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" icon={<Trash className="size-3.5" />} onClick={() => setRows((all) => all.filter((_, j) => j !== i))}>
                    Remove<span className="sr-only"> {r.name || LABELS.documentType[r.type]}</span>
                  </Button>
                )}
              </div>
              <div className="grid gap-4 p-4 sm:grid-cols-2">
                <Field label="Document name" required error={fieldError(i, 'name')} className="sm:col-span-2">
                  {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} value={r.name} maxLength={120} onChange={(ev) => update(i, { name: ev.target.value })} />}
                </Field>
                <Field label="What it must contain" hint={DESCRIPTION_HINT[r.type]} error={fieldError(i, 'description')} className="sm:col-span-2">
                  {({ id, describedBy, invalid }) => <Textarea id={id} rows={3} maxLength={1500} aria-describedby={describedBy} aria-invalid={invalid} value={r.description} onChange={(ev) => update(i, { description: ev.target.value })} />}
                </Field>
                {e.mode === 'team' ? (
                  <Field label="Applies to" hint={r.appliesTo === 'each_member' ? 'Each member uploads their own; teammates can’t see it.' : r.appliesTo === 'team' ? 'Uploaded by the leader; visible to the whole team.' : 'Uploaded by the person who registered the team.'}>
                    {({ id, describedBy }) => (
                      <Select id={id} aria-describedby={describedBy} value={r.appliesTo} onChange={(ev) => update(i, { appliesTo: ev.target.value as DocumentScope })}>
                        {DOCUMENT_SCOPES.map((s) => (
                          <option key={s} value={s}>
                            {LABELS.documentScope[s]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                ) : (
                  <p className="self-end text-xs text-paper-3">Individual registrations: each participant uploads their own.</p>
                )}
                <Field label="Deadline" hint={`Optional · ${inst.timezone}. Corrections you ask for are allowed after it.`} error={fieldError(i, 'deadline')}>
                  {({ id, describedBy, invalid }) => <Input id={id} type="datetime-local" aria-describedby={describedBy} aria-invalid={invalid} value={r.deadline} onChange={(ev) => update(i, { deadline: ev.target.value })} />}
                </Field>
                <fieldset className="sm:col-span-2">
                  <legend className="text-[13px] font-medium text-paper-2">Accepted formats</legend>
                  <div className="mt-2 flex flex-wrap gap-5">
                    {DOCUMENT_FORMATS.map((f) => (
                      <Checkbox
                        key={f}
                        label={LABELS.documentFormat[f]}
                        checked={r.formats.includes(f)}
                        onChange={(ev) => update(i, { formats: ev.target.checked ? [...r.formats, f] : r.formats.filter((x) => x !== f) })}
                      />
                    ))}
                  </div>
                  {fieldError(i, 'formats') && <p className="mt-1.5 text-xs text-bad">{fieldError(i, 'formats')}</p>}
                </fieldset>
                <Checkbox label="Required" hint="Optional documents never hold up participation." checked={r.required} onChange={(ev) => update(i, { required: ev.target.checked })} />
                <Checkbox label="Organizers review it" hint="Off: an upload counts as complete without review." checked={r.reviewRequired} onChange={(ev) => update(i, { reviewRequired: ev.target.checked })} />
                <div className="sm:col-span-2">
                  <TemplateControl eventId={e.id} draft={r} onSaved={(c) => { qc.setQueryData(['documents-config', e.id], c); update(i, { template: c.requirements.find((x) => x.key === r.key)?.template ?? null }); }} />
                </div>
              </div>
            </li>
          ))}
        </ol>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => add('permission_letter')} disabled={rows.length >= 10}>
            Permission letter
          </Button>
          <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => add('guardian_undertaking')} disabled={rows.length >= 10}>
            Parent / guardian undertaking
          </Button>
          <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => add('other')} disabled={rows.length >= 10}>
            Other document
          </Button>
        </div>
      </section>

      <FormAlert>{error}</FormAlert>
      <div className="flex gap-2">
        <Button variant="primary" disabled={!dirty} loading={saving} onClick={save}>
          Save document settings
        </Button>
        {dirty && (
          <Button variant="ghost" onClick={() => fromServer(config)}>
            Discard
          </Button>
        )}
      </div>
    </div>
  );
}

function TemplateControl({ eventId, draft, onSaved }: { eventId: string; draft: Draft; onSaved: (c: DocumentConfigDTO) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (!draft.key) return <p className="text-xs text-paper-3">Save first to attach the official form as a template.</p>;
  const key = draft.key;
  const upload = async (file: File) => {
    const body = new FormData();
    body.append('file', file);
    setBusy(true);
    try {
      onSaved(await api<DocumentConfigDTO>(`/events/${eventId}/documents/requirements/${key}/template`, { method: 'POST', body }));
      toast({ tone: 'ok', title: 'Template attached' });
    } catch (err) {
      toast({ tone: 'bad', title: 'Template not attached', body: errorMessage(err) });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] bg-ink-900 px-3 py-2">
      <FileText className="size-4 text-paper-3" aria-hidden />
      {draft.template ? (
        <>
          <a href={templateUrl(eventId, key)} className="mr-auto truncate text-sm text-paper underline decoration-line-strong underline-offset-4 hover:decoration-paper-2">
            {draft.template.name}
          </a>
          <Button
            size="sm"
            variant="ghost"
            icon={<X className="size-3.5" />}
            onClick={async () => {
              try {
                onSaved(await api<DocumentConfigDTO>(`/events/${eventId}/documents/requirements/${key}/template`, { method: 'DELETE' }));
              } catch (err) {
                toast({ tone: 'bad', title: 'Couldn’t remove the template', body: errorMessage(err) });
              }
            }}
          >
            Detach
          </Button>
        </>
      ) : (
        <p className="mr-auto text-xs text-paper-3">No template. Participants are told to use the format you describe.</p>
      )}
      <input ref={input} type="file" accept=".pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only" tabIndex={-1} aria-label={`Template for ${draft.name}`} onChange={(ev) => ev.target.files?.[0] && void upload(ev.target.files[0])} />
      <Button size="sm" loading={busy} icon={<Upload className="size-3.5" />} onClick={() => input.current?.click()}>
        {draft.template ? 'Replace template' : 'Attach official form'}
      </Button>
    </div>
  );
}
