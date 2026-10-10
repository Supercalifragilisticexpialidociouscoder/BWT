import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { ChangePasswordSchema, ProfileUpdateSchema, type SessionDTO } from '@campusflow/shared';
import type { z } from 'zod';
import { api } from '../../lib/api';
import { applyServerErrors } from '../../lib/forms';
import { sessionKey, useSession } from '../../lib/session';
import { useInstitutionRequired } from '../../lib/institution';
import { Button } from '../../components/ui/Button';
import { Field, FormAlert, Input, Select } from '../../components/ui/Form';
import { useToast } from '../../components/ui/Toast';

export function ProfilePage() {
  const { user } = useSession();
  const inst = useInstitutionRequired();
  const qc = useQueryClient();
  const toast = useToast();
  const [err, setErr] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const profile = useForm<z.input<typeof ProfileUpdateSchema>>({
    resolver: zodResolver(ProfileUpdateSchema),
    defaultValues: { name: user?.name, department: user?.department ?? '', rollNumber: user?.rollNumber ?? '', phone: user?.phone ?? '' },
  });
  const pw = useForm<z.input<typeof ChangePasswordSchema>>({ resolver: zodResolver(ChangePasswordSchema), defaultValues: { currentPassword: '', newPassword: '' } });

  return (
    <main id="main" className="mx-auto max-w-2xl px-[var(--gutter)] py-12">
      <p className="kicker text-paper-3">{user?.email}</p>
      <h1 className="display-md mt-2">Profile</h1>
      <form
        noValidate
        className="mt-8 space-y-5"
        onSubmit={profile.handleSubmit(async (values) => {
          setErr(null);
          try {
            const s = await api<SessionDTO>('/auth/me', { method: 'PATCH', body: values });
            qc.setQueryData(sessionKey, s);
            toast({ tone: 'ok', title: 'Profile saved' });
          } catch (e) {
            setErr(applyServerErrors(e, profile.setError, ['name', 'department', 'rollNumber', 'phone']));
          }
        })}
      >
        <Field label="Name" error={profile.formState.errors.name?.message}>
          {({ id }) => <Input id={id} {...profile.register('name')} />}
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Department" error={profile.formState.errors.department?.message}>
            {({ id }) => (
              <Select id={id} {...profile.register('department')}>
                <option value="">Not set</option>
                {inst.departments.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Roll number" error={profile.formState.errors.rollNumber?.message}>
            {({ id }) => <Input id={id} {...profile.register('rollNumber')} />}
          </Field>
        </div>
        <Field label="Phone" error={profile.formState.errors.phone?.message}>
          {({ id }) => <Input id={id} type="tel" {...profile.register('phone')} />}
        </Field>
        <FormAlert>{err}</FormAlert>
        <Button type="submit" variant="primary" loading={profile.formState.isSubmitting}>
          Save profile
        </Button>
      </form>

      <form
        noValidate
        className="mt-14 space-y-5 border-t border-line pt-8"
        onSubmit={pw.handleSubmit(async (values) => {
          setPwErr(null);
          try {
            await api('/auth/password', { method: 'POST', body: values });
            pw.reset();
            toast({ tone: 'ok', title: 'Password changed', body: 'Other devices were signed out.' });
          } catch (e) {
            setPwErr(applyServerErrors(e, pw.setError, ['currentPassword', 'newPassword']));
          }
        })}
      >
        <h2 className="display-sm">Change password</h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Current password" error={pw.formState.errors.currentPassword?.message}>
            {({ id }) => <Input id={id} type="password" autoComplete="current-password" {...pw.register('currentPassword')} />}
          </Field>
          <Field label="New password" hint="At least 10 characters." error={pw.formState.errors.newPassword?.message}>
            {({ id }) => <Input id={id} type="password" autoComplete="new-password" {...pw.register('newPassword')} />}
          </Field>
        </div>
        <FormAlert>{pwErr}</FormAlert>
        <Button type="submit" loading={pw.formState.isSubmitting}>
          Update password
        </Button>
      </form>
    </main>
  );
}
