// Institutions (ENGINE.md §11) : gouvernement, dissolution, législatives anticipées, cohabitation.
import type { GameState, Gouvernement, IssueLegislatives, LegislativesForecast, Pouvoir, ProfilPM, Rapport, Sieges, TurnEvent, YearMonth } from './types.ts';
import { monthIndex, votesSimules } from './types.ts';
import { C, INIT, inst, politics } from './init.ts';
import { gauss } from './parliament.ts';

const D = politics.institutions;
const PROFILS = new Map(D.profils.map((p) => [p.id as string, p]));
const BLOCS = D.blocs;
const COALITIONS = new Map(D.coalitions_opposition.map((c) => [c.id, c]));
const BLOC_DE = new Map(BLOCS.flatMap((b) => b.groupes.map((g) => [g, b.id])));
const S0 = new Map(politics.assemblee.groupes.map((g) => [g.id, g.sieges]));
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const addMonths = (d: YearMonth, n: number): YearMonth => {
  const m = monthIndex(d) + n;
  return { year: 2026 + Math.floor(m / 12), month: (((m % 12) + 12) % 12) + 1 };
};

// Plus forts restes : répartit total (entier) au prorata des poids.
function repartir(total: number, poids: number[]): number[] {
  const tot = sum(poids);
  const q = poids.map((w) => (tot > 0 ? (total * w) / tot : 0));
  const n = q.map(Math.floor);
  const ordre = q.map((x, i) => i).sort((i, j) => q[j] - n[j] - (q[i] - n[i]));
  const reste = total - sum(n);
  for (let k = 0; k < reste; k++) n[ordre[k]]++;
  return n;
}

// Sièges par bloc, dans l'ordre des données, puis les groupes hors blocs (interface, LLM, banc).
export function parBloc(sieges: Sieges): { id: string; nom: string; sieges: number }[] {
  const de = (ids: string[]) => sum(sieges.filter((g) => ids.includes(g.groupId)).map((g) => g.sieges));
  return [...BLOCS.map((b) => ({ id: b.id, nom: b.nom, sieges: de(b.groupes) })), { id: 'autres', nom: 'Autres (LIOT, non-inscrits)', sieges: de(D.hors_blocs) }];
}

// Législatives : sièges par bloc (formule de legislatives_exposant), puis par groupe au prorata des sièges initiaux. Pur.
export function scrutin(s: GameState, rng: number): { assemblee: GameState['parliament']['assemblee']; rng: number } {
  const cur = new Map(s.parliament.assemblee.map((g) => [g.groupId, g]));
  const sortants = (ids: string[]) => sum(ids.map((id) => cur.get(id)?.sieges ?? 0));
  // Camp du Président : prime (ou malus) de popularité, que les intentions de présidentielle ne reflètent qu'à peine.
  const prime = Math.exp(C.legislatives_prime_popularite * (s.national.popularite - INIT.popularite));
  const w = BLOCS.map((b) => {
    let z: number;
    [z, rng] = gauss(rng);
    const v = sum(b.parties.map((p) => s.intentions[p] ?? 0));
    return (v * (b.barrage ? C.legislatives_barrage : 1)) ** C.legislatives_exposant * Math.exp(C.legislatives_incertitude * z)
      * (b.id === D.majorite_presidentielle[0] ? prime : 1);
  });
  const S = BLOCS.map((b) => sortants(b.groupes));
  const sw = sum(w), sS = sum(S), l = C.legislatives_ancrage_local;
  // Les hors blocs gardent leurs sièges ; le scrutin pourvoit aussi les sièges vacants (total 577).
  const nb = repartir(577 - sortants(D.hors_blocs), BLOCS.map((_, i) => l * S[i] / sS + (1 - l) * w[i] / sw));
  const out = new Map<string, number>();
  BLOCS.forEach((b, i) => repartir(nb[i], b.groupes.map((g) => S0.get(g) ?? 0)).forEach((n, j) => out.set(b.groupes[j], n)));
  const assemblee = politics.assemblee.groupes.map((g) => ({
    groupId: g.id, sieges: out.get(g.id) ?? cur.get(g.id)?.sieges ?? 0, rapport: cur.get(g.id)?.rapport ?? (g.rapport_gouvernement as Rapport),
  }));
  return { assemblee, rng };
}

// Issue : majorité présidentielle, sinon première coalition d'opposition à la majorité absolue, sinon aucune majorité.
export function issue(a: Sieges): { issue: IssueLegislatives; coalition?: string } {
  const m = new Map(parBloc(a).map((b) => [b.id, b.sieges]));
  const tot = (ids: string[]) => sum(ids.map((id) => m.get(id) ?? 0));
  if (tot(D.majorite_presidentielle) >= C.censure_seuil) return { issue: 'majorite' };
  const c = D.coalitions_opposition.find((x) => tot(x.blocs) >= C.censure_seuil);
  return c ? { issue: 'cohabitation', coalition: c.id } : { issue: 'sans_majorite' };
}

// Rapport de chaque groupe au gouvernement : celui du profil, ou en cohabitation coalition → majorité, camp du Président → soutien conditionnel.
export function rapportDe(g: Gouvernement): (groupId: string) => Rapport {
  if (g.profil !== 'cohabitation') {
    const r: Record<string, string | undefined> = PROFILS.get(g.profil)?.rapports ?? {};
    return (id) => (r[id] as Rapport | undefined) ?? 'opposition';
  }
  const coal = new Set(COALITIONS.get(g.coalition ?? '')?.blocs);
  return (id) => {
    const b = BLOC_DE.get(id);
    return b && coal.has(b) ? 'majorite' : b === D.majorite_presidentielle[0] ? 'soutien_conditionnel' : 'opposition';
  };
}
const appliquer = (s: GameState, g: Gouvernement) => s.parliament.assemblee.forEach((x) => (x.rapport = rapportDe(g)(x.groupId)));

