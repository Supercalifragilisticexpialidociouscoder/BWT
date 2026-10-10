import { createContext, useContext, type ReactNode } from 'react';
import type { InstitutionDTO } from '@campusflow/shared';

const Ctx = createContext<InstitutionDTO | null>(null);

export function InstitutionProvider({ value, children }: { value: InstitutionDTO; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useInstitution(): InstitutionDTO | null {
  return useContext(Ctx);
}

export function useInstitutionRequired(): InstitutionDTO {
  const v = useContext(Ctx);
  if (!v) throw new Error('Institution not loaded');
  return v;
}
