import type { Classification, CostClass, Mode, ParticipantDef, Settings } from '../types';

export interface Available {
  def: ParticipantDef;
  model: string;
  cost: CostClass;
}

const COST_BONUS: Record<CostClass, number> = { free: 1.1, credit: 0.5, paid: 0 };

export function score(a: Available, cls: Classification): number {
  return a.def.strengths[cls.type] + COST_BONUS[a.cost] + (cls.needsWeb && a.def.webSearch ? 2 : 0);
}

export function rank(available: Available[], cls: Classification): Available[] {
  return [...available].sort((x, y) => score(y, cls) - score(x, cls));
}

/** Número de participantes según modo, complejidad y presupuesto de llamadas. */
export function targetCount(cls: Classification, settings: Settings, mode: Mode): number {
  let n = mode === 'fast' ? 1 : mode === 'deep' ? settings.maxParticipants : Math.min(settings.maxParticipants, cls.complexity);
  // Con varios participantes hace falta al menos una llamada para el árbitro.
  if (n > 1) n = Math.min(n, settings.maxCalls - 1);
  return Math.max(1, n);
}

/** Elige participantes priorizando aptitud, coste y diversidad de familia. */
export function selectParticipants(available: Available[], cls: Classification, n: number): Available[] {
  const ranked = rank(available, cls);
  const chosen: Available[] = [];
  const families = new Set<string>();
  for (const a of ranked) {
    if (chosen.length >= n) break;
    if (!families.has(a.def.family)) {
      chosen.push(a);
      families.add(a.def.family);
    }
  }
  for (const a of ranked) {
    if (chosen.length >= n) break;
    if (!chosen.includes(a)) chosen.push(a);
  }
  return chosen;
}

export function pickArbiter(available: Available[], settings: Settings, exclude: Set<string> = new Set()): Available | undefined {
  const pool = available.filter((a) => !exclude.has(a.def.id));
  const preferred = pool.find((a) => a.def.id === settings.arbiter);
  if (preferred) return preferred;
  return [...pool].sort((x, y) => y.def.strengths.reasoning + COST_BONUS[y.cost] - (x.def.strengths.reasoning + COST_BONUS[x.cost]))[0];
}
