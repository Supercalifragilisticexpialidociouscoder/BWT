import { useQuery } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import type { InstitutionDTO } from '@campusflow/shared';
import { api } from './lib/api';
import { InstitutionProvider } from './lib/institution';
import { useSession } from './lib/session';
import { router } from './router';
import { Wordmark } from './components/Wordmark';
import { ErrorState } from './components/ui/Feedback';

export function App() {
  const inst = useQuery({ queryKey: ['institution'], queryFn: () => api<InstitutionDTO>('/institution'), staleTime: 5 * 60_000 });
  const session = useSession();

  if (inst.isError) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-6 px-6">
        <Wordmark />
        <ErrorState error={inst.error} onRetry={() => inst.refetch()} />
      </main>
    );
  }
  if (!inst.data || session.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center" role="status" aria-label="Loading CAMPUSFLOW">
        <Wordmark className="animate-pulse opacity-60" />
      </div>
    );
  }
  return (
    <InstitutionProvider value={inst.data}>
      <RouterProvider router={router} />
    </InstitutionProvider>
  );
}
