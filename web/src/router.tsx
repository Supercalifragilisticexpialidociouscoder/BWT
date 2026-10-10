import { createBrowserRouter, Navigate, Outlet, ScrollRestoration, useLocation, useRouteError, isRouteErrorResponse, Link } from 'react-router';
import { useSession } from './lib/session';
import { PublicLayout } from './features/public/PublicLayout';
import { HomePage } from './features/public/HomePage';
import { Wordmark } from './components/Wordmark';
import { ButtonLink } from './components/ui/Button';

function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center" role="status" aria-label="Loading">
      <Wordmark className="animate-pulse opacity-60" />
    </div>
  );
}

function Root() {
  return (
    <>
      <a href="#main" className="sr-only z-[200] rounded bg-signal px-3 py-2 text-signal-ink focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>
      <ScrollRestoration />
      <Outlet />
    </>
  );
}

export function RequireAuth() {
  const { user, endedHere } = useSession();
  const location = useLocation();
  // After a deliberate sign-out, leave protected pages for the public home rather than a sign-in form.
  if (!user) return <Navigate to={endedHere ? '/' : `/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <Outlet />;
}

export function NotFound({ title = 'Nothing here', body = 'The page you were looking for doesn’t exist or has moved.' }: { title?: string; body?: string }) {
  return (
    <main id="main" className="mx-auto flex min-h-[70dvh] max-w-3xl flex-col justify-center gap-6 px-[var(--gutter)] py-24">
      <p className="kicker text-paper-3">404</p>
      <h1 className="display-lg">{title}</h1>
      <p className="max-w-prose text-paper-2">{body}</p>
      <div className="flex gap-3">
        <ButtonLink to="/" variant="primary">
          Back to events
        </ButtonLink>
      </div>
    </main>
  );
}

function RouteError() {
  const err = useRouteError();
  if (isRouteErrorResponse(err) && err.status === 404) return <NotFound />;
  const chunk = err instanceof Error && /dynamically imported module|Importing a module script failed/i.test(err.message);
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-5 px-6">
      <Link to="/">
        <Wordmark />
      </Link>
      <h1 className="display-md">{chunk ? 'A new version is available' : 'This screen hit an error'}</h1>
      <p className="text-paper-2">
        {chunk ? 'Reload to pick up the latest version of CAMPUSFLOW.' : 'Your data is safe — nothing was submitted from this screen. Reload to try again.'}
      </p>
      <div>
        <button type="button" className="rounded bg-signal px-4 py-2 text-sm font-medium text-signal-ink" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </main>
  );
}

const page = <T extends Record<string, unknown>>(loader: () => Promise<T>, name: keyof T) => async () => ({ Component: (await loader())[name] as React.ComponentType });

export const router = createBrowserRouter([
  {
    element: <Root />,
    errorElement: <RouteError />,
    HydrateFallback: Splash,
    children: [
      {
        element: <PublicLayout />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'events', lazy: page(() => import('./features/public/DiscoverPage'), 'DiscoverPage') },
          { path: 'events/:slug', lazy: page(() => import('./features/public/EventPage'), 'EventPage') },
          { path: 'login', lazy: page(() => import('./features/auth/AuthPages'), 'LoginPage') },
          { path: 'signup', lazy: page(() => import('./features/auth/AuthPages'), 'SignupPage') },
          {
            element: <RequireAuth />,
            children: [
              { path: 'events/:slug/register', lazy: page(() => import('./features/participant/RegisterPage'), 'RegisterPage') },
              { path: 'join', lazy: page(() => import('./features/participant/JoinPage'), 'JoinPage') },
              { path: 'me', lazy: page(() => import('./features/participant/MyEventsPage'), 'MyEventsPage') },
              { path: 'me/registrations/:id', lazy: page(() => import('./features/participant/RegistrationPage'), 'RegistrationPage') },
              { path: 'me/profile', lazy: page(() => import('./features/participant/ProfilePage'), 'ProfilePage') },
            ],
          },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          { path: 'me/tickets/:id', lazy: page(() => import('./features/participant/TicketPage'), 'TicketPage') },
          {
            path: 'workspace',
            lazy: page(() => import('./features/workspace/WorkspaceShell'), 'WorkspaceShell'),
            children: [
              { index: true, lazy: page(() => import('./features/workspace/OverviewPage'), 'OverviewPage') },
              { path: 'events', lazy: page(() => import('./features/workspace/EventsPage'), 'EventsPage') },
              { path: 'events/new', lazy: page(() => import('./features/workspace/EventEditorPage'), 'EventEditorPage') },
              { path: 'events/:id', lazy: page(() => import('./features/workspace/EventEditorPage'), 'EventEditorPage') },
              { path: 'calendar', lazy: page(() => import('./features/workspace/CalendarPage'), 'CalendarPage') },
              { path: 'registrations', lazy: page(() => import('./features/workspace/RegistrationsPage'), 'RegistrationsPage') },
              { path: 'imports', lazy: page(() => import('./features/workspace/ImportPage'), 'ImportPage') },
              { path: 'teams', lazy: page(() => import('./features/workspace/TeamsPage'), 'TeamsPage') },
              { path: 'payments', lazy: page(() => import('./features/workspace/PaymentsPage'), 'PaymentsPage') },
              { path: 'attendance', lazy: page(() => import('./features/workspace/AttendancePage'), 'AttendancePage') },
              { path: 'venues', lazy: page(() => import('./features/workspace/VenuesPage'), 'VenuesPage') },
              { path: 'reports', lazy: page(() => import('./features/workspace/ReportsPage'), 'ReportsPage') },
              { path: 'settings', lazy: page(() => import('./features/workspace/SettingsPage'), 'SettingsPage') },
            ],
          },
          { path: 'live/:eventId', lazy: page(() => import('./features/live/LivePage'), 'LivePage') },
          { path: 'live/:eventId/scan', lazy: page(() => import('./features/live/ScanPage'), 'ScanPage') },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