export function pouvoir(s: GameState): Pouvoir {
  const i = inst(s), t = monthIndex(s.date);
  const dissolutionPossible = addMonths(i.legislatives, C.dissolution_delai_mois);
  const assise: Record<Rapport, number> = { majorite: 0, soutien_conditionnel: 0, opposition: 0 };
  for (const g of s.parliament.assemblee) assise[g.rapport] += g.sieges;
  return {
    ...i, cohabitation: i.gouvernement.profil === 'cohabitation', assise, dissolutionPossible,
    peutDissoudre: votesSimules(s.mode) && !i.dissolution && !s.defaite && t < 60 && t >= monthIndex(dissolutionPossible),
  };
}

// Dissolution (art. 12) : législatives au tick de ce mois, choc de stabilité de campagne.
export function dissolve(state: GameState): { state: GameState; events: TurnEvent[] } {
  if (!pouvoir(state).peutDissoudre) return { state, events: [] };
  const s = structuredClone(state);
  s.institutions = { ...inst(s), dissolution: { ...s.date } };
  s.effects.push({ source: { kind: 'event', id: 'dissolution' }, cible: { kind: 'stabilite' }, amplitude: C.dissolution_choc_stabilite, forme: 'choc', debut: monthIndex(s.date), rampe: 0, duree: C.dissolution_duree_choc_mois });
  return { state: s, events: [{ kind: 'dissolution' }] };
}

// Nomination d'un Premier ministre : seulement si le gouvernement est démissionnaire (pas de remaniement volontaire).
export function nominate(state: GameState, profil: Exclude<ProfilPM, 'cohabitation'>): { state: GameState; events: TurnEvent[] } {
  if (!inst(state).gouvernement.demissionnaire || !PROFILS.has(profil)) return { state, events: [] };
  const s = structuredClone(state);
  const gouvernement: Gouvernement = { profil, depuis: { ...s.date }, demissionnaire: false };
  s.institutions = { ...inst(s), gouvernement };
  appliquer(s, gouvernement);
  return { state: s, events: [{ kind: 'nomination', profil }] };
}

// Étape 2b du tick : législatives anticipées. Modifie s (déjà copié par le tick).
export function elections(s: GameState, t: number): TurnEvent[] {
  const copie = (a: Sieges): Sieges => a.map(({ groupId, sieges }) => ({ groupId, sieges }));
  const avant = copie(s.parliament.assemblee);
  const r = scrutin(s, s.rng);
  s.rng = r.rng;
  s.parliament.assemblee = r.assemblee;
  const res = issue(r.assemblee), sortant = inst(s).gouvernement;
  // Hors cohabitation : démission, rapports inchangés jusqu'à la nomination ; une cohabitation qui prend fin laisse un
  // gouvernement d'affaires courantes au profil technicien (la coalition battue ne reste pas « majorité »).
  const gouvernement: Gouvernement = res.issue === 'cohabitation'
    ? { profil: 'cohabitation', coalition: res.coalition, depuis: { ...s.date }, demissionnaire: false }
    : sortant.profil === 'cohabitation' ? { profil: 'technicien', depuis: { ...s.date }, demissionnaire: true }
    : { ...sortant, demissionnaire: true };
  if (res.issue === 'cohabitation' || sortant.profil === 'cohabitation') appliquer(s, gouvernement);
  s.institutions = { gouvernement, legislatives: { ...s.date } };
  const apres = copie(r.assemblee);
  const camp = (a: Sieges) => parBloc(a).find((b) => b.id === D.majorite_presidentielle[0])!.sieges;
  s.effects.push({ source: { kind: 'event', id: 'legislatives' }, cible: { kind: 'popularite' }, amplitude: (C.legislatives_effet_popularite * (camp(apres) - camp(avant))) / 577, forme: 'choc', debut: t, rampe: 0, duree: C.dissolution_duree_choc_mois });
  const events: TurnEvent[] = [{ kind: 'legislatives', avant, apres, ...res }];
  if (res.issue === 'cohabitation') events.push({ kind: 'nomination', profil: 'cohabitation', coalition: res.coalition });
  return events;
}

// Prévision : Monte-Carlo de scrutin sur des graines fixes (comme forecastVote), même loi que le tick à l'état courant.
// ponytail: 1000 tirages, ≈ 5 ms ; plus si l'affichage doit être plus fin
const LEG_N = 1000;
export function forecastLegislatives(state: GameState): LegislativesForecast {
  const tirages = BLOCS.map(() => [] as number[]);
  const n: Record<IssueLegislatives, number> = { majorite: 0, cohabitation: 0, sans_majorite: 0 };
  for (let k = 0; k < LEG_N; k++) {
    const { assemblee } = scrutin(state, (k * 2654435761) >>> 0);
    parBloc(assemblee).slice(0, BLOCS.length).forEach((b, i) => tirages[i].push(b.sieges));
    n[issue(assemblee).issue]++;
  }
  return {
    blocs: BLOCS.map((b, i) => {
      const d = tirages[i].sort((x, y) => x - y);
      return { id: b.id, nom: b.nom, sieges: sum(d) / LEG_N, bas: d[100], haut: d[900] };
    }),
    issues: { majorite: n.majorite / LEG_N, cohabitation: n.cohabitation / LEG_N, sans_majorite: n.sans_majorite / LEG_N },
  };
}
