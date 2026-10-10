import { useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, Download, ExternalLink, FilePen, FileText, FileUp, History, MessageSquare, RotateCcw, ShieldCheck, X } from 'lucide-react';
import clsx from 'clsx';
import {
  LABELS,
  type DocumentFormat,
  type DocumentRequirementDTO,
  type DocumentSlotDTO,
  type RegistrationDocumentsDTO,
} from '@campusflow/shared';
import { api, ApiError, errorMessage } from '../../lib/api';
import { relativeTime, useFormat } from '../../lib/format';
import { useSession } from '../../lib/session';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/Dialog';
import { FormAlert } from '../../components/ui/Form';
import { ErrorState, LoadingBlock } from '../../components/ui/Feedback';
import { StatusPill } from '../../components/ui/Status';
import { useToast } from '../../components/ui/Toast';

/**
 * Documents a registration owes and its participation approval — one component for both sides:
 *  participant: what is needed, upload / replace, reviewer feedback
 *  organizer:   open and download, approve / request changes / reject / comment, participation decision
 * Everything shown comes from the server, which also enforces every rule; the UI only explains them.
 */

export const documentsKey = (registrationId: string) => ['registration-documents', registrationId] as const;

const ACCEPT: Record<DocumentFormat, string> = { pdf: '.pdf,application/pdf', jpg: '.jpg,.jpeg,image/jpeg', png: '.png,image/png' };
const fileUrl = (id: string, opts: { inline?: boolean; version?: number } = {}) =>
  `/api/documents/${id}/file${opts.inline || opts.version ? '?' : ''}${[opts.inline ? 'inline=1' : '', opts.version ? `version=${opts.version}` : ''].filter(Boolean).join('&')}`;
export const templateUrl = (eventId: string, key: string) => `/api/events/${eventId}/documents/requirements/${key}/template`;

