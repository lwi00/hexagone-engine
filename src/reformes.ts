// Réformes de structure (ENGINE.md §14) : catalogue (gamedata/reformes.json), règles en vigueur dérivées de s.bills, montants
// budgétaires et effets. Pur, sans tirage. N'importe pas init.ts (parliament.ts et institutions.ts importent ce module).
import type { z } from 'zod';
import data from '../gamedata/reformes.json';
import coefficients from '../gamedata/coefficients.json';
import type { Reformes } from './schemas.ts';
import type { ActiveEffect, Bill, BillSpec, GameState, Reforme } from './types.ts';
import { monthIndex } from './types.ts';

type Catalogue = z.infer<typeof Reformes>;
export type Assiette = Catalogue['assiettes'][number];
const D = data as unknown as Catalogue; // validé par scripts/validate-data.ts
const C: Record<string, number> = Object.fromEntries(coefficients.map((c) => [c.id, c.value]));
export const MODELE = new Map(D.modeles.map((m) => [m.id as string, m]));
export const ASSIETTE = new Map(D.assiettes.map((a) => [a.id as string, a]));
export const IMPOT = new Map(D.impots.map((i) => [i.id as string, i]));
export const CAPITALISATION = D.capitalisation;

// Clé de doublon : un impôt créé ou supprimé par assiette ou impôt, sinon une réforme par modèle.
export const cle = (r: Reforme) => (r.modele === 'creer_impot' ? `creer_impot:${r.assiette}` : r.modele === 'supprimer_impot' ? `supprimer_impot:${r.impot}` : r.modele);
// Données propres (assiette, impôt ou modèle) : effets, groupes_touches, positions, tags_requis.
export const defReforme = (r: Reforme) =>
  r.modele === 'creer_impot' ? ASSIETTE.get(r.assiette)! : r.modele === 'supprimer_impot' ? IMPOT.get(r.impot)! : MODELE.get(r.modele)!;
export const constitutionnel = (spec: BillSpec) => !!spec.reforme && MODELE.get(spec.reforme.modele)!.voies.length > 0;
export const estBudgetaire = (spec: BillSpec) => ['creer_impot', 'supprimer_impot', 'capitalisation'].includes(spec.reforme?.modele ?? '');
export const rendement = (a: Assiette, taux: number) => a.rendement_par_unite.value * taux * Math.exp(-a.erosion.value * taux); // Md€ 2026

// d : recette en plus à pleine charge, Md€ 2026 (négatif = recette en moins) ; 0 pour une réforme institutionnelle.
export function montant2026(r: Reforme): number {
  if (r.modele === 'creer_impot') return rendement(ASSIETTE.get(r.assiette)!, r.taux);
  if (r.modele === 'supprimer_impot') return -IMPOT.get(r.impot)!.recette_2026.value;
  if (r.modele === 'capitalisation') return (-r.part / 100) * CAPITALISATION.cotisations_retraite_2026.value;
  return 0;
}

// États partiels des tests unitaires du Parlement : bills absent = aucune loi.
export const adoptees = (s: GameState) => (s.bills ?? []).filter((b) => b.status === 'adoptee' && b.spec.reforme && b.promulgueLe);
export type Regles = { proportionnelle?: { seuil: number; prime: number }; sans493?: 'totale' | 'hors_budget'; supprimes: string[]; crees: string[]; capitalisation?: number };
// Règles en vigueur, dérivées des lois adoptées (comme positionPresident) : rien dans GameState, sauvegardes comprises.
export function regles(s: GameState): Regles {
  const r: Regles = { supprimes: [], crees: [] };
  for (const b of adoptees(s)) {
    const f = b.spec.reforme!;
    if (f.modele === 'proportionnelle') r.proportionnelle = { seuil: f.seuil, prime: f.prime };
    else if (f.modele === 'suppression_493') r.sans493 = f.portee;
    else if (f.modele === 'supprimer_impot') r.supprimes.push(f.impot);
    else if (f.modele === 'creer_impot') r.crees.push(f.assiette);
    else r.capitalisation = f.part;
  }
  return r;
}

