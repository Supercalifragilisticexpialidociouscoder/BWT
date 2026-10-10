import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Users } from 'lucide-react';
import { teamCodeField, type RegistrationDTO } from '@campusflow/shared';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useInstitutionRequired } from '../../lib/institution';
import { useFormat } from '../../lib/format';
import { Button } from '../../components/ui/Button';
import { Field, FormAlert, Input, Select } from '../../components/ui/Form';

interface Preview {
  team: { id: string; name: string; memberCount: number };
  event: { id: string; slug: string; title: string; teamSize: { min: number; max: number }; startsAt: string };
  joinable: boolean;
  reason: string;
}

export function JoinPage() {
  const [params, setParams] = useSearchParams();
  const [raw, setRaw] = useState(params.get('code') ?? '');
  const parsed = teamCodeField.safeParse(raw);
  const code = parsed.success ? parsed.data : null;
  const { user } = useSession();
  const inst = useInstitutionRequired();
  const fmt = useFormat();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [profile, setProfile] = useState({ department: user?.department ?? '', rollNumber: user?.rollNumber ?? '', phone: user?.phone ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (code) setParams({ code }, { replace: true });
  }, [code, setParams]);

  const preview = useQuery({
    queryKey: ['team-preview', code],
    queryFn: () => api<Preview>('/teams/preview', { query: { code: code! } }),
    enabled: Boolean(code),
    retry: false,
  });

  const needs = {
    department: inst.requirements.department && !user?.department,
    rollNumber: inst.requirements.rollNumber && !user?.rollNumber,
    phone: inst.requirements.phone && !user?.phone,
  };

  const join = async () => {
    if (!code) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const reg = await api<RegistrationDTO>('/teams/join', {
        method: 'POST',
        body: { code, profile: { department: profile.department || undefined, rollNumber: profile.rollNumber || undefined, phone: profile.phone || undefined } },
      });
      qc.setQueryData(['registration', reg.id], reg);
      qc.invalidateQueries({ queryKey: ['me'] });
      navigate(`/me/registrations/${reg.id}?joined=1`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setFieldErrors(err.fields);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main id="main" className="mx-auto max-w-xl px-[var(--gutter)] py-14">
      <p className="kicker text-paper-3">Join a team</p>
      <h1 className="display-md mt-2">Enter your team code</h1>
      <p className="mt-3 text-sm text-paper-2">Your team leader can see the code on their registration page. It looks like K7QF-4XM2.</p>

      <div className="mt-8">
        <Field label="Team code" error={raw && !code && raw.replace(/[\s-]/g, '').length >= 8 ? 'That doesn’t look like a team code' : undefined}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={raw}
              onChange={(e) => setRaw(e.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              maxLength={12}
              className="!font-mono !text-2xl !tracking-[0.25em] uppercase"
              placeholder="XXXX-XXXX"
            />
          )}
        </Field>
      </div>

      {code && preview.isPending && <p className="mt-6 text-sm text-paper-3">Looking up team…</p>}
      {code && preview.isError && (
        <div className="mt-6">
          <FormAlert>{preview.error instanceof ApiError && preview.error.status === 404 ? 'No active team uses that code. Check it with your team leader.' : errorMessage(preview.error)}</FormAlert>
        </div>
      )}
      {preview.data && (
        <section className="mt-8 rounded-[var(--radius-md)] border border-line bg-ink-900 p-5">
          <p className="kicker text-paper-3">{preview.data.event.title} · {fmt.shortDate(preview.data.event.startsAt)}</p>
          <p className="display-sm mt-2">{preview.data.team.name}</p>
          <p className="mt-1 flex items-center gap-2 text-sm text-paper-2">
            <Users className="size-4 text-paper-3" />
            {preview.data.team.memberCount} of {preview.data.event.teamSize.max} members
          </p>
          {!preview.data.joinable ? (
            <div className="mt-4">
              <FormAlert tone="warn">{preview.data.reason}</FormAlert>
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              {(needs.department || needs.rollNumber || needs.phone) && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {needs.department && (
                    <Field label="Department" required error={fieldErrors['profile.department']}>
                      {({ id }) => (
                        <Select id={id} value={profile.department} onChange={(e) => setProfile((p) => ({ ...p, department: e.target.value }))}>
                          <option value="">Choose…</option>
                          {inst.departments.map((d) => (
                            <option key={d.code} value={d.code}>
                              {d.name}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                  )}
                  {needs.rollNumber && (
                    <Field label="Roll number" required error={fieldErrors['profile.rollNumber']}>
                      {({ id }) => <Input id={id} value={profile.rollNumber} onChange={(e) => setProfile((p) => ({ ...p, rollNumber: e.target.value.toUpperCase() }))} />}
                    </Field>
                  )}
                  {needs.phone && (
                    <Field label="Phone" required error={fieldErrors['profile.phone']}>
                      {({ id }) => <Input id={id} type="tel" value={profile.phone} onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))} />}
                    </Field>
                  )}
                </div>
              )}
              <FormAlert>{error}</FormAlert>
              <Button variant="primary" size="lg" loading={busy} onClick={join} iconRight={<ArrowRight className="size-4" />}>
                Join {preview.data.team.name}
              </Button>
            </div>
          )}
        </section>
      )}
      <p className="mt-10 text-sm text-paper-3">
        Want to start your own team instead? Open the event from the{' '}
        <Link to="/events" className="text-paper underline decoration-line-strong underline-offset-4">
          directory
        </Link>{' '}
        and choose “Register a team”.
      </p>
    </main>
  );
}
