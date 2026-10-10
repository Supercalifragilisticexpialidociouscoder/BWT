/**
 * One visual grammar for event categories, shared by the 3D landscape, the 2D fallback,
 * the directory, event pages and the calendar. Categories are admin-configurable, so
 * unknown slugs are mapped by keyword and otherwise deterministically by hash.
 */
export const FORMS = ['module', 'layers', 'cluster', 'ring', 'signal', 'vector', 'constellation', 'assembly', 'point'] as const;
export type Form = (typeof FORMS)[number];

export const FORM_MEANING: Record<Form, string> = {
  module: 'modular block — build events',
  layers: 'stacked layers — hands-on sessions',
  cluster: 'cluster — exhibitions',
  ring: 'ring — performances & culture',
  signal: 'signal — talks',
  vector: 'vector — sport & competition',
  constellation: 'constellation — meetups',
  assembly: 'diamond — conferences',
  point: 'point — other events',
};

const KEYWORDS: [RegExp, Form][] = [
  [/hack|build|jam|sprint/, 'module'],
  [/work ?shop|bootcamp|lab|training|class/, 'layers'],
  [/expo|exhibit|showcase|fair|demo/, 'cluster'],
  [/cultur|music|dance|fest|art|theat|drama/, 'ring'],
  [/semin|talk|lecture|webinar|panel|guest/, 'signal'],
  [/sport|tourn|match|race|cup|competition|contest|quiz/, 'vector'],
  [/club|meet|social|community|circle/, 'constellation'],
  [/confer|summit|symposium|convention/, 'assembly'],
];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function categoryForm(slug: string, name = ''): Form {
  const text = `${slug} ${name}`.toLowerCase();
  for (const [rx, form] of KEYWORDS) if (rx.test(text)) return form;
  return FORMS[hash(slug) % (FORMS.length - 1)]!;
}
