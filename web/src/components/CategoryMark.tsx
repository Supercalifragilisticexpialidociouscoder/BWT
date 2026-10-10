import clsx from 'clsx';
import { categoryForm, type Form } from '../lib/categories';

/** 2D glyph of a category's form — the same shapes the 3D landscape uses. */
export function FormGlyph({ form, className, title }: { form: Form; className?: string; title?: string }) {
  const s = { stroke: 'currentColor', strokeWidth: 1.5, fill: 'none', vectorEffect: 'non-scaling-stroke' as const };
  const f = { fill: 'currentColor' };
  return (
    <svg viewBox="0 0 16 16" className={clsx('size-4 shrink-0', className)} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      {form === 'module' && <rect x="3.5" y="3.5" width="9" height="9" {...s} />}
      {form === 'layers' && (
        <g {...f}>
          <rect x="2.5" y="3" width="11" height="2" rx="0.5" />
          <rect x="2.5" y="7" width="11" height="2" rx="0.5" />
          <rect x="2.5" y="11" width="11" height="2" rx="0.5" />
        </g>
      )}
      {form === 'cluster' && (
        <g {...s}>
          <rect x="5" y="2.5" width="5" height="5" />
          <rect x="2" y="8.5" width="5" height="5" />
          <rect x="8.5" y="8.5" width="5" height="5" />
        </g>
      )}
      {form === 'ring' && <circle cx="8" cy="8" r="5" {...s} strokeWidth={2} />}
      {form === 'signal' && (
        <g>
          <rect x="7.1" y="6" width="1.8" height="8" {...f} />
          <circle cx="8" cy="3.2" r="1.7" {...f} />
        </g>
      )}
      {form === 'vector' && <path d="M3 3 L13.5 8 L3 13 Z" {...s} />}
      {form === 'constellation' && (
        <g>
          <path d="M3.5 12 L8 4 L12.5 11" {...s} strokeWidth={1} />
          <circle cx="3.5" cy="12" r="1.6" {...f} />
          <circle cx="8" cy="4" r="1.6" {...f} />
          <circle cx="12.5" cy="11" r="1.6" {...f} />
        </g>
      )}
      {form === 'assembly' && (
        <g>
          <path d="M8 2 L14 8 L8 14 L2 8 Z" {...s} />
          <circle cx="8" cy="8" r="1.4" {...f} />
        </g>
      )}
      {form === 'point' && <circle cx="8" cy="8" r="3.5" {...f} />}
    </svg>
  );
}

export function CategoryMark({ slug, name, className, withLabel }: { slug: string; name?: string; className?: string; withLabel?: boolean }) {
  const form = categoryForm(slug, name);
  if (!withLabel) return <FormGlyph form={form} className={className} title={name} />;
  return (
    <span className={clsx('inline-flex items-center gap-1.5', className)}>
      <FormGlyph form={form} className="size-3.5" />
      <span>{name ?? slug}</span>
    </span>
  );
}
