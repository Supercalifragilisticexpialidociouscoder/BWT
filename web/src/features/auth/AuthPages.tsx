import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { LoginSchema, SignupSchema, type LoginInput, type SessionDTO, type SignupInput } from '@campusflow/shared';
import { api } from '../../lib/api';
import { applyServerErrors } from '../../lib/forms';
import { sessionKey } from '../../lib/session';
import { useInstitutionRequired } from '../../lib/institution';
import { Button } from '../../components/ui/Button';
import { Field, FormAlert, Input, Select } from '../../components/ui/Form';

function safeNext(next: string | null): string {
  // Only allow same-site relative paths to avoid open redirects.
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/me';
}

function AuthFrame({ title, intro, children, aside }: { title: ReactNode; intro: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <main id="main" className="mx-auto grid min-h-[calc(100dvh-56px)] max-w-[1400px] gap-12 px-[var(--gutter)] py-12 lg:grid-cols-[1fr_minmax(0,460px)] lg:items-center lg:gap-24">
      <div className="hidden lg:block">
        <h1 className="display-lg max-w-xl">{title}</h1>
        <p className="mt-6 max-w-md text-paper-2">{intro}</p>
        {aside}
      </div>
      <div className="w-full">
        <h1 className="display-md mb-6 lg:hidden">{title}</h1>
        {children}
        {aside && <div className="lg:hidden">{aside}</div>}
      </div>
    </main>
  );
}

const DEMO = [
  ['Participant with a ticket', 'student@campusflow.demo'],
  ['Check-in volunteer', 'volunteer@campusflow.demo'],
  ['Organizer — club head', 'head.infin8@campusflow.demo'],
  ['Organizer — faculty', 'faculty.cse@campusflow.demo'],
  ['Platform admin', 'admin@campusflow.demo'],
] as const;

export function LoginPage() {
  const inst = useInstitutionRequired();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<LoginInput>({ resolver: zodResolver(LoginSchema), defaultValues: { email: '', password: '' } });
  const { register, handleSubmit, formState, setError, setValue } = form;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const session = await api<SessionDTO>('/auth/login', { method: 'POST', body: values });
      qc.setQueryData(sessionKey, session);
      const next = params.get('next');
      navigate(next ? safeNext(next) : session.access.canOrganize ? '/workspace' : session.access.staffEvents.length ? '/workspace' : '/me', { replace: true });
    } catch (err) {
      setFormError(applyServerErrors(err, setError, ['email', 'password']));
    }
  });

  return (
    <AuthFrame
      title={
        <>
          Welcome <span className="italic-accent">back.</span>
        </>
      }
      intro="Sign in to see your registrations and tickets, manage your team, or open the organizer workspace."
      aside={
        inst.isDemo ? (
          <div className="mt-12 max-w-md border-t border-line pt-6">
            <p className="kicker mb-3 text-paper-3">Demo accounts · password “campusflow-demo”</p>
            <ul className="space-y-1">
              {DEMO.map(([role, email]) => (
                <li key={email}>
                  <button
                    type="button"
                    onClick={() => {
                      setValue('email', email, { shouldValidate: true });
                      setValue('password', 'campusflow-demo', { shouldValidate: true });
                    }}
                    className="flex w-full items-baseline justify-between gap-4 rounded px-2 py-1.5 text-left text-sm hover:bg-ink-900"
                  >
                    <span className="text-paper-2">{role}</span>
                    <span className="font-mono text-xs text-paper-3">{email}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-5 rounded-[var(--radius-lg)] border border-line bg-ink-900 p-6 sm:p-8">
        <Field label="Email" error={formState.errors.email?.message} required>
          {({ id, describedBy, invalid }) => <Input id={id} type="email" autoComplete="email" aria-describedby={describedBy} aria-invalid={invalid} {...register('email')} />}
        </Field>
        <Field label="Password" error={formState.errors.password?.message} required>
          {({ id, describedBy, invalid }) => <Input id={id} type="password" autoComplete="current-password" aria-describedby={describedBy} aria-invalid={invalid} {...register('password')} />}
        </Field>
        <FormAlert>{formError}</FormAlert>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={formState.isSubmitting}>
          Sign in
        </Button>
        <p className="text-center text-sm text-paper-3">
          New here?{' '}
          <Link to={`/signup${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`} className="text-paper underline decoration-line-strong underline-offset-4 hover:decoration-paper">
            Create an account
          </Link>
        </p>
      </form>
    </AuthFrame>
  );
}

export function SignupPage() {
  const inst = useInstitutionRequired();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, formState, setError } = useForm<SignupInput>({
    resolver: zodResolver(SignupSchema),
    defaultValues: { name: '', email: '', password: '', department: undefined, rollNumber: undefined, phone: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const session = await api<SessionDTO>('/auth/signup', { method: 'POST', body: values });
      qc.setQueryData(sessionKey, session);
      navigate(safeNext(params.get('next')), { replace: true });
    } catch (err) {
      setFormError(applyServerErrors(err, setError, ['name', 'email', 'password', 'department', 'rollNumber', 'phone']));
    }
  });

  return (
    <AuthFrame
      title={
        <>
          One account for <span className="italic-accent">every</span> event.
        </>
      }
      intro={`Register for events at ${inst.name}, form teams with a code, and keep every ticket in one place. If an organizer imported your registration, sign up with the same email to claim it.`}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-5 rounded-[var(--radius-lg)] border border-line bg-ink-900 p-6 sm:p-8">
        <Field label="Full name" error={formState.errors.name?.message} required>
          {({ id, describedBy, invalid }) => <Input id={id} autoComplete="name" aria-describedby={describedBy} aria-invalid={invalid} {...register('name')} />}
        </Field>
        <Field label="College email" error={formState.errors.email?.message} required>
          {({ id, describedBy, invalid }) => <Input id={id} type="email" autoComplete="email" aria-describedby={describedBy} aria-invalid={invalid} {...register('email')} />}
        </Field>
        <Field label="Password" hint="At least 10 characters." error={formState.errors.password?.message} required>
          {({ id, describedBy, invalid }) => <Input id={id} type="password" autoComplete="new-password" aria-describedby={describedBy} aria-invalid={invalid} {...register('password')} />}
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Department" error={formState.errors.department?.message} required={inst.requirements.department}>
            {({ id, describedBy, invalid }) => (
              <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('department', { setValueAs: (v) => v || undefined })}>
                <option value="">Choose…</option>
                {inst.departments.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Roll number" error={formState.errors.rollNumber?.message} required={inst.requirements.rollNumber}>
            {({ id, describedBy, invalid }) => <Input id={id} autoCapitalize="characters" aria-describedby={describedBy} aria-invalid={invalid} {...register('rollNumber', { setValueAs: (v) => v || undefined })} />}
          </Field>
        </div>
        <Field label="Phone" hint={inst.requirements.phone ? undefined : 'Optional — shared only with organizers of events you join.'} error={formState.errors.phone?.message} required={inst.requirements.phone}>
          {({ id, describedBy, invalid }) => <Input id={id} type="tel" autoComplete="tel" aria-describedby={describedBy} aria-invalid={invalid} {...register('phone')} />}
        </Field>
        <FormAlert>{formError}</FormAlert>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={formState.isSubmitting}>
          Create account
        </Button>
        <p className="text-center text-sm text-paper-3">
          Already have an account?{' '}
          <Link to={`/login${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`} className="text-paper underline decoration-line-strong underline-offset-4 hover:decoration-paper">
            Sign in
          </Link>
        </p>
      </form>
    </AuthFrame>
  );
}
