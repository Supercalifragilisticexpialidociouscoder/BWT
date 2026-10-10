import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ArrowLeft, ArrowRight, Users } from 'lucide-react';
import { ProfileFieldsSchema, formatMoney, type RegistrationDTO } from '@campusflow/shared';
import { api } from '../../lib/api';
import { applyServerErrors } from '../../lib/forms';
import { useSession, sessionKey } from '../../lib/session';
import { useInstitutionRequired } from '../../lib/institution';
import { feeLabel, formatLabel, useFormat } from '../../lib/format';
import { useEventDetail } from '../public/EventPage';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Field, FormAlert, Input, Select } from '../../components/ui/Form';
import { ErrorState, LoadingBlock } from '../../components/ui/Feedback';
import { EventPoster } from '../../components/EventPoster';

const FormSchema = z.object({
  teamName: z.string().trim().max(60).optional(),
  profile: ProfileFieldsSchema,
});
type FormValues = z.input<typeof FormSchema>;

export function RegisterPage() {
  const { slug } = useParams();
  const event = useEventDetail(slug);
  const { user } = useSession();
  const inst = useInstitutionRequired();
  const fmt = useFormat();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  const { register, handleSubmit, formState, setError, reset } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { teamName: '', profile: { department: user?.department ?? undefined, rollNumber: user?.rollNumber ?? undefined, phone: user?.phone ?? '' } },
  });
  useEffect(() => {
    if (user) reset((v) => ({ ...v, profile: { department: user.department ?? undefined, rollNumber: user.rollNumber ?? undefined, phone: user.phone ?? '' } }));
  }, [user, reset]);

  if (event.isError) return <main id="main" className="mx-auto max-w-2xl px-[var(--gutter)] py-16"><ErrorState error={event.error} onRetry={() => event.refetch()} /></main>;
  if (!event.data) return <main id="main" className="mx-auto max-w-2xl px-[var(--gutter)] py-16"><LoadingBlock /></main>;
  const e = event.data;
  if (e.viewer.registrationId) return <Navigate to={`/me/registrations/${e.viewer.registrationId}`} replace />;

  const team = e.mode === 'team';
  const missingRequired = {
    department: inst.requirements.department && !user?.department,
    rollNumber: inst.requirements.rollNumber && !user?.rollNumber,
    phone: inst.requirements.phone && !user?.phone,
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    if (team && (!values.teamName || values.teamName.trim().length < 2)) {
      setError('teamName', { message: 'Give your team a name (2+ characters)' });
      return;
    }
    try {
      const reg = await api<RegistrationDTO>(team ? `/events/${e.id}/teams` : `/events/${e.id}/register`, {
        method: 'POST',
        body: team ? { name: values.teamName, profile: values.profile } : { profile: values.profile },
      });
      qc.setQueryData(['registration', reg.id], reg);
      qc.invalidateQueries({ queryKey: ['event', slug] });
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: sessionKey });
      navigate(`/me/registrations/${reg.id}?welcome=1`, { replace: true });
    } catch (err) {
      const msg = applyServerErrors(err, setError, ['teamName', 'name', 'profile.department', 'profile.rollNumber', 'profile.phone']);
      setFormError(msg);
    }
  });

  if (e.registrationState !== 'open') {
    return (
      <main id="main" className="mx-auto max-w-2xl px-[var(--gutter)] py-16">
        <h1 className="display-md">Registration isn’t open</h1>
        <p className="mt-3 text-paper-2">“{e.title}” is not accepting registrations right now.</p>
        <ButtonLink to={`/events/${e.slug}`} className="mt-6">
          Back to the event
        </ButtonLink>
      </main>
    );
  }

  return (
    <main id="main" className="mx-auto max-w-[1100px] px-[var(--gutter)] py-10">
      <Link to={`/events/${e.slug}`} className="inline-flex items-center gap-1.5 text-sm text-paper-3 hover:text-paper">
        <ArrowLeft className="size-4" /> {e.title}
      </Link>
      <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <form onSubmit={onSubmit} noValidate className="space-y-10">
          <header>
            <p className="kicker text-paper-3">{team ? 'Team registration' : 'Registration'}</p>
            <h1 className="display-md mt-2">{team ? 'Start your team' : `Register for ${e.title}`}</h1>
            {team && (
              <p className="mt-3 max-w-xl text-sm text-paper-2">
                You’ll be the team leader. After this step you get a join code to share; teammates sign in and join with it. The team counts as complete at {e.teamSize.min} member{e.teamSize.min === 1 ? '' : 's'}.
              </p>
            )}
          </header>

          <section aria-labelledby="s-details" className="space-y-5">
            <h2 id="s-details" className="flex items-baseline gap-3 border-b border-line pb-2">
              <span className="tnum font-mono text-xs text-paper-3">01</span>
              <span className="display-sm !text-lg">Your details</span>
            </h2>
            <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <p className="text-paper-3">Name</p>
              <p className="text-paper">{user?.name}</p>
              <p className="text-paper-3">Email</p>
              <p className="text-paper">{user?.email}</p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Department" required={inst.requirements.department} error={formState.errors.profile?.department?.message} hint={missingRequired.department ? 'Needed for this registration' : undefined}>
                {({ id, describedBy, invalid }) => (
                  <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('profile.department', { setValueAs: (v) => v || undefined })}>
                    <option value="">Choose…</option>
                    {inst.departments.map((d) => (
                      <option key={d.code} value={d.code}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Roll number" required={inst.requirements.rollNumber} error={formState.errors.profile?.rollNumber?.message}>
                {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('profile.rollNumber', { setValueAs: (v) => v || undefined })} />}
              </Field>
              <Field label="Phone" required={inst.requirements.phone} hint="Shared only with this event’s organizers." error={formState.errors.profile?.phone?.message}>
                {({ id, describedBy, invalid }) => <Input id={id} type="tel" aria-describedby={describedBy} aria-invalid={invalid} {...register('profile.phone')} />}
              </Field>
            </div>
            {e.allowedDepartments.length > 0 && (
              <p className="text-xs text-paper-3">This event is open to {e.allowedDepartments.join(', ')} only.</p>
            )}
          </section>

          {team && (
            <section aria-labelledby="s-team" className="space-y-5">
              <h2 id="s-team" className="flex items-baseline gap-3 border-b border-line pb-2">
                <span className="tnum font-mono text-xs text-paper-3">02</span>
                <span className="display-sm !text-lg">Your team</span>
              </h2>
              <Field label="Team name" required hint="Must be unique for this event." error={formState.errors.teamName?.message}>
                {({ id, describedBy, invalid }) => <Input id={id} maxLength={60} aria-describedby={describedBy} aria-invalid={invalid} {...register('teamName')} />}
              </Field>
              <p className="flex items-start gap-2 text-sm text-paper-2">
                <Users className="mt-0.5 size-4 shrink-0 text-paper-3" />
                Already have a teammate who created the team?{' '}
                <Link to="/join" className="text-paper underline decoration-line-strong underline-offset-4">
                  Join with their code instead
                </Link>
              </p>
            </section>
          )}

          <section aria-labelledby="s-review" className="space-y-4">
            <h2 id="s-review" className="flex items-baseline gap-3 border-b border-line pb-2">
              <span className="tnum font-mono text-xs text-paper-3">{team ? '03' : '02'}</span>
              <span className="display-sm !text-lg">What happens next</span>
            </h2>
            <ol className="space-y-2 text-sm text-paper-2">
              {team && <li>— Share your team code. Your registration is incomplete until the team reaches {e.teamSize.min}.</li>}
              {e.fee.amount > 0 && (
                <li>
                  — Pay {formatMoney(e.fee.amount, e.fee.currency)}
                  {e.fee.basis === 'per_participant' ? ' per person' : team ? ' for the team' : ''} and submit the transaction reference. Organizers verify it.
                </li>
              )}
              {e.requiresApproval && <li>— Organizers review each registration before confirming it.</li>}
              <li>— Once confirmed, every member gets their own QR ticket for entry.</li>
            </ol>
            <FormAlert>{formError}</FormAlert>
            <Button type="submit" variant="primary" size="lg" loading={formState.isSubmitting} iconRight={<ArrowRight className="size-4" />}>
              {team ? 'Create team & register' : 'Confirm registration'}
            </Button>
          </section>
        </form>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="overflow-hidden rounded-[var(--radius-md)] border border-line bg-ink-900">
            <EventPoster event={e} className="aspect-[16/9]" />
            <dl className="divide-y divide-line text-sm">
              {[
                ['When', fmt.range(e.startsAt, e.endsAt)],
                ['Format', formatLabel(e.mode, e.teamSize)],
                ['Fee', feeLabel(e.fee, e.mode)],
                ['Closes', fmt.dateTime(e.registrationDeadline)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 px-4 py-2.5">
                  <dt className="text-paper-3">{k}</dt>
                  <dd className="text-right text-paper">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </aside>
      </div>
    </main>
  );
}
