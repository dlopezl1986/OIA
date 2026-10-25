import type { Classification, TaskType } from '../types';

// Clasificación heurística local: no consume tokens ni llamadas.
const CODE = /```|\b(function|class|def|const|import|stack ?trace|traceback|exception|typescript|javascript|python|java|rust|golang|sql|regex|bash|docker|kubernetes|npm|compil\w*|bug|refactor\w*|c[oó]digo|script|endpoint)\b|=>|\(\);/i;
const RESEARCH = /\b(últim[oa]s?|actual(es|mente|izad[oa])?|hoy|noticias?|novedades|precios?|cotizaci[oó]n|fuentes?|referencias|estudios|art[ií]culos? cient[ií]ficos?|investigaci[oó]n|estad[ií]sticas?|qui[eé]n gan[oó]|latest|news|current|today|sources?)\b|\b20[2-9]\d\b/i;
const REASONING = /\b(demuestra|calcula|por qu[eé]|analiza|razona|estrategia|pros y contras|ventajas|desventajas|optimiza\w*|planifica|dise[ñn]a|eval[uú]a|compara|decide|recomienda|diagn[oó]stic\w*|prove|why|analy[sz]e|compare)\b/i;
const SIMPLE = /^(qu[eé] es|qu[eé] significa|define|traduce|cu[aá]nto es|sin[oó]nimo|what is|translate)\b/i;
const DEPTH = /\b(detallad[oa]|exhaustiv[oa]|a fondo|en profundidad|paso a paso|in depth|thorough)\b/i;

export function classify(query: string): Classification {
  const q = query.trim();
  const signals: string[] = [];
  const code = CODE.test(q);
  const research = RESEARCH.test(q);
  const reasoning = REASONING.test(q);
  if (code) signals.push('código');
  if (research) signals.push('actualidad/fuentes');
  if (reasoning) signals.push('razonamiento');

  let type: TaskType = 'general';
  if (code) type = 'code';
  else if (research) type = 'research';
  else if (reasoning) type = 'reasoning';
  else if (q.length < 160 && (SIMPLE.test(q) || q.split(/\s+/).length < 14)) type = 'simple';

  let complexity = 1;
  const questions = (q.match(/\?/g) ?? []).length;
  if (q.length > 300 || questions > 1 || (reasoning && type !== 'simple')) complexity++;
  if (q.length > 1200 || DEPTH.test(q)) complexity++;
  if ((type === 'research' || (type === 'code' && q.length > 200)) && complexity < 2) complexity = 2;
  if (DEPTH.test(q)) signals.push('profundidad');

  return { type, complexity: Math.min(3, complexity) as 1 | 2 | 3, needsWeb: research, signals };
}
