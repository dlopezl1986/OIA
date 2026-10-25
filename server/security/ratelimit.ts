import { HttpError } from './auth';

/**
 * Limitador en memoria por usuario (ventana deslizante + concurrencia).
 * En Workers cada instancia tiene su propia memoria: es una barrera de protección, no una cuota exacta.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private active = new Map<string, number>();

  constructor(
    private perMinute: number,
    private concurrent: number,
  ) {}

  async run<T>(id: string, fn: () => Promise<T>, now = Date.now()): Promise<T> {
    const recent = (this.hits.get(id) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= this.perMinute) throw new HttpError(429, 'Demasiadas solicitudes; espera un minuto.');
    const act = this.active.get(id) ?? 0;
    if (act >= this.concurrent) throw new HttpError(429, 'Ya hay consultas en curso; espera a que terminen.');
    recent.push(now);
    this.hits.set(id, recent);
    this.active.set(id, act + 1);
    try {
      return await fn();
    } finally {
      this.active.set(id, (this.active.get(id) ?? 1) - 1);
    }
  }
}
