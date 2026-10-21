// Présidentielle 2027 (ENGINE.md §12) : premier tour au tick d'avril 2027, second tour au tick de mai. Le joueur est le
// candidat du camp présidentiel ; éliminé ou battu, la partie s'arrête (défaite « presidentielle »).
import type { GameState, PresidentielleForecast, TurnEvent } from './types.ts';
import { monthIndex } from './types.ts';
import { C, INIT, politics } from './init.ts';
import { gauss } from './parliament.ts';
import { qualitativeEffect } from './levers.ts';

// Dates retenues (Conseil des ministres du 1er juillet 2026) : 18 avril et 2 mai 2027.
export const PRESIDENTIELLE = { tour1: { year: 2027, month: 4 }, tour2: { year: 2027, month: 5 }, dates: ['18 avril 2027', '2 mai 2027'] } as const;
const T1 = monthIndex(PRESIDENTIELLE.tour1), T2 = monthIndex(PRESIDENTIELLE.tour2);

const D = politics.institutions;
const CANDIDATS = politics.intentions_vote.resultats.map((r) => r.party_id);
const CAMP = D.blocs.find((b) => b.id === D.majorite_presidentielle[0])!.parties.filter((p) => CANDIDATS.includes(p));
export const JOUEUR = CAMP[0]; // candidat du camp présidentiel dans les intentions de vote
const BARRAGE = new Set(D.blocs.filter((b) => b.barrage).flatMap((b) => b.parties));
const POS = new Map(politics.parties.map((p) => [p.id, p.positionnement]));
const dist = (a: string, b: string) => {
  const x = POS.get(a)!, y = POS.get(b)!;
  return Math.hypot(x.economie - y.economie, x.societal - y.societal, x.europe - y.europe);
};
const prime = (s: GameState) => Math.exp(C.presidentielle_prime_popularite * (s.national.popularite - INIT.popularite));

// Premier tour : intentions du mois × prime de popularité du candidat sortant × erreur de sondage log-normale. Pur.
function tour1(s: GameState, rng: number): { pct: Record<string, number>; rng: number } {
  const w: Record<string, number> = {};
  for (const p of CANDIDATS) {
    let z: number;
    [z, rng] = gauss(rng);
    w[p] = (s.intentions[p] ?? 0) * (p === JOUEUR ? prime(s) : 1) * Math.exp(C.presidentielle_incertitude * z);
  }
  const tot = Object.values(w).reduce((a, b) => a + b, 0);
  return { pct: Object.fromEntries(CANDIDATS.map((p) => [p, (100 * w[p]) / tot])), rng };
}

// Second tour : chaque finaliste garde ses voix ; une part des voix des éliminés se reporte, selon la distance politique
// (et moins vers un candidat « barrage »), le reste s'abstient. Choc commun en points. Pur.
function tour2(pct: Record<string, number>, [a, b]: [string, string], rng: number): { pct: Record<string, number>; rng: number } {
  const v = { [a]: pct[a], [b]: pct[b] };
  for (const p of CANDIDATS) {
    if (p === a || p === b) continue;
    const wa = Math.exp(-C.presidentielle_report_distance * dist(p, a)) * (BARRAGE.has(a) && !BARRAGE.has(p) ? C.presidentielle_barrage : 1);
    const wb = Math.exp(-C.presidentielle_report_distance * dist(p, b)) * (BARRAGE.has(b) && !BARRAGE.has(p) ? C.presidentielle_barrage : 1);
    v[a] += C.presidentielle_report_part * pct[p] * wa / (wa + wb);
    v[b] += C.presidentielle_report_part * pct[p] * wb / (wa + wb);
  }
  let z: number;
  [z, rng] = gauss(rng);
  const pa = Math.min(99, Math.max(1, (100 * v[a]) / (v[a] + v[b]) + C.presidentielle_incertitude_t2 * z));
  return { pct: { [a]: pa, [b]: 100 - pa }, rng };
}