export function formatList(formats: readonly DocumentFormat[]) {
  const names = formats.map((f) => LABELS.documentFormat[f]);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : (names[0] ?? '');
}
export const megabytes = (bytes: number) => `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : megabytes(bytes));

export function RegistrationDocuments({
  registrationId,
  eventId,
  mode,
  closed = false,
  heading,
}: {
  registrationId: string;
  eventId: string;
  mode: 'participant' | 'organizer';
  closed?: boolean;
  /** Wraps the content in the host page's section style; receives null when there is nothing to show. */
  heading: (content: ReactNode) => ReactNode;
}) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: documentsKey(registrationId), queryFn: () => api<RegistrationDocumentsDTO>(`/registrations/${registrationId}/documents`) });

  const apply = (d: RegistrationDocumentsDTO) => {
    qc.setQueryData(documentsKey(registrationId), d);
    qc.invalidateQueries({ queryKey: ['registration', registrationId] });
    qc.invalidateQueries({ queryKey: ['registrations', eventId] });
    qc.invalidateQueries({ queryKey: ['me'] });
    qc.invalidateQueries({ queryKey: ['workspace'] });
  };
  const refresh = () => qc.invalidateQueries({ queryKey: documentsKey(registrationId) });

  if (q.isError) return heading(<ErrorState error={q.error} onRetry={() => q.refetch()} />);
  if (!q.data) return heading(<LoadingBlock rows={3} label="Loading documents" />);
  const d = q.data;
  if (d.slots.length === 0 && !d.participation.approvalRequired) return heading(null);

  const groups = d.requirements
    .map((requirement) => ({ requirement, slots: d.slots.filter((s) => s.requirementKey === requirement.key) }))
    .filter((g) => g.slots.length > 0);

  return heading(
    <div className="space-y-6">
      <Summary d={d} mode={mode} />
      {mode === 'organizer' && d.participation.approvalRequired && !closed && <Decision d={d} onDone={apply} onStale={refresh} />}
      {!d.storageAvailable && (
        <FormAlert tone="warn">Document storage is unavailable on the server right now, so files can’t be uploaded or opened. Nothing already submitted is lost — try again later.</FormAlert>
      )}
      {groups.length > 0 && (
        <ol className="space-y-5">
          {groups.map((g) => (
            <RequirementBlock
              key={g.requirement.key}
              requirement={g.requirement}
              slots={g.slots}
              d={d}
              eventId={eventId}
              mode={mode}
              closed={closed}
              onDone={apply}
              onStale={refresh}
            />
          ))}
        </ol>
      )}
      <p className="text-xs leading-relaxed text-paper-3">
        Files are private to {mode === 'organizer' ? 'the participant and this event’s organizers' : 'you and this event’s organizers'}. Organizers check them by eye: a typed name or a scanned
        signature is not a verified digital signature, and CAMPUSFLOW does not check university records.
      </p>
    </div>,
  );
}

/* ---------------------------------------------------------------- summary & decision */

function Summary({ d, mode }: { d: RegistrationDocumentsDTO; mode: 'participant' | 'organizer' }) {
  const fmt = useFormat();
  const p = d.participation;
  const c = p.counts;
  const participantLine: Record<typeof p.status, string> = {
    not_required: 'The documents below are optional.',
    not_submitted: `${c.missing} required document${c.missing === 1 ? ' is' : 's are'} still to be uploaded.`,
    submitted: 'Everything required is in. The organizers will review it.',
    under_review: p.readyForDecision ? 'Your documents are approved. Waiting for the organizers’ final decision.' : 'The organizers are reviewing the documents.',
    changes_requested: 'The organizers asked for a corrected document — see their note below.',
    approved: 'Participation is approved.',
    rejected: 'The organizers did not approve participation.',
  };
  const organizerLine = [
    `${c.required} required`,
    c.missing ? `${c.missing} missing` : null,
    c.awaitingReview ? `${c.awaitingReview} to review` : null,
    c.changesRequested ? `${c.changesRequested} awaiting correction` : null,
    c.approved ? `${c.approved} approved` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <StatusPill kind="participation" value={p.status} size="md" />
        <p className="text-sm text-paper-2">{mode === 'organizer' ? organizerLine : participantLine[p.status]}</p>
      </div>
      {p.decision && p.decision.current && (
        <p className="text-xs text-paper-3">
          {p.decision.value === 'approved' ? 'Approved' : 'Declined'} by {p.decision.by?.name ?? 'an organizer'} · {fmt.dateTime(p.decision.at)}
          {p.decision.note ? ` — “${p.decision.note}”` : ''}
        </p>
      )}
      {p.decision && !p.decision.current && p.decision.value === 'approved' && (
        <p className="text-xs text-paper-3">
          An earlier approval ({p.decision.by?.name ?? 'an organizer'}, {fmt.dateTime(p.decision.at)}) no longer applies: a document was replaced or a new one became due since.
        </p>
      )}
      {p.checkInRequiresApproval && p.status !== 'approved' && (
        <p className="text-xs text-warn">Entry at the event requires approved participation — the scanner will refuse it until then.</p>
      )}
    </div>
  );
}

function Decision({ d, onDone, onStale }: { d: RegistrationDocumentsDTO; onDone: (d: RegistrationDocumentsDTO) => void; onStale: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'reject' | 'reopen' | null>(null);
  const p = d.participation;
  const send = async (action: 'approve' | 'reject' | 'reopen', note = '') => {
    try {
      const next = await api<RegistrationDocumentsDTO>(`/registrations/${d.registrationId}/participation`, { method: 'POST', body: { action, note, rev: p.rev } });
      onDone(next);
      toast({ tone: 'ok', title: action === 'approve' ? 'Participation approved' : action === 'reject' ? 'Participation declined' : 'Decision undone' });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) onStale();
      throw err;
    }
  };
  const decided = p.decision?.current ? p.decision.value : null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-line bg-ink-900 px-3 py-2.5">
      <p className="mr-auto text-xs text-paper-3">
        {decided === 'approved'
          ? 'Participation approved.'
          : decided === 'rejected'
            ? 'Participation declined.'
            : p.readyForDecision
              ? 'Documents are in order — decide on participation.'
              : 'Approve participation once every required document is approved.'}
      </p>
      {decided ? (
        <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => setConfirm('reopen')}>
          Undo decision
        </Button>
      ) : (
        <>
          <Button
            size="sm"
            variant="primary"
            icon={<ShieldCheck className="size-3.5" />}
            loading={busy}
            disabled={!p.readyForDecision}
            title={p.readyForDecision ? undefined : 'Every required document must be uploaded and approved first'}
            onClick={async () => {
              setBusy(true);
              try {
                await send('approve');
              } catch (err) {
                toast({ tone: 'bad', title: 'Not approved', body: errorMessage(err) });
              } finally {
                setBusy(false);
              }
            }}
          >
            Approve participation
          </Button>
          <Button size="sm" variant="danger" icon={<Ban className="size-3.5" />} onClick={() => setConfirm('reject')}>
            Decline
          </Button>
        </>
      )}
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'reject' ? 'Decline participation?' : 'Undo this decision?'}
        tone={confirm === 'reject' ? 'danger' : 'primary'}
        description={
          confirm === 'reject'
            ? 'The participant sees your reason and can no longer upload documents. Their registration, team and ticket are not changed.'
            : 'Participation goes back to review. The participant can upload again if documents are still needed.'
        }
        confirmLabel={confirm === 'reject' ? 'Decline' : 'Undo decision'}
        reason={confirm === 'reject' ? { label: 'Reason (shown to the participant)', required: true, minLength: 3 } : undefined}
        onConfirm={(note) => send(confirm!, note)}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- requirements and slots */

function RequirementBlock({
  requirement: r,
  slots,
  d,
  eventId,
  mode,
  closed,
  onDone,
  onStale,
}: {
  requirement: DocumentRequirementDTO;
  slots: DocumentSlotDTO[];
  d: RegistrationDocumentsDTO;
  eventId: string;
  mode: 'participant' | 'organizer';
  closed: boolean;
  onDone: (d: RegistrationDocumentsDTO) => void;
  onStale: () => void;
}) {
  const fmt = useFormat();
  const overdue = r.deadline && new Date(r.deadline).getTime() < Date.now();
  return (
    <li className="overflow-hidden rounded-[var(--radius-md)] border border-line">
      <div className="border-b border-line bg-ink-900 px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h4 className="text-[15px] font-medium text-paper">{r.name}</h4>
          <span className="kicker !text-[10px] text-paper-3">{r.required ? 'Required' : 'Optional'}</span>
          {!r.active && <span className="kicker !text-[10px] text-warn">No longer requested</span>}
        </div>
        <p className="mt-1 text-xs text-paper-3">
          {[
            slots.length > 1 || slots[0]?.subject === null ? LABELS.documentScope[r.appliesTo] : null,
            `${formatList(r.formats)}, up to ${megabytes(d.maxBytes)}`,
            r.deadline ? `${overdue ? 'Was due' : 'Due'} ${fmt.dateTime(r.deadline)}` : 'No deadline',
            r.reviewRequired ? 'Checked by organizers' : 'No review needed',
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {r.description && <p className="mt-2 max-w-prose whitespace-pre-line text-sm text-paper-2">{r.description}</p>}
        {r.template ? (
          <a href={templateUrl(eventId, r.key)} className="mt-2 inline-flex items-center gap-1.5 text-sm text-paper underline decoration-signal underline-offset-4 hover:decoration-2">
            <FileText className="size-3.5" aria-hidden /> Organizers’ form: {r.template.name} ({size(r.template.size)})
          </a>
        ) : (
          r.type !== 'other' && (
            <p className="mt-2 text-xs text-paper-3">No template attached — use the format your institution or the organizers specify. CAMPUSFLOW doesn’t supply wording for this document.</p>
          )
        )}
      </div>
      <ul className="divide-y divide-line">
        {slots.map((s) => (
          <SlotRow key={s.slot} slot={s} requirement={r} d={d} mode={mode} closed={closed} onDone={onDone} onStale={onStale} />
        ))}
      </ul>
    </li>
  );
}

function SlotRow({
  slot: s,
  requirement,
  d,
  mode,
  closed,
  onDone,
  onStale,
}: {
  slot: DocumentSlotDTO;
  requirement: DocumentRequirementDTO;
  d: RegistrationDocumentsDTO;
  mode: 'participant' | 'organizer';
  closed: boolean;
  onDone: (d: RegistrationDocumentsDTO) => void;
  onStale: () => void;
}) {
  const { user } = useSession();
  const doc = s.document;
  const mine = s.subject ? s.subject.id === user?.id : false;
  const who = s.subject ? (mine && mode === 'participant' ? 'You' : s.subject.name) : 'Team document';
  const feedback = doc?.review?.note && (s.status === 'changes_requested' || s.status === 'rejected') ? doc.review : null;

  return (
    <li className="px-4 py-3.5" data-slot={s.slot}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-sm font-medium text-paper">{who}</p>
            <StatusPill kind="document" value={s.status} />
          </div>
          {doc && (
            <p className="mt-1 truncate text-xs text-paper-3">
              <span className="text-paper-2">{doc.file.name}</span> · {size(doc.file.size)} · v{doc.version} · {relativeTime(doc.file.uploadedAt)}
              {doc.file.uploadedBy && doc.file.uploadedBy.id !== s.subject?.id ? ` by ${doc.file.uploadedBy.name}` : ''}
            </p>
          )}
          {!doc && s.status !== 'missing' && <p className="mt-1 text-xs text-paper-3">Visible only to {s.subject?.name ?? 'the team'} and the organizers.</p>}
          {feedback && (
            <div className="mt-2 rounded-[var(--radius-sm)] border border-warn/40 bg-warn/[0.06] px-3 py-2 text-sm">
              <p className="text-paper">“{feedback.note}”</p>
              <p className="mt-0.5 text-xs text-paper-3">
                {feedback.by?.name ?? 'Organizer'} · {relativeTime(feedback.at)}
              </p>
            </div>
          )}
          {mode === 'participant' && !s.canUpload && s.uploadBlockedReason && <p className="mt-1.5 text-xs text-paper-3">{s.uploadBlockedReason}</p>}
          {mode === 'participant' && s.canUpload && s.status === 'approved' && (
            <p className="mt-1.5 text-xs text-paper-3">Replacing an approved file sends it back for review{d.participation.approvalRequired ? ' and needs a new participation approval' : ''}.</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {doc && d.storageAvailable && (
            <>
              <a href={fileUrl(doc.id, { inline: true })} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-line px-2.5 text-[13px] text-paper-2 hover:border-line-strong hover:text-paper">
                <ExternalLink className="size-3.5" aria-hidden /> Open<span className="sr-only"> {requirement.name} for {who}</span>
              </a>
              <a href={fileUrl(doc.id)} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-line px-2.5 text-[13px] text-paper-2 hover:border-line-strong hover:text-paper">
                <Download className="size-3.5" aria-hidden /> Download<span className="sr-only"> {requirement.name} for {who}</span>
              </a>
            </>
          )}
          {mode === 'participant' && s.canUpload && <UploadButton slot={s} requirement={requirement} d={d} who={who} onDone={onDone} />}
          {mode === 'organizer' && doc && !closed && <ReviewActions slot={s} who={who} requirement={requirement} onDone={onDone} onStale={onStale} />}
        </div>
      </div>
      {doc && (doc.history.length > 1 || doc.previousVersions.length > 0 || doc.history.some((h) => h.action === 'commented')) && <HistoryList doc={doc} />}
    </li>
  );
}

function UploadButton({ slot, requirement, d, who, onDone }: { slot: DocumentSlotDTO; requirement: DocumentRequirementDTO; d: RegistrationDocumentsDTO; who: string; onDone: (d: RegistrationDocumentsDTO) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const replacing = slot.status !== 'missing';
  const pick = async (file: File) => {
    if (file.size > d.maxBytes) {
      toast({ tone: 'bad', title: 'File too large', body: `${file.name} is ${megabytes(file.size)}. Upload a ${formatList(requirement.formats)} up to ${megabytes(d.maxBytes)}.` });
      return;
    }
    const body = new FormData();
    body.append('file', file);
    setBusy(true);
    try {
      const next = await api<RegistrationDocumentsDTO>(`/registrations/${d.registrationId}/documents/${encodeURIComponent(slot.slot)}`, { method: 'POST', body });
      onDone(next);
      toast({ tone: 'ok', title: replacing ? 'New version uploaded' : 'Document uploaded', body: requirement.reviewRequired ? 'The organizers will review it.' : undefined });
    } catch (err) {
      toast({ tone: 'bad', title: 'Upload failed', body: errorMessage(err) });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={requirement.formats.map((f) => ACCEPT[f]).join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-label={`${requirement.name} file for ${who}`}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pick(f);
        }}
      />
      <Button size="sm" variant={replacing ? 'secondary' : 'primary'} loading={busy} icon={<FileUp className="size-3.5" />} onClick={() => input.current?.click()}>
        {replacing ? 'Replace file' : 'Upload'}
        <span className="sr-only"> {requirement.name}</span>
      </Button>
    </>
  );
}

type ReviewAction = 'approve' | 'request_changes' | 'reject' | 'comment';

function ReviewActions({ slot, who, requirement, onDone, onStale }: { slot: DocumentSlotDTO; who: string; requirement: DocumentRequirementDTO; onDone: (d: RegistrationDocumentsDTO) => void; onStale: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<Exclude<ReviewAction, 'approve'> | null>(null);
  const doc = slot.document!;
  const send = async (action: ReviewAction, note = '') => {
    try {
      const next = await api<RegistrationDocumentsDTO>(`/documents/${doc.id}/review`, {
        method: 'POST',
        body: { action, note, version: doc.version, expectedStatus: slot.status },
      });
      onDone(next);
      toast({ tone: 'ok', title: { approve: 'Document approved', request_changes: 'Changes requested', reject: 'Document rejected', comment: 'Comment added' }[action] });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) onStale();
      throw err;
    }
  };
  const text = {
    request_changes: { title: 'Ask for a corrected document?', label: 'What needs to change', confirm: 'Request changes', body: `${who} can upload a corrected file, even after the deadline. They see your note.` },
    reject: { title: 'Reject this document?', label: 'Why it can’t be accepted', confirm: 'Reject document', body: `${who} needs to upload a different file. They see your note.` },
    comment: { title: 'Add a comment', label: 'Comment (shown to the participant)', confirm: 'Add comment', body: 'Adds a note to this document’s history without changing its status.' },
  } as const;
  return (
    <>
      {slot.status !== 'approved' && (
        <Button
          size="sm"
          variant="primary"
          loading={busy}
          icon={<Check className="size-3.5" />}
          onClick={async () => {
            setBusy(true);
            try {
              await send('approve');
            } catch (err) {
              toast({ tone: 'bad', title: 'Not approved', body: errorMessage(err) });
            } finally {
              setBusy(false);
            }
          }}
        >
          Approve<span className="sr-only"> {requirement.name} for {who}</span>
        </Button>
      )}
      {slot.status !== 'changes_requested' && (
        <Button size="sm" icon={<FilePen className="size-3.5" />} onClick={() => setAsk('request_changes')}>
          Request changes<span className="sr-only"> to {requirement.name} for {who}</span>
        </Button>
      )}
      {slot.status !== 'rejected' && (
        <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => setAsk('reject')}>
          Reject<span className="sr-only"> {requirement.name} for {who}</span>
        </Button>
      )}
      <Button size="sm" variant="ghost" icon={<MessageSquare className="size-3.5" />} onClick={() => setAsk('comment')}>
        <span className="sr-only">Comment on {requirement.name} for {who}</span>
        <span aria-hidden>Comment</span>
      </Button>
      <ConfirmDialog
        open={ask !== null}
        onClose={() => setAsk(null)}
        tone={ask === 'comment' ? 'primary' : 'danger'}
        title={ask ? text[ask].title : ''}
        description={ask ? text[ask].body : ''}
        confirmLabel={ask ? text[ask].confirm : ''}
        reason={ask ? { label: text[ask].label, required: true, minLength: 3 } : undefined}
        onConfirm={(note) => send(ask!, note)}
      />
    </>
  );
}

const HISTORY_LABEL = {
  submitted: 'Submitted',
  replaced: 'Replaced with a new version',
  approved: 'Approved',
  changes_requested: 'Changes requested',
  rejected: 'Rejected',
  commented: 'Comment',
} as const;

function HistoryList({ doc }: { doc: NonNullable<DocumentSlotDTO['document']> }) {
  const fmt = useFormat();
  return (
    <details className="group mt-3">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs text-paper-3 hover:text-paper">
        <History className="size-3.5" aria-hidden /> History · {doc.history.length} {doc.history.length === 1 ? 'entry' : 'entries'}
      </summary>
      <ol className="mt-2 space-y-1.5 border-l border-line pl-3">
        {[...doc.history].reverse().map((h, i) => (
          <li key={`${h.at}-${i}`} className="text-xs">
            <span className={clsx('text-paper-2', h.action === 'approved' && 'text-ok', (h.action === 'rejected' || h.action === 'changes_requested') && 'text-warn')}>
              {HISTORY_LABEL[h.action]}
            </span>
            <span className="text-paper-3">
              {' '}
              · v{h.version} · {h.by?.name ?? 'Unknown'} · {fmt.dateTime(h.at)}
            </span>
            {h.note && <span className="block text-paper-2">“{h.note}”</span>}
          </li>
        ))}
      </ol>
      {doc.previousVersions.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-paper-3">Earlier versions (kept for the record)</p>
          <ul className="mt-1 space-y-1">
            {doc.previousVersions.map((v) => (
              <li key={v.version} className="text-xs">
                <a href={fileUrl(doc.id, { version: v.version })} className="text-paper-2 underline decoration-line-strong underline-offset-4 hover:text-paper">
                  v{v.version} · {v.name}
                </a>
                <span className="text-paper-3">
                  {' '}
                  · {size(v.size)} · {fmt.dateTime(v.uploadedAt)} · was {LABELS.documentStatus[v.statusWhenReplaced].toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </details>
  );
}
