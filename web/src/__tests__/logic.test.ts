import { describe, expect, it } from 'vitest';
import type { EventSummaryDTO, RegistrationDTO } from '@campusflow/shared';
import { primaryAction } from '../features/public/universe/EventPanel';
import { lifecycle } from '../features/participant/Progress';
import { categoryForm } from '../lib/categories';
import { buildLayout } from '../three/layout';

const event = (over: Partial<EventSummaryDTO> = {}): EventSummaryDTO => ({
  id: 'e1',
  slug: 'hack',
  title: 'Hack',
  summary: 's',
  category: 'hackathon',
  categoryName: 'Hackathon',
  organization: { id: 'o', name: 'Club', slug: 'club' },
  startsAt: new Date(Date.now() + 86_400_000).toISOString(),
  endsAt: new Date(Date.now() + 90_000_000).toISOString(),
  registrationOpensAt: null,
  registrationDeadline: new Date(Date.now() + 3_600_000).toISOString(),
  mode: 'team',
  teamSize: { min: 2, max: 4 },
  capacity: 10,
  fee: { amount: 40000, currency: 'INR', basis: 'per_registration' },
  status: 'published',
  coverUrl: null,
  isDemo: true,
  venue: null,
  activeRegistrations: 3,
  remaining: 7,
  registrationState: 'open',
  ...over,
});

describe('primaryAction follows the server’s registration state', () => {
  it('offers registration only when open', () => {
    expect(primaryAction(event()).to).toBe('/events/hack/register');
    expect(primaryAction(event()).secondary?.to).toBe('/join');
    expect(primaryAction(event({ registrationState: 'closed' })).to).toBeNull();
    expect(primaryAction(event({ registrationState: 'cancelled' })).note).toMatch(/cancelled/);
  });
  it('sends people to join an existing team when a team event is full', () => {
    const a = primaryAction(event({ registrationState: 'full', remaining: 0 }));
    expect(a.to).toBe('/join');
    expect(a.note).toMatch(/All 10 team slots/);
    expect(primaryAction(event({ registrationState: 'full', mode: 'individual' })).to).toBeNull();
  });
});

describe('registration lifecycle', () => {
  const reg = (over: Partial<RegistrationDTO>): RegistrationDTO =>
    ({
      kind: 'individual',
      status: 'confirmed',
      event: { teamSize: { min: 1, max: 1 } },
      team: null,
      payment: { required: false, status: 'not_required', reference: null },
      approval: { required: false, decidedAt: null },
      participants: [{ ticket: { status: 'active' } }],
      ...over,
    }) as unknown as RegistrationDTO;
  it('skips steps that do not apply to free solo events', () => {
    expect(lifecycle(reg({})).map((s) => s.key)).toEqual(['registered', 'ticket', 'checkin']);
  });
  it('includes team and payment steps when they apply, and marks only one step current', () => {
    const steps = lifecycle(
      reg({
        kind: 'team',
        status: 'incomplete',
        event: { teamSize: { min: 2, max: 4 } } as RegistrationDTO['event'],
        team: { memberCount: 1 } as RegistrationDTO['team'],
        payment: { required: true, status: 'pending', reference: null } as RegistrationDTO['payment'],
        participants: [{ ticket: null }] as RegistrationDTO['participants'],
      }),
    );
    expect(steps.map((s) => s.key)).toEqual(['registered', 'team', 'payment', 'ticket', 'checkin']);
    expect(steps.filter((s) => s.state === 'current')).toHaveLength(1);
    expect(steps.find((s) => s.key === 'team')!.state).toBe('current');
  });
});

describe('category grammar and layout', () => {
  it('maps configured and unknown categories to stable forms', () => {
    expect(categoryForm('hackathon')).toBe('module');
    expect(categoryForm('cultural')).toBe('ring');
    expect(categoryForm('robotics-league', 'Robotics League')).toBe(categoryForm('robotics-league', 'Robotics League'));
  });
  it('positions events by date and never stacks two on the same spot', () => {
    const now = Date.now();
    const start = new Date(now + 2 * 86_400_000).toISOString();
    const layout = buildLayout(
      [event({ id: 'a', startsAt: start }), event({ id: 'b', startsAt: start }), event({ id: 'c', startsAt: start })],
      now,
      now - (now % 86_400_000),
      () => '',
    );
    const spots = new Set(layout.nodes.map((n) => `${n.x.toFixed(3)}:${n.z.toFixed(3)}`));
    expect(spots.size).toBe(3);
    expect(layout.nodes.every((n) => n.day > 1 && n.day < 3)).toBe(true);
  });
  it('handles an empty dataset', () => {
    const layout = buildLayout([], Date.now(), Date.now(), () => '');
    expect(layout.nodes).toEqual([]);
    expect(layout.lanes).toEqual([]);
    expect(layout.weeks.length).toBeGreaterThan(0);
  });
});
