import { useEffect, useState } from 'react';

/** Shared motion vocabulary — short for operational UI, longer for editorial moments. */
export const ease = {
  out: [0.16, 1, 0.3, 1] as const,
  inOut: [0.76, 0, 0.24, 1] as const,
  standard: [0.2, 0, 0, 1] as const,
};

export const transitions = {
  micro: { duration: 0.12, ease: ease.standard },
  fast: { duration: 0.18, ease: ease.standard },
  panel: { duration: 0.36, ease: ease.out },
  editorial: { duration: 0.72, ease: ease.out },
};

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

export function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}