const finalistes = (pct: Record<string, number>) => [...CANDIDATS].sort((x, y) => pct[y] - pct[x]).slice(0, 2) as [string, string];
const tri = (pct: Record<string, number>) => Object.entries(pct).map(([partyId, p]) => ({ partyId, pct: p })).sort((x, y) => y.pct - x.pct);

// Au tick : annonce en janvier, premier tour en avril, second tour en mai. Modifie s.
export function presidentielle(s: GameState, t: number): TurnEvent[] {
  if (t === T1 - 3) {
    return [{ kind: 'event', id: 'presidentielle_2027_annonce', type: 'echeance', titre: 'Présidentielle : premier tour le 18 avril, second tour le 2 mai',
      description: 'Votre mandat expire le 14 mai 2027. Candidat à votre succession, vous serez jugé sur votre bilan : popularité, pouvoir d\'achat, emploi. Éliminé ou battu, vous quittez l\'Élysée.' }];
  }
  if ((t !== T1 && t !== T2) || s.defaite) return [];
  const I = s.internals;
  if (t === T1) {
    const r = tour1(s, s.rng);
    s.rng = r.rng;
    CANDIDATS.forEach((p) => { I[`pres:${p}`] = r.pct[p]; });
    const f = finalistes(r.pct);
    const out: TurnEvent[] = [{ kind: 'presidentielle', tour: 1, resultats: tri(r.pct), qualifies: f, joueur: JOUEUR }];
    if (!f.includes(JOUEUR)) return defaite(s, out);
    return out;
  }
  if (!CANDIDATS.some((p) => I[`pres:${p}`] !== undefined)) return []; // premier tour absent (sauvegarde antérieure à cette version)
  const pct1 = Object.fromEntries(CANDIDATS.map((p) => [p, I[`pres:${p}`] ?? 0]));
  const f = finalistes(pct1);
  const r = tour2(pct1, f, s.rng);
  s.rng = r.rng;
  const elu = r.pct[f[0]] >= r.pct[f[1]] ? f[0] : f[1];
  const out: TurnEvent[] = [{ kind: 'presidentielle', tour: 2, resultats: tri(r.pct), qualifies: f, joueur: JOUEUR, elu }];
  if (elu !== JOUEUR) return defaite(s, out);
  // Réélu : état de grâce.
  s.effects.push(qualitativeEffect(s, { kind: 'event', id: 'presidentielle_2027' }, { kind: 'popularite' }, 1, 'moyenne', 'choc', t, 0, 6));
  s.effects.push(qualitativeEffect(s, { kind: 'event', id: 'presidentielle_2027' }, { kind: 'stabilite' }, 1, 'faible', 'choc', t, 0, 6));
  return out;
}

function defaite(s: GameState, out: TurnEvent[]): TurnEvent[] {
  if (!s.defaite) {
    s.defaite = { cause: 'presidentielle', date: { ...s.date } };
    out.push({ kind: 'defaite', cause: 'presidentielle' });
  }
  return out;
}

// Prévision : Monte-Carlo sur graines fixes à l'état courant (intentions et popularité figées). Pur, déterministe.
const N = 1000;
export function forecastPresidentielle(state: GameState): PresidentielleForecast {
  let qualif = 0, victoire = 0;
  const adv: Record<string, number> = {}, t1: Record<string, number> = {};
  for (let k = 0; k < N; k++) {
    const a = tour1(state, (k * 2654435761) >>> 0);
    for (const p of CANDIDATS) t1[p] = (t1[p] ?? 0) + a.pct[p] / N;
    const f = finalistes(a.pct);
    if (!f.includes(JOUEUR)) continue;
    qualif++;
    const autre = f[0] === JOUEUR ? f[1] : f[0];
    adv[autre] = (adv[autre] ?? 0) + 1;
    if (tour2(a.pct, f, a.rng).pct[JOUEUR] >= 50) victoire++;
  }
  return {
    premierTour: tri(t1),
    qualification: qualif / N,
    victoire: victoire / N,
    adversaires: Object.entries(adv).map(([partyId, n]) => ({ partyId, frequence: n / N })).sort((x, y) => y.frequence - x.frequence),
  };
}
