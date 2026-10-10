import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleAlert, Download, FileUp, Info, RotateCcw, TriangleAlert } from 'lucide-react';
import clsx from 'clsx';
import {
  IMPORT_FIELDS,
  LABELS,
  type ImportAnalysisDTO,
  type ImportBatchDTO,
  type ImportField,
  type ImportIssueDTO,
  type ImportResultDTO,
  type ImportUploadDTO,
  type WorkspaceEventDTO,
} from '@campusflow/shared';
import { api, errorMessage } from '../../lib/api';
import { useFormat, relativeTime } from '../../lib/format';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Checkbox, FormAlert, Select } from '../../components/ui/Form';
import { ConfirmDialog } from '../../components/ui/Dialog';
import { PageHeader } from '../../components/ui/Feedback';
import { StatusPill } from '../../components/ui/Status';
import { EventScoped } from './RegistrationsPage';

type Step = 'upload' | 'map' | 'review' | 'done';

export function ImportPage() {
  return <EventScoped>{(event) => <Importer key={event.id} event={event} />}</EventScoped>;
}

function Importer({ event }: { event: WorkspaceEventDTO }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>('upload');
  const [upload, setUpload] = useState<ImportUploadDTO | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<ImportField, string | null>>>({});
  const [layout, setLayout] = useState<'auto' | 'per_participant' | 'per_registration'>('auto');
  const [paidVerified, setPaidVerified] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [analysis, setAnalysis] = useState<ImportAnalysisDTO | null>(null);
  const [result, setResult] = useState<ImportResultDTO | null>(null);
  const [confirming, setConfirming] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const history = useQuery({ queryKey: ['imports', event.id], queryFn: () => api<ImportBatchDTO[]>(`/events/${event.id}/imports`) });

  const send = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return api<ImportUploadDTO>(`/events/${event.id}/imports`, { method: 'POST', body });
    },
    onSuccess: (u) => {
      setUpload(u);
      setMapping(u.suggestedMapping);
      setLayout('auto');
      setDecisions({});
      setAnalysis(null);
      setStep('map');
    },
  });
  const body = () => ({ mapping, options: { layout, treatPaidAsVerified: paidVerified }, decisions });
  const analyze = useMutation({
    mutationFn: () => api<ImportAnalysisDTO>(`/events/${event.id}/imports/${upload!.batchId}/analyze`, { method: 'POST', body: body() }),
    onSuccess: (a) => {
      setAnalysis(a);
      setStep('review');
    },
  });
  // Decisions change the preview, so re-run the (server-side) analysis when they do.
  useEffect(() => {
    if (step === 'review' && Object.keys(decisions).length) analyze.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decisions]);
  const commit = useMutation({
    mutationFn: () => api<ImportResultDTO>(`/events/${event.id}/imports/${upload!.batchId}/commit`, { method: 'POST', body: body() }),
    onSuccess: (r) => {
      setResult(r);
      setStep('done');
      qc.invalidateQueries({ queryKey: ['registrations', event.id] });
      qc.invalidateQueries({ queryKey: ['imports', event.id] });
      qc.invalidateQueries({ queryKey: ['workspace'] });
    },
  });
  const reset = () => {
    setStep('upload');
    setUpload(null);
    setAnalysis(null);
    setResult(null);
    setDecisions({});
    send.reset();
    analyze.reset();
    commit.reset();
  };

  const steps: [Step, string][] = [
    ['upload', 'File'],
    ['map', 'Columns'],
    ['review', 'Review'],
    ['done', 'Result'],
  ];
  const stepIdx = steps.findIndex(([s]) => s === step);

  return (
    <div className="space-y-8">
      <PageHeader
        kicker={event.title}
        title="Import registrations"
        description="Bring in an existing export (for example from a form tool). Nothing is written until you confirm, and re-importing the same file never creates duplicates."
      />
      <ol className="flex gap-2" aria-label="Import steps">
        {steps.map(([s, label], i) => (
          <li key={s} className="flex-1" aria-current={i === stepIdx ? 'step' : undefined}>
            <div className={clsx('h-[3px] rounded-full', i <= stepIdx ? 'bg-signal' : 'bg-ink-700')} />
            <p className={clsx('mt-2 text-xs', i === stepIdx ? 'text-paper' : 'text-paper-3')}>
              <span className="tnum font-mono">{String(i + 1).padStart(2, '0')}</span> {label}
            </p>
          </li>
        ))}
      </ol>

      {step === 'upload' && (
        <section className="space-y-5">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) send.mutate(f);
            }}
            className="flex flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] border border-dashed border-line-strong px-6 py-14 text-center"
          >
            <FileUp className="size-8 text-paper-3" aria-hidden />
            <p className="text-paper">Drop a CSV file here</p>
            <p className="text-sm text-paper-3">Up to 2 MB and 5,000 rows. One row per participant, or one row per team with “Member 2 Name”-style columns.</p>
            <input ref={fileInput} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && send.mutate(e.target.files[0])} />
            <Button variant="primary" loading={send.isPending} onClick={() => fileInput.current?.click()}>
              Choose file
            </Button>
            <a href="/samples/registration-export-sample.csv" download className="inline-flex items-center gap-1 text-xs text-paper-3 underline decoration-line-strong underline-offset-4 hover:text-paper">
              <Download className="size-3" /> Sample export with deliberate problems
            </a>
          </div>
          {send.isError && <FormAlert>{errorMessage(send.error)}</FormAlert>}
        </section>
      )}

      {step === 'map' && upload && (
        <section className="space-y-6">
          <p className="text-sm text-paper-2">
            <span className="text-paper">{upload.filename}</span> · {upload.rowCount} rows · {upload.headers.length} columns
            {upload.memberColumnGroups > 0 && ` · ${upload.memberColumnGroups} member column groups detected`}
          </p>
          {upload.previousImportOfSameFile && (
            <FormAlert tone="info">
              This exact file was already imported {upload.previousImportOfSameFile.committedAt ? relativeTime(upload.previousImportOfSameFile.committedAt) : 'before'}. Re-importing only applies differences — existing registrations are matched, not duplicated.
            </FormAlert>
          )}
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {IMPORT_FIELDS.map((f) => (
              <label key={f} className="grid grid-cols-[150px_1fr] items-center gap-3 text-[13px]">
                <span className={clsx(f === 'name' || f === 'email' ? 'text-paper' : 'text-paper-2')}>
                  {LABELS.importField[f]}
                  {(f === 'name' || f === 'email') && <span className="text-paper-3"> *</span>}
                </span>
                <Select className="!py-1.5 !text-[13px]" value={mapping[f] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value || null }))}>
                  <option value="">— not in file —</option>
                  {upload.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </Select>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-3 text-[13px] text-paper-2">
              Layout
              <Select className="!w-auto !py-1.5 !text-[13px]" value={layout} onChange={(e) => setLayout(e.target.value as typeof layout)}>
                <option value="auto">Detect ({upload.detectedLayout === 'per_registration' ? 'one row per team' : 'one row per person'})</option>
                <option value="per_participant">One row per person</option>
                <option value="per_registration">One row per team / registration</option>
              </Select>
            </label>
            <Checkbox
              checked={paidVerified}
              onChange={(e) => setPaidVerified(e.target.checked)}
              label="Treat rows marked “paid” as verified"
              hint="Only if you already checked these payments; otherwise they arrive as awaiting verification."
            />
          </div>
          <details className="rounded-[var(--radius-md)] border border-line">
            <summary className="cursor-pointer px-4 py-2.5 text-[13px] text-paper-2">First rows of the file</summary>
            <div className="overflow-x-auto border-t border-line">
              <table className="w-full text-left text-xs">
                <thead className="bg-ink-900 text-paper-3">
                  <tr>{upload.headers.map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {upload.sample.map((row, i) => (
                    <tr key={i}>{upload.headers.map((h) => <td key={h} className="whitespace-nowrap px-3 py-1.5 text-paper-2">{row[h]}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          {analyze.isError && <FormAlert>{errorMessage(analyze.error)}</FormAlert>}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={reset} icon={<RotateCcw className="size-4" />}>
              Different file
            </Button>
            <Button variant="primary" loading={analyze.isPending} onClick={() => analyze.mutate()}>
              Check the data
            </Button>
          </div>
        </section>
      )}

      {step === 'review' && analysis && (
        <section className="space-y-8">
          {analysis.alreadyCommittedAt && <FormAlert tone="info">This file was imported {relativeTime(analysis.alreadyCommittedAt)}; matching registrations show as unchanged.</FormAlert>}
          <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-[var(--radius-md)] border border-line bg-line sm:grid-cols-6">
            {(
              [
                ['New', analysis.totals.create, 'text-ok'],
                ['Updated', analysis.totals.update, 'text-info'],
                ['Unchanged', analysis.totals.unchanged, 'text-paper-2'],
                ['Skipped', analysis.totals.skip, analysis.totals.skip ? 'text-bad' : 'text-paper-2'],
                ['People', analysis.totals.participants, 'text-paper'],
                ['Rows', analysis.totals.rows, 'text-paper'],
              ] as const
            ).map(([k, v, c]) => (
              <div key={k} className="bg-ink-950 px-4 py-3">
                <dt className="text-xs text-paper-3">{k}</dt>
                <dd className={clsx('tnum text-2xl font-semibold', c)}>{v}</dd>
              </div>
            ))}
          </dl>

          {analysis.issues.length > 0 && (
            <div className="space-y-3">
              <h2 className="display-sm">
                {analysis.totals.reviews > 0 ? 'Decide, then review the warnings' : 'Problems found'}
                <span className="ml-3 align-middle text-sm text-paper-3">
                  {analysis.totals.errors} errors · {analysis.totals.warnings} warnings · {analysis.totals.reviews} need a decision
                </span>
              </h2>
              <ul className="divide-y divide-line rounded-[var(--radius-md)] border border-line">
                {[...analysis.issues]
                  .sort((a, b) => ['review', 'error', 'warning'].indexOf(a.severity) - ['review', 'error', 'warning'].indexOf(b.severity))
                  .map((issue, i) => (
                    <IssueRow key={i} issue={issue} decision={issue.review ? decisions[issue.review.id] : undefined} onDecide={(v) => setDecisions((d) => ({ ...d, [issue.review!.id]: v }))} />
                  ))}
              </ul>
            </div>
          )}

          <div>
            <h2 className="display-sm mb-3">Preview</h2>
            <div className="max-h-[480px] overflow-auto rounded-[var(--radius-md)] border border-line">
              <table className="w-full min-w-[760px] text-left text-[13px]">
                <thead className="kicker sticky top-0 border-b border-line bg-ink-900 text-paper-3">
                  <tr>
                    <th className="px-4 py-2 font-medium">Action</th>
                    <th className="px-4 py-2 font-medium">Registration</th>
                    <th className="px-4 py-2 font-medium">People</th>
                    <th className="px-4 py-2 font-medium">Payment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {analysis.registrations.map((r) => (
                    <tr key={r.key} className={clsx(r.action === 'skip' && 'opacity-60')}>
                      <td className="px-4 py-2.5">
                        <span className={clsx('kicker !text-[10px]', { create: 'text-ok', update: 'text-info', unchanged: 'text-paper-3', skip: 'text-bad' }[r.action])}>{r.action}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-paper">{r.teamName ?? r.participants[0]?.name}</span>
                        {r.externalId && <span className="block font-mono text-xs text-paper-3">{r.externalId}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-paper-2">
                        {r.participants.map((p) => (
                          <span key={p.email} className="block">
                            {p.name} <span className="text-paper-3">{p.email}</span>
                            {p.match === 'existing_user' && <span className="text-info"> · has account</span>}
                          </span>
                        ))}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusPill kind="payment" value={r.payment.status} />
                        {r.payment.reference && <span className="block font-mono text-xs text-paper-3">{r.payment.reference}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {analyze.isPending && <p className="text-sm text-paper-3">Updating preview…</p>}
          {commit.isError && <FormAlert>{errorMessage(commit.error)}</FormAlert>}
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" onClick={() => setStep('map')}>
              Back to columns
            </Button>
            <Button variant="primary" disabled={!analysis.canCommit || analyze.isPending} onClick={() => setConfirming(true)}>
              Import {analysis.totals.create + analysis.totals.update} registration{analysis.totals.create + analysis.totals.update === 1 ? '' : 's'}
            </Button>
            {!analysis.canCommit && (
              <span className="text-sm text-paper-3">
                {analysis.totals.reviews > Object.keys(decisions).length ? 'Make a decision on every highlighted item first.' : 'Nothing new to import.'}
              </span>
            )}
          </div>
        </section>
      )}

      {step === 'done' && result && (
        <section className="space-y-5">
          <div className="rounded-[var(--radius-lg)] border border-ok/40 bg-ok/5 p-6">
            <p className="flex items-center gap-2 text-lg text-paper">
              <Check className="size-5 text-ok" /> Import complete
            </p>
            <p className="tnum mt-2 text-sm text-paper-2">
              {result.created} created · {result.updated} updated · {result.unchanged} unchanged · {result.skipped} skipped · {result.usersCreated} new participant accounts · {result.ticketsIssued} tickets issued
            </p>
            <p className="mt-2 text-xs text-paper-3">Recorded in the event’s activity log. Imported people can claim their account by signing up with the same email.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ButtonLink to={`/workspace/registrations?event=${event.id}`} variant="primary">
              View registrations
            </ButtonLink>
            <a href={`/api/events/${event.id}/exports/registrations.csv`} className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-line bg-ink-800 px-4 text-sm hover:border-line-strong">
              <Download className="size-4" /> Export validated data
            </a>
            <Button variant="ghost" onClick={reset}>
              Import another file
            </Button>
          </div>
        </section>
      )}

      <section className="border-t border-line pt-8">
        <h2 className="kicker mb-3 text-paper-3">Import history</h2>
        {!history.data?.length ? (
          <p className="text-sm text-paper-3">No files imported for this event yet.</p>
        ) : (
          <ul className="divide-y divide-line text-[13px]">
            {history.data.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span>
                  <span className="text-paper">{b.filename}</span> <span className="text-paper-3">· {b.rowCount} rows · {b.uploadedBy?.name}</span>
                </span>
                <span className="text-paper-3">
                  {b.status === 'committed' && b.result
                    ? `${b.result.created} created · ${b.result.updated} updated · ${b.result.unchanged} unchanged · ${relativeTime(b.committedAt!)}`
                    : `not imported · uploaded ${relativeTime(b.createdAt)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        tone="primary"
        title="Write these registrations?"
        description={
          analysis
            ? `${analysis.totals.create} new and ${analysis.totals.update} updated registrations will be saved to “${event.title}”. ${analysis.totals.skip} with errors will be skipped. Existing members and verified payments are never removed or downgraded.`
            : ''
        }
        confirmLabel="Import now"
        onConfirm={async () => {
          await commit.mutateAsync();
        }}
      />
    </div>
  );
}

function IssueRow({ issue, decision, onDecide }: { issue: ImportIssueDTO; decision?: string; onDecide: (v: string) => void }) {
  const Icon = issue.severity === 'error' ? CircleAlert : issue.severity === 'review' ? Info : TriangleAlert;
  return (
    <li className={clsx('px-4 py-3', issue.severity === 'review' && !decision && 'bg-info/5')}>
      <div className="flex gap-3">
        <Icon className={clsx('mt-0.5 size-4 shrink-0', { error: 'text-bad', warning: 'text-warn', review: 'text-info' }[issue.severity])} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-paper">
            <span className="sr-only">{issue.severity}: </span>
            {issue.message}
          </p>
          {issue.rows.length > 0 && <p className="tnum text-xs text-paper-3">Row{issue.rows.length > 1 ? 's' : ''} {issue.rows.slice(0, 12).join(', ')}{issue.rows.length > 12 ? '…' : ''}</p>}
          {issue.review && (
            <fieldset className="mt-2 space-y-1">
              <legend className="sr-only">Decision</legend>
              {issue.review.options.map((o) => (
                <label key={o.value} className="flex cursor-pointer items-center gap-2 text-[13px] text-paper-2">
                  <input type="radio" name={issue.review!.id} className="accent-[var(--color-signal)]" checked={decision === o.value} onChange={() => onDecide(o.value)} />
                  {o.label}
                </label>
              ))}
            </fieldset>
          )}
        </div>
      </div>
    </li>
  );
}

