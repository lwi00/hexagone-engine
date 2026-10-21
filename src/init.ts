// Données initiales (gamedata/*.json), constantes du moteur et état de départ au 1er janvier 2026.
import coefficients from '../gamedata/coefficients.json';
import macro from '../gamedata/macro.json';
import budget from '../gamedata/budget.json';
import groups from '../gamedata/groups.json';
import regions from '../gamedata/regions.json';
import politics from '../gamedata/politics.json';
import levers from '../gamedata/levers.json';
import events from '../gamedata/events-2026.json';
import randomEvents from '../gamedata/events-random.json';
import tags from '../gamedata/tags.json';
import type { GameMode, GameState, Indicators, Institutions, Rapport, SocialGroup, YearMonth } from './types.ts';

export const C: Record<string, number> = Object.fromEntries(
  coefficients.map((c) => [c.id, c.value]),
);
export const LEVERS = new Map(levers.map((l) => [l.id, l]));
export const TAGS = new Map(tags.map((t) => [t.id, t]));
export { budget, events, groups, politics, randomEvents, regions };

const I0 = macro.indicators;
export const INIT = {
  pib: I0.pib_nominal.value, // PIB 2025, Md€
  inflation: I0.inflation.value,
  chomage: I0.chomage_bit.value,
  deficit: I0.deficit_public.value,
  dette: I0.dette_publique.value,
  spread: I0.spread_oat_bund.value,
  po: I0.prelevements_obligatoires.value,
  dp: I0.depense_publique.value,
  pauvrete: I0.taux_pauvrete.value,
  stabilite: macro.stabilite.value,
  tension: macro.tension_nationale.value,
  popularite: politics.president.popularite.value,
  recettes: Object.values(budget.recettes).reduce((a, v) => a + v.value, 0),
  depenses: Object.values(budget.depenses).reduce((a, v) => a + v.value, 0),
};
// Centrage des niveaux mensuels sur le milieu de 2026 (convention papersim).
export const CENTRAGE = ((C.croissance_potentielle + C.deflateur_pib_tendance) / 1200) * 6;

// Trajectoire macro : simulée deux fois, réelle ("x.") et « fil de l'eau » sans décision ni événement ("r.").
export type Core = {
  lnY: number; lnYt: number; O: number; Ol: number; L: number; Dd: number; Gr: number; perm: number; sPrev: number;
  u: number; pis: number; Ein: number; lnP: number; lnPd: number; lnW: number;
  S: number; Pen: number; Prest: number; lnPsmic: number; // indices base 1 (SMIC de référence, pensions, prestations)
  gH: number[]; pH: number[]; yH: number[]; lnYH: number[]; pibH: number[]; // historiques glissants
};
export type Fin = { D: number; r: number; spread: number; defH: number[] };

export function initCore(): Core {
  const lp = Math.log(1 + INIT.inflation / 100), ly = Math.log(1 + I0.croissance_pib.value / 100);
  // ln P et ln Y des 12 mois précédents (déc. 2025 = 0)
  const pH = Array.from({ length: 12 }, (_, k) => (-(11 - k) * lp) / 12);
  return {
    lnY: 0, lnYt: 0, O: 0, Ol: 0, L: 0, Dd: 0, Gr: 0, perm: 0, sPrev: 0,
    u: INIT.chomage, pis: INIT.inflation, Ein: 0, lnP: 0, lnPd: 0, lnW: 0,
    S: 1, Pen: 1, Prest: 1, lnPsmic: pH[10], // dernière revalorisation du SMIC : indice de novembre 2025
    gH: Array(6).fill(C.croissance_potentielle), pH, yH: Array(12).fill(INIT.inflation),
    lnYH: Array.from({ length: 12 }, (_, k) => (-(11 - k) * ly) / 12), pibH: Array(12).fill(INIT.pib / 12),
  };
}

