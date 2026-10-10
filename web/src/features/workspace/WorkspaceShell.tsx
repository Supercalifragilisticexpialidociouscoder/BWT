import { useEffect, useState, type ComponentType } from 'react';
import { Link, NavLink, Outlet, useLocation, useSearchParams } from 'react-router';
import {
  CalendarDays,
  ChartColumn,
  ClipboardCheck,
  CreditCard,
  FileUp,
  LayoutGrid,
  ListChecks,
  LogOut,
  Menu,
  MapPin,
  ScanLine,
  Settings,
  Users,
  X,
  ArrowUpRight,
  Layers,
} from 'lucide-react';
import clsx from 'clsx';
import { LABELS } from '@campusflow/shared';
import { useSession, useSignOut } from '../../lib/session';
import { useFormat } from '../../lib/format';
import { Wordmark } from '../../components/Wordmark';
import { DemoStrip } from '../public/PublicLayout';
import { NotFound } from '../../router';
import { useWorkspaceEvents, defaultEvent } from './context';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  scoped?: boolean;
  end?: boolean;
}

export function WorkspaceShell() {
  const { user, access, hasWorkspace, managesAny } = useSession();
  const signOut = useSignOut();
  const events = useWorkspaceEvents();
  const location = useLocation();
  const [params] = useSearchParams();
  const fmt = useFormat();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [location.pathname]);

  if (!hasWorkspace) {
    return <NotFound title="No workspace access" body="The workspace is for organizers and event staff. Ask an organizer to add you to their event’s staff, or an administrator to grant organizer access." />;
  }

  const list = events.data ?? [];
  const manageable = list.filter((e) => e.access !== 'checkin');
  const current = list.find((e) => e.id === params.get('event')) ?? defaultEvent(managesAny ? manageable : list);
  const q = current ? `?event=${current.id}` : '';
  const checkinEvents = list.filter((e) => e.status === 'published' && new Date(e.endsAt).getTime() > Date.now() - 86_400_000).slice(0, 4);

  const groups: { label: string; items: NavItem[] }[] = [];
  if (managesAny) {
    groups.push({
      label: 'Workspace',
      items: [
        { to: '/workspace', label: 'Overview', icon: LayoutGrid, end: true },
        { to: '/workspace/events', label: 'Events', icon: Layers },
        { to: '/workspace/calendar', label: 'Calendar', icon: CalendarDays },
      ],
    });
    groups.push({
      label: 'This event',
      items: [
        { to: '/workspace/registrations', label: 'Registrations', icon: ListChecks, scoped: true },
        { to: '/workspace/teams', label: 'Teams', icon: Users, scoped: true },
        { to: '/workspace/payments', label: 'Payments', icon: CreditCard, scoped: true },
        { to: '/workspace/attendance', label: 'Attendance', icon: ClipboardCheck, scoped: true },
        { to: '/workspace/reports', label: 'Reports', icon: ChartColumn, scoped: true },
        { to: '/workspace/imports', label: 'Import', icon: FileUp, scoped: true },
      ],
    });
    const resources: NavItem[] = [];
    if (access.canOrganize) resources.push({ to: '/workspace/venues', label: 'Venues', icon: MapPin });
    if (access.isAdmin) resources.push({ to: '/workspace/settings', label: 'Settings', icon: Settings });
    if (resources.length) groups.push({ label: 'Campus', items: resources });
  } else {
    groups.push({ label: 'Workspace', items: [{ to: '/workspace', label: 'Assignments', icon: LayoutGrid, end: true }] });
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center justify-between px-5">
        <Link to="/" aria-label="CAMPUSFLOW public site">
          <Wordmark />
        </Link>
        <button type="button" className="p-1 text-paper-3 lg:hidden" aria-label="Close menu" onClick={() => setOpen(false)}>
          <X className="size-5" />
        </button>
      </div>

      {managesAny && (
        <div className="px-3 pb-3">
          <EventSwitcher />
        </div>
      )}

      <nav aria-label="Workspace" className="flex-1 space-y-6 overflow-y-auto px-3 pb-6 pt-2">
        {groups.map((g) => (
          <div key={g.label}>
            <p className="kicker px-2 pb-2 !text-[10px] text-paper-3">{g.label}</p>
            <ul className="space-y-0.5">
              {g.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to + (item.scoped ? q : '')}
                    end={item.end}
                    className={({ isActive }) =>
                      clsx(
                        'group flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-[13.5px] transition-colors duration-[var(--dur-fast)]',
                        isActive ? 'bg-ink-800 text-paper' : 'text-paper-2 hover:bg-ink-850 hover:text-paper',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon className={clsx('size-4', isActive ? 'text-signal' : 'text-paper-3 group-hover:text-paper-2')} />
                        {item.label}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {checkinEvents.length > 0 && (
          <div>
            <p className="kicker px-2 pb-2 !text-[10px] text-paper-3">Live check-in</p>
            <ul className="space-y-0.5">
              {checkinEvents.map((e) => {
                const live = new Date(e.startsAt).getTime() <= Date.now() && new Date(e.endsAt).getTime() > Date.now();
                return (
                  <li key={e.id}>
                    <Link to={`/live/${e.id}`} className="group flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-[13px] text-paper-2 hover:bg-ink-850 hover:text-paper">
                      <ScanLine className={clsx('size-4 shrink-0', live ? 'text-signal' : 'text-paper-3')} />
                      <span className="min-w-0 flex-1 truncate">{e.title}</span>
                      <span className="text-[11px] text-paper-3">{live ? 'now' : fmt.shortDate(e.startsAt)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </nav>

      <div className="border-t border-line px-4 py-3">
        <p className="truncate text-[13px] text-paper">{user?.name}</p>
        <p className="truncate text-[11.5px] text-paper-3">{user ? LABELS.role[user.role] : ''}</p>
        <div className="mt-2 flex items-center gap-3 text-[12px]">
          <Link to="/" className="inline-flex items-center gap-1 text-paper-3 hover:text-paper">
            Public site <ArrowUpRight className="size-3" />
          </Link>
          <button type="button" onClick={signOut} className="inline-flex items-center gap-1 text-paper-3 hover:text-paper">
            <LogOut className="size-3" /> Sign out
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh">
      <DemoStrip />
      <div className="lg:grid lg:grid-cols-[var(--shell-sidebar)_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-dvh border-r border-line bg-ink-950 lg:block">{sidebar}</aside>
        {open && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button type="button" aria-label="Close menu" className="absolute inset-0 bg-ink-950/80" onClick={() => setOpen(false)} />
            <aside className="absolute inset-y-0 left-0 w-[min(300px,85vw)] animate-[drawer-l_260ms_var(--ease-out-expo)] border-r border-line bg-ink-950">{sidebar}</aside>
            <style>{'@keyframes drawer-l { from { transform: translateX(-16px); opacity: 0 } to { transform: none; opacity: 1 } }'}</style>
          </div>
        )}
        <div className="min-w-0">
          <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-line bg-ink-950/90 px-4 backdrop-blur-md lg:hidden">
            <button type="button" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)} className="-ml-1 p-1.5 text-paper-2">
              <Menu className="size-5" />
            </button>
            <Wordmark compact />
            <span className="min-w-0 flex-1 truncate text-sm text-paper-2">{current?.title}</span>
          </header>
          <main id="main" className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}

function EventSwitcher() {
  const events = useWorkspaceEvents();
  const [params, setParams] = useSearchParams();
  const list = (events.data ?? []).filter((e) => e.access !== 'checkin');
  const current = list.find((e) => e.id === params.get('event')) ?? defaultEvent(list);
  const fmt = useFormat();
  if (!list.length) return null;
  const now = Date.now();
  const upcoming = list.filter((e) => new Date(e.endsAt).getTime() > now && e.status !== 'cancelled').sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = list.filter((e) => !upcoming.includes(e));
  return (
    <label className="block">
      <span className="kicker mb-1.5 block px-1 !text-[10px] text-paper-3">Event in focus</span>
      <select
        className="field !py-2 !text-[13px]"
        value={current?.id ?? ''}
        onChange={(e) =>
          setParams(
            (prev) => {
              const next = new URLSearchParams(prev);
              next.set('event', e.target.value);
              next.delete('page');
              return next;
            },
            { replace: false },
          )
        }
      >
        {upcoming.length > 0 && (
          <optgroup label="Upcoming & live">
            {upcoming.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title} · {fmt.shortDate(e.startsAt)}
                {e.status === 'draft' ? ' (draft)' : ''}
              </option>
            ))}
          </optgroup>
        )}
        {past.length > 0 && (
          <optgroup label="Past & cancelled">
            {past.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title} · {fmt.shortDate(e.startsAt)}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </label>
  );
}
