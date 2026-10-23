// Effets actifs : création (leviers, lois qualitatives, événements), valeur au mois t, agrégation par cible.
import type { ActiveEffect, Bill, GameState } from './types.ts';
import { C, LEVERS, TAGS, centralFactor } from './init.ts';
import { IMPOT, effetsReforme, groupesReforme, regles } from './reformes.ts';

type Target = ActiveEffect['cible'];
type Magnitude = 'faible' | 'moyenne' | 'forte';

const KIND_INDICATEUR: Record<string, string> = { croissance_pib: 'croissance', chomage_bit: 'chomage', inflation: 'inflation', taux_pauvrete: 'pauvrete' };

// Amplitude d'un effet qualitatif (ENGINE.md §5) ; notation : crans directement.
export function bareme(cible: Target, direction: number, magnitude: Magnitude): number {
  if (cible.kind === 'notation') return direction;
  const k = cible.kind === 'indicator' ? KIND_INDICATEUR[cible.id ?? '']
    : cible.kind === 'group' ? 'satisfaction'
    : cible.kind === 'region' ? 'tension'
    : cible.kind;
  return direction * (C[`bareme.${k}.${magnitude}`] ?? 0);
}

// Valeur d'un effet au mois t : rampe linéaire, niveau constant (borné par duree), choc en décroissance linéaire.
export function effectValue(e: ActiveEffect, t: number): number {
  const k = t - e.debut;
  if (k < 0) return 0;
  const rampe = e.rampe > 0 ? Math.min(1, (k + 1) / e.rampe) : 1;
  if (e.forme === 'choc') {
    const d = e.duree ?? 1;
    return k < d ? e.amplitude * rampe * (1 - k / d) : 0;
  }
  return e.duree !== undefined && k >= e.duree ? 0 : e.amplitude * rampe;
}

export const MAX_QUALITATIVE = 3; // effets qualitatifs par loi (validateBill, prompt)
const SCALAIRES = ['popularite', 'stabilite', 'tension', 'prime_risque'];

// Somme des effets actifs par clé : "kind:id" ; "group:id:niveau|choc" ; "notation" (crans pondérés par agence).
// Cibles scalaires (popularite, stabilite, tension, prime_risque) : id ignoré, clé "kind:".
// Effets qualitatifs des lois (source bill, niveau) : cumul plafonné par clé au barème « forte » (scale : Md€ 2026 → courants).
export function sumEffects(effects: ActiveEffect[], t: number, scale = 1): Record<string, number> {
  const acc: Record<string, number> = {};
  const lois: Record<string, { v: number; cap: number }> = {};
  for (const e of effects) {
    let v = effectValue(e, t);
    if (!v) continue;
    const scalaire = SCALAIRES.includes(e.cible.kind);
    let key = `${e.cible.kind}:${scalaire ? '' : e.cible.id ?? ''}`;
    if (e.cible.kind === 'group') key += `:${e.forme}`;
    if (e.cible.kind === 'notation') {
      key = 'notation';
      if (e.cible.id === 'DBRS' || e.cible.id === 'Scope') v *= C.spread_poids_agence_secondaire;
    }
    if (e.source.kind === 'bill' && e.forme === 'niveau') {
      const l = (lois[key] ??= { v: 0, cap: Math.abs(bareme(e.cible, 1, 'forte')) * (e.cible.kind === 'budget' ? scale : 1) });
      l.v += v;
      continue;
    }
    if (e.cible.kind === 'group') v *= e.source.kind === 'event' ? C.satisfaction_poids_evenements : C.satisfaction_poids_lois;
    acc[key] = (acc[key] ?? 0) + v;
  }
  for (const [key, { v, cap }] of Object.entries(lois)) {
    const w = key.startsWith('group:') ? C.satisfaction_poids_lois : 1;
    acc[key] = (acc[key] ?? 0) + w * Math.max(-cap, Math.min(cap, v));
  }
  return acc;
}
// Effet qualitatif (loi ou événement) ; les Md€ sont en euros 2026, convertis au moment de l'application.
export function qualitativeEffect(s: GameState, source: ActiveEffect['source'], cible: Target, direction: number, magnitude: Magnitude,
  forme: 'niveau' | 'choc', debut: number, rampe: number, duree?: number): ActiveEffect {
  const amp = bareme(cible, direction, magnitude) * (cible.kind === 'budget' ? centralFactor(s) : 1);
  return { source, cible, amplitude: amp, forme, debut, rampe, duree };
}