// internals est un Record<string, number> : les tableaux y sont aplatis en "prefixe.cle.i".
export function save(internals: Record<string, number>, prefix: string, obj: object) {
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) v.forEach((x, i) => (internals[`${prefix}${k}.${i}`] = x));
    else internals[prefix + k] = v;
  }
}
export function load<T>(internals: Record<string, number>, prefix: string): T {
  const o: Record<string, number | number[]> = {};
  for (const [key, v] of Object.entries(internals)) {
    if (!key.startsWith(prefix)) continue;
    const [k, i] = key.slice(prefix.length).split('.');
    if (i === undefined) o[k] = v;
    else ((o[k] ??= []) as number[])[+i] = v;
  }
  return o as T;
}

// Institutions au 1er janvier 2026 (ENGINE.md §11). Les rapports initiaux des groupes restent ceux de rapport_gouvernement.
const isoYM = (d: string): YearMonth => { const [year, month] = d.split('-').map(Number); return { year, month }; };
export const INSTITUTIONS0: Institutions = {
  gouvernement: { premierMinistre: politics.gouvernement.premier_ministre, profil: 'camp_presidentiel', depuis: isoYM(politics.gouvernement.depuis), demissionnaire: false },
  legislatives: isoYM(politics.institutions.dernieres_legislatives),
};
export const inst = (s: GameState): Institutions => s.institutions ?? INSTITUTIONS0; // sauvegardes antérieures

// Facteur du compte central (PIB nominal potentiel, 1 au milieu de 2026) : sert aussi à convertir les Md€ 2026.
export const centralFactor = (s: GameState) => Math.exp(s.internals['x.lnYt'] + s.internals['x.lnPd'] - CENTRAGE);

export function newGame({ seed, mode }: { seed: number; mode: GameMode }): GameState {
  const national: Indicators = {
    croissance_pib: I0.croissance_pib.value, chomage_bit: INIT.chomage, inflation: INIT.inflation, taux_pauvrete: INIT.pauvrete,
    pib_nominal: INIT.pib, deficit_public: INIT.deficit, dette_publique: INIT.dette, dette_publique_md: I0.dette_publique_md.value,
    taux_oat_10: I0.taux_oat_10.value, spread_oat_bund: INIT.spread, prelevements_obligatoires: INIT.po, depense_publique: INIT.dp,
    population: I0.population.value, popularite: INIT.popularite, tension: INIT.tension, stabilite: INIT.stabilite,
  };
  const internals: Record<string, number> = { pl: INIT.popularite, Sl: INIT.stabilite, I: 0, gen: 0 };
  save(internals, 'x.', initCore());
  save(internals, 'r.', initCore());
  save(internals, 'f.', { D: I0.dette_publique_md.value, r: C.taux_apparent_dette, spread: INIT.spread, defH: Array(12).fill(INIT.deficit) } satisfies Fin);
  for (const g of groups) internals[`sl:${g.id}`] = g.satisfaction_initiale.value;
  for (const r of regions) internals[`Tl:${r.code}`] = r.tension_initiale.value;
  return {
    version: 1, seed, rng: seed >>> 0, mode, date: { year: 2026, month: 1 }, national,
    budget: {
      recettes: Object.fromEntries(Object.entries(budget.recettes).map(([k, v]) => [k, v.value])),
      depenses: Object.fromEntries(Object.entries(budget.depenses).map(([k, v]) => [k, v.value])),
    },
    regions: Object.fromEntries(regions.map((r) => [r.code, { chomage: r.chomage.value, tension: r.tension_initiale.value, greve: false }])) as GameState['regions'],
    groups: Object.fromEntries(groups.map((g) => [g.id, { satisfaction: g.satisfaction_initiale.value }])) as Record<SocialGroup, { satisfaction: number }>,
    intentions: Object.fromEntries(politics.intentions_vote.resultats.map((r) => [r.party_id, r.pct])),
    parliament: {
      assemblee: politics.assemblee.groupes.map((g) => ({ groupId: g.id, sieges: g.sieges, rapport: g.rapport_gouvernement as Rapport })),
      usages493: [],
    },
    levers: Object.fromEntries(levers.map((l) => [l.id, { reference: l.valeur_initiale.value, delta: 0 }])),
    effects: [], bills: [], firedEvents: [], internals, history: [], institutions: structuredClone(INSTITUTIONS0),
  };
}
