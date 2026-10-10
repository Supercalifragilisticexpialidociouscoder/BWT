import { useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Copy, Crown, Link2, QrCode, RefreshCw, UserMinus } from 'lucide-react';
import { formatMoney, LABELS, type RegistrationDTO } from '@campusflow/shared';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useFormat, relativeTime } from '../../lib/format';
import { Button, ButtonLink } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/Dialog';
import { Field, FormAlert, Input } from '../../components/ui/Form';
import { ErrorState, LoadingBlock } from '../../components/ui/Feedback';
import { StatusPill } from '../../components/ui/Status';
import { useToast } from '../../components/ui/Toast';
import { NotFound } from '../../router';
import { useSession } from '../../lib/session';
import { RegistrationProgress } from './Progress';
import { RegistrationDocuments } from '../documents/RegistrationDocuments';

export function useRegistration(id: string | undefined) {
  return useQuery({ queryKey: ['registration', id], queryFn: () => api<RegistrationDTO>(`/registrations/${id}`), enabled: Boolean(id) });
}

export function RegistrationPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const q = useRegistration(id);
  const fmt = useFormat();
  const qc = useQueryClient();
  const toast = useToast();
  const [cancelOpen, setCancelOpen] = useState(false);
  const { user } = useSession();

  const apply = (reg: RegistrationDTO | undefined) => {
    if (reg) qc.setQueryData(['registration', reg.id], reg);
    qc.invalidateQueries({ queryKey: ['me'] });
  };

  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 404) return <NotFound title="Registration not found" body="It may belong to someone else, or the link is incomplete." />;
    return (
      <main id="main" className="mx-auto max-w-3xl px-[var(--gutter)] py-16">
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </main>
    );
  }
  if (!q.data) {
    return (
      <main id="main" className="mx-auto max-w-3xl px-[var(--gutter)] py-16">
        <LoadingBlock />
      </main>
    );
  }
  const r = q.data;
  const closed = r.status === 'cancelled' || r.status === 'rejected';
  const myTicket = r.participants.find((p) => p.id === user?.id)?.ticket ?? null;

  return (
    <main id="main" className="mx-auto max-w-[1100px] px-[var(--gutter)] py-10">
      <Link to="/me" className="inline-flex items-center gap-1.5 text-sm text-paper-3 hover:text-paper">
        <ArrowLeft className="size-4" /> Your events
      </Link>

      {(params.get('welcome') || params.get('joined')) && !closed && (
        <div className="mt-6 animate-rise rounded-[var(--radius-md)] border border-signal/40 bg-signal/[0.06] px-5 py-4 text-sm">
          <p className="font-medium text-paper">{params.get('joined') ? `You’re in ${r.team?.name}.` : 'You’re registered.'}</p>
          <p className="mt-0.5 text-paper-2">{r.statusReason || 'Your ticket is ready below.'}</p>
        </div>
      )}

      <header className="mt-6 flex flex-col gap-5 border-b border-line pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="kicker text-paper-3">
            Registration <span className="font-mono normal-case tracking-normal text-paper-2">{r.code}</span>
          </p>
          <h1 className="display-md mt-2">
            <Link to={`/events/${r.event.slug}`} className="hover:underline hover:decoration-1 hover:underline-offset-4">
              {r.event.title}
            </Link>
          </h1>
          <p className="mt-2 text-sm text-paper-2">{fmt.range(r.event.startsAt, r.event.endsAt)}</p>
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <StatusPill kind="registration" value={r.status} size="md" />
          {r.statusReason && <p className="max-w-xs text-sm text-paper-3 sm:text-right">{r.statusReason}</p>}
        </div>
      </header>

      <div className="mt-8">
        <RegistrationProgress registration={r} />
      </div>

      <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-12">
          {r.kind === 'team' && r.team && <TeamSection r={r} onChange={apply} />}
          {r.payment.required && <PaymentSection r={r} onChange={apply} />}
          <RegistrationDocuments
            registrationId={r.id}
            eventId={r.event.id}
            mode="participant"
            closed={closed}
            heading={(content) => content && <Section title="Documents & participation approval">{content}</Section>}
          />
          {r.approval.required && (
            <Section title="Organizer review">
              <p className="text-sm text-paper-2">
                {r.approval.decidedAt
                  ? `${r.status === 'rejected' ? 'Declined' : 'Approved'} by ${r.approval.decidedBy?.name ?? 'an organizer'} ${relativeTime(r.approval.decidedAt)}.${r.approval.note ? ` “${r.approval.note}”` : ''}`
                  : 'Organizers review registrations for this event before confirming them. You’ll see the decision here.'}
              </p>
            </Section>
          )}
          {!closed && (r.viewer.isLeader || r.kind === 'individual') && (
            <Section title="Cancel">
              <p className="mb-4 text-sm text-paper-2">
                {r.kind === 'team'
                  ? 'Cancelling withdraws the whole team, frees the slot and voids every member’s ticket.'
                  : 'Cancelling frees your place and voids your ticket.'}
                {r.payment.status === 'verified' && ' Refunds are handled by the organizers outside CAMPUSFLOW.'}
              </p>
              <Button variant="danger" onClick={() => setCancelOpen(true)}>
                Cancel registration
              </Button>
              <ConfirmDialog
                open={cancelOpen}
                onClose={() => setCancelOpen(false)}
                title="Cancel this registration?"
                description={`${r.event.title} · ${r.code}. This cannot be undone; you would need to register again.`}
                confirmLabel="Cancel registration"
                reason={{ label: 'Reason (optional)', placeholder: 'Shared with the organizers' }}
                onConfirm={async (reason) => {
                  const reg = await api<RegistrationDTO>(`/registrations/${r.id}/cancel`, { method: 'POST', body: { reason } });
                  apply(reg);
                  toast({ tone: 'info', title: 'Registration cancelled' });
                }}
              />
            </Section>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-[var(--radius-md)] border border-line bg-ink-900 p-5">
            <p className="kicker text-paper-3">Your ticket</p>
            {myTicket && myTicket.status !== 'void' ? (
              <>
                <p className="mt-3 font-mono text-2xl tracking-[0.18em] text-paper">{myTicket.shortCode}</p>
                <div className="mt-2">
                  <StatusPill kind="ticket" value={myTicket.status} />
                  {myTicket.checkedInAt && <span className="ml-2 text-xs text-paper-3">{fmt.time(myTicket.checkedInAt)}</span>}
                </div>
                <ButtonLink to={`/me/tickets/${myTicket.id}`} variant="primary" className="mt-4 w-full" icon={<QrCode className="size-4" />}>
                  Show QR ticket
                </ButtonLink>
              </>
            ) : (
              <p className="mt-3 text-sm text-paper-2">
                {closed ? 'No ticket — this registration is closed.' : 'Your ticket appears here once the registration is confirmed.'}
              </p>
            )}
          </div>
          <div className="rounded-[var(--radius-md)] border border-line px-5 py-4 text-xs text-paper-3">
            Registered {fmt.dateTime(r.createdAt)}
            {r.source === 'import' && ' · imported by organizers'}
          </div>
        </aside>
      </div>
    </main>
  );
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section>
      <div className="mb-4 flex items-center justify-between border-b border-line pb-2">
        <h2 className="kicker text-paper-3">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function TeamSection({ r, onChange }: { r: RegistrationDTO; onChange: (reg: RegistrationDTO | undefined) => void }) {
  const team = r.team!;
  const fmt = useFormat();
  const { user } = useSession();
  const toast = useToast();
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'remove' | 'leave' | 'leader'; userId: string; name: string } | null>(null);
  const closed = r.status === 'cancelled' || r.status === 'rejected';
  const leader = r.viewer.isLeader;
  const pretty = team.code ? `${team.code.slice(0, 4)}-${team.code.slice(4)}` : null;
  const rotate = useMutation({
    mutationFn: () => api<RegistrationDTO>(`/teams/${team.id}/rotate-code`, { method: 'POST' }),
    onSuccess: (reg) => {
      onChange(reg);
      toast({ tone: 'ok', title: 'New team code created', body: 'The old code no longer works.' });
    },
    onError: (err) => toast({ tone: 'bad', title: 'Couldn’t replace the code', body: errorMessage(err) }),
  });
  const copy = async (what: 'code' | 'link') => {
    const text = what === 'code' ? pretty! : `${window.location.origin}/join?code=${team.code}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      toast({ tone: 'info', title: text });
    }
  };

  return (
    <Section title={`Team · ${team.memberCount} of ${r.event.teamSize.max}`}>
      <p className="display-sm">{team.name}</p>
      {pretty && !closed && (
        <div className="mt-5 flex flex-col gap-4 rounded-[var(--radius-md)] border border-dashed border-line-strong p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs text-paper-3">Join code — share it with teammates</p>
            <p className="mt-1 font-mono text-3xl tracking-[0.22em] text-paper">{pretty}</p>
            <p className="mt-1 text-xs text-paper-3">Valid until {fmt.dateTime(team.codeExpiresAt!)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => copy('code')} icon={copied === 'code' ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}>
              {copied === 'code' ? 'Copied' : 'Copy code'}
            </Button>
            <Button size="sm" onClick={() => copy('link')} icon={copied === 'link' ? <Check className="size-3.5 text-ok" /> : <Link2 className="size-3.5" />}>
              {copied === 'link' ? 'Copied' : 'Copy invite link'}
            </Button>
            {leader && (
              <Button size="sm" variant="ghost" loading={rotate.isPending} onClick={() => rotate.mutate()} icon={<RefreshCw className="size-3.5" />}>
                New code
              </Button>
            )}
          </div>
        </div>
      )}
      <ul className="mt-6 divide-y divide-line border-y border-line">
        {r.participants.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-paper">
                {p.name}
                {p.isLeader && (
                  <span className="kicker inline-flex items-center gap-1 !text-[10px] text-signal">
                    <Crown className="size-3" /> Leader
                  </span>
                )}
              </p>
              <p className="text-xs text-paper-3">{[p.department, p.rollNumber].filter(Boolean).join(' · ') || '—'}</p>
            </div>
            <div className="flex items-center gap-2">
              {p.ticket && <StatusPill kind="ticket" value={p.ticket.status} />}
              {!closed && leader && !p.isLeader && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'leader', userId: p.id, name: p.name })} icon={<Crown className="size-3.5" />}>
                    Make leader
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'remove', userId: p.id, name: p.name })} icon={<UserMinus className="size-3.5" />}>
                    Remove
                  </Button>
                </>
              )}
              {!closed && !leader && p.id === user?.id && (
                <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'leave', userId: p.id, name: p.name })}>
                  Leave team
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {confirm && (
        <ConfirmDialog
          open
          onClose={() => setConfirm(null)}
          tone={confirm.kind === 'leader' ? 'primary' : 'danger'}
          title={confirm.kind === 'leader' ? `Make ${confirm.name} the leader?` : confirm.kind === 'leave' ? 'Leave this team?' : `Remove ${confirm.name}?`}
          description={
            confirm.kind === 'leader'
              ? 'They will manage the team, submit the payment reference and be the contact for organizers. You stay a member.'
              : confirm.kind === 'leave'
                ? 'Your ticket for this event will be voided. You can join another team while registration is open.'
                : 'Their ticket will be voided. They can rejoin with the code while it is valid.'
          }
          confirmLabel={confirm.kind === 'leader' ? 'Transfer leadership' : confirm.kind === 'leave' ? 'Leave team' : 'Remove member'}
          onConfirm={async () => {
            if (confirm.kind === 'leader') {
              onChange(await api<RegistrationDTO>(`/teams/${team.id}/leader`, { method: 'POST', body: { userId: confirm.userId } }));
            } else {
              const reg = await api<RegistrationDTO | undefined>(`/teams/${team.id}/members/${confirm.userId}`, { method: 'DELETE' });
              onChange(reg);
              if (confirm.kind === 'leave') window.location.assign('/me');
            }
          }}
        />
      )}
    </Section>
  );
}

function PaymentSection({ r, onChange }: { r: RegistrationDTO; onChange: (reg: RegistrationDTO) => void }) {
  const fmt = useFormat();
  const toast = useToast();
  const p = r.payment;
  const canSubmit = r.viewer.isLeader && (p.status === 'pending' || p.status === 'rejected') && r.status !== 'cancelled' && r.status !== 'rejected';
  const [editing, setEditing] = useState(!p.reference || p.status === 'rejected');
  const [reference, setReference] = useState('');
  const [payerName, setPayerName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = useMutation({
    mutationFn: () => api<RegistrationDTO>(`/registrations/${r.id}/payment`, { method: 'POST', body: { reference, payerName, note: '' } }),
    onSuccess: (reg) => {
      onChange(reg);
      setEditing(false);
      setErrors({});
      toast({ tone: 'ok', title: 'Reference submitted', body: 'Organizers will verify it against their account.' });
    },
    onError: (err) => setErrors(err instanceof ApiError ? { ...err.fields, _: Object.keys(err.fields).length ? '' : err.message } : { _: errorMessage(err) }),
  });

  return (
    <Section title="Payment">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs text-paper-3">Amount</p>
          <p className="mt-1 text-2xl font-semibold">{formatMoney(p.amountDue, p.currency)}</p>
          <p className="text-xs text-paper-3">{r.event.fee.basis === 'per_participant' ? `${LABELS.feeBasis.per_participant} × ${r.participants.length}` : r.kind === 'team' ? 'per team' : ''}</p>
        </div>
        <div>
          <p className="text-xs text-paper-3">Status</p>
          <div className="mt-1.5">
            <StatusPill kind="payment" value={p.status} size="md" label={p.status === 'pending' ? (p.reference ? 'Awaiting verification' : 'Awaiting reference') : undefined} />
          </div>
          {p.decidedAt && (
            <p className="mt-1 text-xs text-paper-3">
              by {p.decidedBy?.name ?? 'organizer'} · {fmt.dateTime(p.decidedAt)}
            </p>
          )}
        </div>
        {p.reference && (
          <div>
            <p className="text-xs text-paper-3">Reference</p>
            <p className="mt-1 font-mono text-paper">{p.reference}</p>
            {p.submittedAt && <p className="text-xs text-paper-3">submitted {relativeTime(p.submittedAt)}</p>}
          </div>
        )}
      </div>
      {p.status === 'rejected' && p.note && (
        <div className="mt-4">
          <FormAlert>Rejected: {p.note}</FormAlert>
        </div>
      )}
      {r.event.paymentInstructions && p.status !== 'verified' && (
        <p className="mt-5 rounded-[var(--radius-sm)] bg-ink-900 px-4 py-3 text-sm text-paper-2">{r.event.paymentInstructions}</p>
      )}
      {canSubmit && editing && (
        <form
          className="mt-5 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate();
          }}
        >
          <Field label="Transaction reference (UTR)" required error={errors.reference}>
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} value={reference} onChange={(e) => setReference(e.target.value)} className="font-mono" placeholder="e.g. 412345678901" />}
          </Field>
          <Field label="Paid by (optional)" error={errors.payerName}>
            {({ id }) => <Input id={id} value={payerName} onChange={(e) => setPayerName(e.target.value)} placeholder="Name on the payment" />}
          </Field>
          <Button type="submit" variant="primary" loading={submit.isPending} disabled={reference.trim().length < 4}>
            Submit reference
          </Button>
          {errors._ && (
            <div className="sm:col-span-3">
              <FormAlert>{errors._}</FormAlert>
            </div>
          )}
        </form>
      )}
      {canSubmit && !editing && (
        <Button className="mt-4" size="sm" variant="ghost" onClick={() => setEditing(true)}>
          Correct the reference
        </Button>
      )}
      {!r.viewer.isLeader && p.status !== 'verified' && p.required && <p className="mt-4 text-sm text-paper-3">Your team leader submits the payment reference.</p>}
    </Section>
  );
}
