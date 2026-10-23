// Parlement heuristique (ENGINE.md §4). Fonctions pures : l'état du générateur est passé et renvoyé.
import type { z } from 'zod';
import type { Bill, GameState, Rapport, VoteForecast, VoteResult } from './types.ts';
import type { Coefficient, Positionnement } from './schemas.ts';
import politics from '../gamedata/politics.json';
import tags from '../gamedata/tags.json';
import groups from '../gamedata/groups.json';
import coefficients from '../gamedata/coefficients.json';
import { constitutionnel, estBudgetaire, obstacleReforme, positionsReforme, regles } from './reformes.ts';

type Coef = z.infer<typeof Coefficient>;
type Axes = z.infer<typeof Positionnement>;
export type Groupe = { groupId: string; sieges: number; rapport: Rapport };

// Paramètres parlement_* et censure_* : gamedata/coefficients.json (source unique).
export const PARLIAMENT_COEFFICIENTS: Coef[] = coefficients.filter((c) => /^(parlement|censure)_/.test(c.id));
const P: Record<string, number> = Object.fromEntries(PARLIAMENT_COEFFICIENTS.map((c) => [c.id, c.value]));

// mulberry32 : renvoie [valeur dans [0,1), nouvel état].
export function rand(a: number): [number, number] {
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

// Loi normale centrée réduite (Box-Muller) : [valeur, nouvel état].
export function gauss(a: number): [number, number] {
  const [u, a1] = rand(a), [v, a2] = rand(a1);
  return [Math.sqrt(-2 * Math.log(1 - u)) * Math.cos(2 * Math.PI * v), a2];
}

// Graine dérivée de la partie (§15 décision du Conseil, §17 législatives de juin 2029) : tirage reproductible qui n'avance pas
// state.rng, donc ne décale aucun tirage existant (même motif que forecastVote : graines k × 2654435761).
export const graine = (s: GameState, ...cles: number[]) => cles.reduce((h, k) => Math.imul(h ^ k, 2654435761) >>> 0, s.seed >>> 0);

const sigma = (x: number) => 1 / (1 + Math.exp(-x));
const TAGS = new Map(tags.map((t) => [t.id, t.axes as Axes]));
const INTENSITE = { faible: 1, moyenne: 2, forte: 3 };
const PART = new Map(groups.map((g) => [g.id, g.part_population_adulte.value]));
// Accueil populaire de chaque tag (positif = populaire).
const ACCUEIL = new Map(tags.map((t) => [t.id,
  t.reactions_groupes.reduce((s, r) => s + r.direction * INTENSITE[r.intensite as keyof typeof INTENSITE] * (PART.get(r.group) ?? 0), 0)]));
// Données par chambre (des ids comme « ni » existent dans les deux).
const AN = new Map(politics.assemblee.groupes.map((g) => [g.id, g]));
const SE = new Map(politics.senat.groupes.map((g) => [g.id, g]));
type Data = typeof AN;
const SENAT: Groupe[] = politics.senat.groupes.map((g) => ({ groupId: g.id, sieges: g.sieges, rapport: g.rapport_gouvernement as Rapport }));
// Sénat dynamique (ENGINE.md §13) : rapports changés dans s.senat, sinon ceux des données.
export const senatGroupes = (s: GameState): Groupe[] => SENAT.map((g) => ({ ...g, rapport: s.senat?.[g.groupId] ?? g.rapport }));

const accueil = (bill: Bill) => {
  const v = bill.spec.tags.filter((t) => ACCUEIL.has(t)).map((t) => ACCUEIL.get(t)!);
  return v.reduce((s, x) => s + x, 0) / Math.max(1, v.length);
};

export function billAxes(bill: Bill): Axes {
  const axes = bill.spec.tags.map((t) => TAGS.get(t)).filter((a): a is Axes => !!a);
  const n = Math.max(1, axes.length);
  const m = (k: keyof Axes) => axes.reduce((s, a) => s + a[k], 0) / n;
  return { economie: m('economie'), societal: m('societal'), europe: m('europe') };
}

const bonus = (r: Rapport) => ({
  majorite: P.parlement_bonus_majorite,
  soutien_conditionnel: P.parlement_bonus_soutien_conditionnel,
  opposition: P.parlement_bonus_opposition,
})[r];

// Accord sur le fond (§4, §4b, §14) : position du modèle de décision (spec.positions) si elle existe, puis celle de la réforme
// (reformes.json), sinon produit scalaire des axes de la loi et du positionnement du groupe. Non borné (le vote garde son échelle) ; borné à ±1 pour les relations (§13).
export function fond(bill: Bill, chambre: 'assemblee' | 'senat', id: string, axes = billAxes(bill)): number {
  const k = `${chambre}_${id}`;
  const p = bill.spec.positions?.[k] ?? positionsReforme(bill.spec.reforme)?.[k];
  if (p !== undefined) return p;
  const pos = (chambre === 'assemblee' ? AN : SE).get(id)?.positionnement ?? { economie: 0, societal: 0, europe: 0 };
  return axes.economie * pos.economie + axes.societal * pos.societal + axes.europe * pos.europe;
}

// Score s d'un groupe : positif = penche pour la loi. f = fond(...).
// Révision constitutionnelle (§14) : le bonus de rapport est réduit de parlement_revision_malus_bonus (on ne suit pas son camp sur la Constitution).
function groupScore(state: GameState, acc: number, g: Groupe, malus: number, f: number, revision = false): number {
  return P.parlement_poids_axes * f + bonus(g.rapport) * (revision ? 1 - P.parlement_revision_malus_bonus : 1) + P.parlement_poids_popularite * (state.national.popularite - 0.3)
    + P.parlement_poids_accueil_populaire * acc - malus;
}

// Vote d'un groupe avant dissidence : sièges × probabilités (abstention maximale si le groupe est indifférent).
function baseVote(sieges: number, s: number) {
  const p = sigma(P.parlement_pente * s);
  const abst = P.parlement_abstention_base * 4 * p * (1 - p);
  const pour = Math.round(sieges * p * (1 - abst));
  const contre = Math.min(sieges - pour, Math.round(sieges * (1 - p) * (1 - abst)));
  return { pour, contre };
}

// Vote d'un groupe : vote de base, puis dissidence tirée selon 1 − discipline.
function groupVote(sieges: number, s: number, discipline: number, rng: number) {
  let { pour, contre } = baseVote(sieges, s);
  const [u, next] = rand(rng);
  const dissidents = Math.round(sieges * (1 - discipline) * u);
  if (pour >= contre) { const d = Math.min(dissidents, pour); pour -= d; contre += d; }
  else { const d = Math.min(dissidents, contre); contre -= d; pour += d; }
  return { pour, contre, abstention: sieges - pour - contre, rng: next };
}

// Score et discipline de chaque groupe d'une chambre pour une loi (commun au vote et à la prévision).
function scores(state: GameState, bill: Bill, groupes: Groupe[], data: Data, malus: (g: Groupe) => number) {
  const axes = billAxes(bill);
  const acc = accueil(bill);
  const chambre = data === AN ? 'assemblee' : 'senat';
  const revision = constitutionnel(bill.spec);
  return groupes.map((g) => ({ g, s: groupScore(state, acc, g, malus(g), fond(bill, chambre, g.groupId, axes), revision), discipline: data.get(g.groupId)?.discipline ?? 0.9 }));
}

// Incertitude du vote : un choc commun (climat de la séance) et un choc par groupe (négociations, amendements) s'ajoutent au score.
function tally(state: GameState, bill: Bill, groupes: Groupe[], data: Data, chambre: VoteResult['chambre'], malus: (g: Groupe) => number) {
  let [commun, rng] = gauss(state.rng);
  const parGroupe: VoteResult['parGroupe'] = [];
  for (const { g, s, discipline } of scores(state, bill, groupes, data, malus)) {
    const [z, r1] = gauss(rng);
    const v = groupVote(g.sieges, s + P.parlement_incertitude_commune * commun + P.parlement_incertitude_groupe * z, discipline, r1);
    rng = v.rng;
    parGroupe.push({ groupId: g.groupId, pour: v.pour, contre: v.contre, abstention: v.abstention });
  }
  const sum = (k: 'pour' | 'contre' | 'abstention') => parGroupe.reduce((s, g) => s + g[k], 0);
  return { parGroupe, pour: sum('pour'), contre: sum('contre'), abstention: sum('abstention'), rng, chambre };
}

// Cohabitation (ENGINE.md §11) : à l'Assemblée, la majorité issue de l'opposition ne porte les textes du Président qu'à contrecœur.
const malusCohab = (state: GameState) => (g: Groupe) =>
  state.institutions?.gouvernement.profil === 'cohabitation' && g.rapport === 'majorite' ? P.parlement_malus_cohabitation : 0;

export function voteBill(state: GameState, bill: Bill, chambre: 'assemblee' | 'senat'): { result: VoteResult; rng: number } {
  const groupes = chambre === 'assemblee' ? state.parliament.assemblee : senatGroupes(state);
  const t = tally(state, bill, groupes, chambre === 'assemblee' ? AN : SE, chambre, chambre === 'assemblee' ? malusCohab(state) : () => 0);
  return { result: { chambre, date: state.date, pour: t.pour, contre: t.contre, abstention: t.abstention, adopte: t.pour > t.contre, parGroupe: t.parGroupe }, rng: t.rng };
}

// Prévision d'un vote : Monte-Carlo de voteBill sur des graines fixes (déterministe, indépendant de state.rng).
// ponytail: FORECAST_N tirages, erreur type ≈ 1,6 point sur la probabilité ; plus de tirages si l'affichage doit être plus fin.
export const FORECAST_N = 1000;
export function forecastVote(state: GameState, bill: Bill, chambre: 'assemblee' | 'senat'): VoteForecast {
  const groupes = chambre === 'assemblee' ? state.parliament.assemblee : senatGroupes(state);
  const acc = new Map(groupes.map((g) => [g.groupId, { pour: 0, contre: 0, abstention: 0 }]));
  const malus = chambre === 'assemblee' ? malusCohab(state) : () => 0;
  let adopt = 0;
  for (let k = 0; k < FORECAST_N; k++) {
    const t = tally({ ...state, rng: (k * 2654435761) >>> 0 }, bill, groupes, chambre === 'assemblee' ? AN : SE, chambre, malus);
    if (t.pour > t.contre) adopt++;
    for (const g of t.parGroupe) { const a = acc.get(g.groupId)!; a.pour += g.pour / FORECAST_N; a.contre += g.contre / FORECAST_N; a.abstention += g.abstention / FORECAST_N; }
  }
  const parGroupe = [...acc].map(([groupId, v]) => ({ groupId, ...v }));
  const sum = (k: 'pour' | 'contre' | 'abstention') => parGroupe.reduce((s, g) => s + g[k], 0);
  return { chambre, pour: sum('pour'), contre: sum('contre'), abstention: sum('abstention'), probabiliteAdoption: adopt / FORECAST_N, parGroupe };
}

// Motion de censure après un 49.3 : seuls les groupes hors majorité la votent, selon leur p_contre (σ(−k·s)).
// pour = voix pour la censure ; contre/abstention = membres qui ne la votent pas (la censure ne compte que les voix pour).
export function voteCensure(state: GameState, bill: Bill): { result: VoteResult; rng: number } {
  const groupes = state.parliament.assemblee.filter((g) => g.rapport !== 'majorite');
  // On inverse le sens du score : voter la censure = voter contre la loi.
  const t = tally(state, bill, groupes, AN, 'censure', () => P.censure_malus_493);
  const parGroupe = t.parGroupe.map((g) => ({ groupId: g.groupId, pour: g.contre, contre: g.pour, abstention: g.abstention }));
  const pour = t.contre;
  return {
    result: { chambre: 'censure', date: state.date, pour, contre: t.pour, abstention: t.abstention, adopte: pour >= P.censure_seuil, parGroupe },
    rng: t.rng,
  };
}

// Congrès (art. 89 al. 3) : Assemblée et Sénat réunis, adoption aux trois cinquièmes des suffrages exprimés (constante constitutionnelle).
export function voteCongres(state: GameState, bill: Bill): { result: VoteResult; rng: number } {
  const an = voteBill(state, bill, 'assemblee'), se = voteBill({ ...state, rng: an.rng }, bill, 'senat');
  const pour = an.result.pour + se.result.pour, contre = an.result.contre + se.result.contre;
  return {
    result: { chambre: 'congres', date: state.date, pour, contre, abstention: an.result.abstention + se.result.abstention,
      adopte: 5 * pour >= 3 * (pour + contre),
      parGroupe: [...an.result.parGroupe, ...se.result.parGroupe.map((g) => ({ ...g, groupId: `senat_${g.groupId}` }))] },
    rng: se.rng,
  };
}

const BUDGET_TAGS = /^(fiscalite_.*|austerite_depenses|relance_depenses)$/;
export const isBudget = (bill: Bill) =>
  bill.spec.tags.some((t) => BUDGET_TAGS.test(t)) && (bill.spec.estimatedCost !== 0 || bill.spec.levers.length > 0 || estBudgetaire(bill.spec));

// 49.3 : illimité pour un texte budgétaire, sinon parlement_limite_493 par année civile. Impossible en cohabitation (prérogative
// du PM), pour un gouvernement démissionnaire et pendant une dissolution (ENGINE.md §11). Jamais sur une révision constitutionnelle,
// ni une fois le 49.3 supprimé par une réforme (§14).
export function can493(state: GameState, bill: Bill): boolean {
  if (bill.saisine) return false; // texte déféré ou jugé par le Conseil constitutionnel (§15)
  if (bill.voie || constitutionnel(bill.spec)) return false;
  if (bill.spec.reforme && obstacleReforme(state, bill.spec, bill.id)) return false; // doublon déposé après un rejet (§14)
  const r = regles(state).sans493;
  if (r === 'totale' || (r === 'hors_budget' && !isBudget(bill))) return false;
  const i = state.institutions;
  if (i && (i.gouvernement.profil === 'cohabitation' || i.gouvernement.demissionnaire || i.dissolution)) return false;
  if (isBudget(bill)) return true;
  return state.parliament.usages493.filter((y) => y === state.date.year).length < P.parlement_limite_493;
}