// Promulgation au mois t : leviers (variation bornée → effets du catalogue) et effets qualitatifs. Modifie s.
export function promulgate(s: GameState, bill: Bill, t: number) {
  bill.status = 'adoptee';
  bill.promulgueLe = { ...s.date };
  const scale = centralFactor(s);
  // Levier d'un impôt supprimé entre le dépôt et la promulgation : ignoré (§14). Vide sans réforme.
  const sup = new Set(regles(s).supprimes.flatMap((i) => IMPOT.get(i)!.leviers));
  for (const { id, delta } of bill.spec.levers) {
    if (sup.has(id)) continue;
    const def = LEVERS.get(id);
    const lv = s.levers[id];
    if (!def || !lv) continue;
    const cur = lv.reference + lv.delta;
    const d = Math.min(def.max, Math.max(def.min, cur + delta)) - cur;
    if (!d) continue;
    lv.delta += d;
    for (const f of def.effets) {
      // pensions : l'effet budgétaire suit l'indice Pen (tick.ts), revalorisé chaque 1er janvier
      if (id === 'retraite.indexation_pensions' && f.cible.kind === 'budget') continue;
      s.effects.push({
        source: { kind: 'lever', id }, cible: f.cible as Target,
        amplitude: f.elasticite * d * (f.cible.kind === 'budget' ? scale : 1),
        forme: f.forme as 'niveau' | 'choc', debut: t + f.delai_mois, rampe: f.rampe_mois, duree: 'duree_mois' in f ? f.duree_mois : undefined,
      });
    }
  }
  for (const q of bill.spec.qualitative) {
    s.effects.push(qualitativeEffect(s, { kind: 'bill', id: bill.id }, q.cible, q.direction, q.intensite, 'niveau', t, bill.spec.rampMonths));
  }
  // Réforme de structure (ENGINE.md §14) : un impôt supprimé efface les réglages antérieurs de ses leviers ; effets non budgétaires.
  const r = bill.spec.reforme;
  if (r?.modele === 'supprimer_impot') for (const id of IMPOT.get(r.impot)!.leviers) {
    s.effects = s.effects.filter((e) => !(e.source.kind === 'lever' && e.source.id === id));
    if (s.levers[id]) s.levers[id].delta = 0;
  }
  if (r) s.effects.push(...effetsReforme(bill, t));
}

// Groupes sociaux touchés par une loi (groupes_touches des leviers selon le sens de la variation, réactions des tags).
// Ne touchent jamais la satisfaction (ENGINE.md §3) : seulement le terme « lois impopulaires » de la tension.
// Réaction nette de chaque groupe à une loi (leviers + tags) : intensités signées additionnées (faible 1, moyenne 2, forte 3),
// puis ramenées à une seule entrée par groupe, plafonnée à « forte ». Une loi à quatre leviers ne pèse pas quatre fois.
export function billGroups(bill: Bill): { group: string; direction: number; intensite: Magnitude }[] {
  const W = { faible: 1, moyenne: 2, forte: 3 } as const;
  const net = new Map<string, number>();
  const add = (group: string, direction: number, intensite: string) =>
    net.set(group, (net.get(group) ?? 0) + direction * W[intensite as Magnitude]);
  for (const { id, delta } of bill.spec.levers) for (const g of LEVERS.get(id)?.groupes_touches ?? []) add(g.group, g.direction * Math.sign(delta), g.intensite);
  for (const tag of bill.spec.tags) for (const g of TAGS.get(tag)?.reactions_groupes ?? []) add(g.group, g.direction, g.intensite);
  for (const g of groupesReforme(bill.spec.reforme)) add(g.group, g.direction, g.intensite); // §14
  const out: { group: string; direction: number; intensite: Magnitude }[] = [];
  for (const [group, v] of net) if (v !== 0) out.push({ group, direction: Math.sign(v), intensite: Math.abs(v) >= 3 ? 'forte' : Math.abs(v) >= 2 ? 'moyenne' : 'faible' });
  return out;
}