// Doublon : un autre texte (≠ billId) de même clé en préparation ou adopté.
export function obstacleReforme(s: GameState, spec: BillSpec, billId?: string): string | null {
  const r = spec.reforme;
  if (!r) return null;
  const b = s.bills.find((x) => x.id !== billId && x.spec.reforme && cle(x.spec.reforme) === cle(r) && (x.status === 'preparation' || x.status === 'adoptee'));
  return b ? `réforme déjà ${b.status === 'adoptee' ? 'en vigueur' : 'déposée'} : ${describeReforme(b.spec.reforme!)} (${b.id})` : null;
}

export const positionsReforme = (r?: Reforme): Record<string, number> | undefined => r && { ...MODELE.get(r.modele)!.positions, ...defReforme(r).positions };
export const groupesReforme = (r?: Reforme) =>
  (r ? defReforme(r).groupes_touches.map((g) => ({ ...g, direction: g.direction * (Math.sign(montant2026(r)) || 1) })) : []);
const rampe = (k: number, n: number) => (k < 0 ? 0 : n > 0 ? Math.min(1, (k + 1) / n) : 1); // convention d'effectValue

// Écarts budgétaires du mois t, Md€ courants, par clé 'recettes.x' ; null si aucune réforme budgétaire adoptée.
export function montantsReformes(s: GameState, t: number, scale: number): Record<string, number> | null {
  const out: Record<string, number> = {};
  const add = (k: string, v: number) => (out[k] = (out[k] ?? 0) + v);
  for (const b of adoptees(s)) {
    const r = b.spec.reforme!, f = scale * rampe(t - monthIndex(b.promulgueLe!), b.spec.rampMonths);
    if (r.modele === 'creer_impot') add(`recettes.impot_${r.assiette}`, rendement(ASSIETTE.get(r.assiette)!, r.taux) * f);
    else if (r.modele === 'supprimer_impot') add(`recettes.${IMPOT.get(r.impot)!.ligne}`, -IMPOT.get(r.impot)!.recette_2026.value * f);
    // Les pensions restent dues (depenses.retraites inchangées) : déficit de transition.
    else if (r.modele === 'capitalisation') add('recettes.cotisations_sociales', (-r.part / 100) * CAPITALISATION.cotisations_retraite_2026.value * f);
  }
  return Object.keys(out).length ? out : null;
}

// Effets non budgétaires à la promulgation (format levers.json, amplitude = élasticité × d) ; effets de groupe plafonnés.
export function effetsReforme(bill: Bill, t: number): ActiveEffect[] {
  const r = bill.spec.reforme;
  if (!r) return [];
  const d = montant2026(r), cap = C.reforme_satisfaction_max;
  return defReforme(r).effets.map((f) => {
    let amp = f.elasticite * d;
    if (f.cible.kind === 'group') amp = Math.max(-cap, Math.min(cap, amp));
    return { source: { kind: 'reforme', id: bill.id }, cible: f.cible, amplitude: amp, forme: f.forme, debut: t + f.delai_mois,
      rampe: f.forme === 'choc' ? f.rampe_mois : Math.max(f.rampe_mois, bill.spec.rampMonths), duree: f.duree_mois };
  });
}

const nb = (x: number, k = 1) => x.toFixed(k).replace(/\.0+$/, '').replace('.', ',');
// Description en français (interface, prompts, modèle de décision).
export function describeReforme(r: Reforme): string {
  switch (r.modele) {
    case 'creer_impot': { const a = ASSIETTE.get(r.assiette)!; return `Création : ${a.libelle_court}, taux ${nb(r.taux, 2)} ${a.unite} (≈ ${nb(rendement(a, r.taux))} Md€/an)`; }
    case 'supprimer_impot': { const i = IMPOT.get(r.impot)!; return `Suppression : ${i.libelle} (${nb(i.recette_2026.value)} Md€ de recette en 2026)`; }
    case 'proportionnelle': return `Scrutin proportionnel aux législatives (seuil ${nb(r.seuil)} % des voix, prime majoritaire ${nb(r.prime)} % des sièges)`;
    case 'suppression_493': return `Suppression du 49.3 (${r.portee === 'totale' ? 'totale' : 'hors textes budgétaires'})`;
    case 'capitalisation': return `Capitalisation : ${nb(r.part)} % des cotisations retraite versés à des fonds (≈ ${nb(-montant2026(r))} Md€/an de cotisations en moins)`;
  }
}
export const VOIE_LABEL = { congres: 'Congrès (3/5 des suffrages exprimés)', referendum: 'Référendum' };
