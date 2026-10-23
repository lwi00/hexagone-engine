// Conseil constitutionnel (ENGINE.md §15) : saisine après l'adoption définitive, décision un mois plus tard (le même mois pour une
// loi de finances), censure partielle ou totale. Probabilités pures et sans tirage ; la décision tire sur une graine dérivée
// (graine, parliament.ts) et n'avance jamais state.rng.
import type { Bill, BillSpec, GameState, Reforme, TurnEvent } from './types.ts';
import { monthIndex, votesSimules } from './types.ts';
import { fond, graine, rand, senatGroupes } from './parliament.ts';
import { bareme, promulgate, qualitativeEffect } from './levers.ts';
import { C, LEVERS, TAGS } from './init.ts';
import { addMonths, toutesRelations } from './institutions.ts';
import { ASSIETTE, constitutionnel, describeReforme } from './reformes.ts';

type Saisine = NonNullable<Bill['saisine']>;
type Motif = 'cavalier' | 'libertes' | 'egalite';
export type Article = { label: string; motif: Motif; p: number; levier?: { id: string; delta: number }; mesure?: BillSpec['qualitative'][number]; reforme?: Reforme };
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

// Saisine (art. 61 al. 2) : groupes hors majorité fortement opposés (fond sous conseil_seuil_opposition ; sous 0 pour une loi de
// finances ou un 49.3, saisis presque toujours en pratique), Assemblée d'abord, puis Sénat. Jamais pour une révision
// constitutionnelle (2003-469 DC) ni en décret. Pur, sans tirage.
export function saisine(s: GameState, b: Bill): Saisine | null {
  if (!votesSimules(s.mode) || b.voie || constitutionnel(b.spec)) return null;
  const lf = b.spec.loiDeFinances !== undefined;
  const seuil = lf || b.usage493 ? 0 : C.conseil_seuil_opposition;
  // Loi de finances : le Conseil statue fin décembre, décision dans le même tick (pas de loi spéciale à tort). Sinon art. 61 al. 3.
  const decisionLe = lf ? { ...s.date } : addMonths(s.date, 1);
  for (const [chambre, groupes] of [['assemblee', s.parliament.assemblee], ['senat', senatGroupes(s)]] as const) {
    const g = groupes.filter((x) => x.rapport !== 'majorite' && fond(b, chambre, x.groupId) < seuil);
    const sieges = g.reduce((a, x) => a + x.sieges, 0);
    if (sieges >= 60) return { chambre, groupes: g.map((x) => x.groupId), sieges, decisionLe }; // art. 61 al. 2, constante constitutionnelle
  }
  return null;
}

// Articles exposés à la censure. Loi de finances : cavaliers (LOLF art. 34), leviers sans effet budgétaire et mesures hors budget.
// Loi ordinaire : mesures qualitatives selon l'exposition maximale de ses tags (forte : e ; moyenne : e × part ; faible : 0) ;
// ses leviers ne sont jamais exposés (pouvoir général d'appréciation du Parlement). Impôt créé au-delà du maximum de Laffer 1/η :
// caractère confiscatoire (2012-662 DC). Articles à p = 0 omis. Pur.
export function articles(b: Bill): Article[] {
  const out: Article[] = [];
  if (b.spec.loiDeFinances !== undefined) {
    for (const l of b.spec.levers) {
      const def = LEVERS.get(l.id);
      if (def && !def.effets.some((f) => f.cible.kind === 'budget')) out.push({ label: def.label, motif: 'cavalier', p: C.conseil_p_cavalier, levier: l });
    }
    for (const q of b.spec.qualitative) if (q.cible.kind !== 'budget') out.push({ label: q.justification, motif: 'cavalier', p: C.conseil_p_cavalier, mesure: q });
  } else {
    let e = 0, motif: Motif = 'libertes';
    for (const tag of b.spec.tags) {
      const c = TAGS.get(tag)?.conseil;
      if (c && c.exposition > e) { e = c.exposition; motif = c.motif as Motif; }
    }
    for (const q of b.spec.qualitative) {
      const p = q.intensite === 'forte' ? e : q.intensite === 'moyenne' ? e * C.conseil_part_moyenne : 0;
      if (p > 0) out.push({ label: q.justification, motif, p, mesure: q });
    }
  }
  const r = b.spec.reforme;
  if (r?.modele === 'creer_impot') {
    const p = C.conseil_p_confiscatoire * clamp((r.taux * ASSIETTE.get(r.assiette)!.erosion.value - 1) / 0.5, 0, 1);
    if (p > 0) out.push({ label: describeReforme(r), motif: 'egalite', p, reforme: r });
  }
  return out;
}

// Probabilités de la décision pour un texte déféré : totale = base + pente × Σp/n ; partielle = (1 − totale)(1 − Π(1 − p)).
// Articles retirés en cas de censure partielle : ceux à p ≥ max/2. S'ils couvrent les n articles de fond, la censure est totale :
// la part partielle passe alors dans la totale (même tirage, issue déterministe), pour que l'aperçu dise ce que fera la décision.
function probas(b: Bill) {
  const arts = articles(b);
  const n = Math.max(1, b.spec.levers.length + b.spec.qualitative.length + (b.spec.reforme ? 1 : 0));
  const max = Math.max(0, ...arts.map((a) => a.p));
  const retires = arts.filter((a) => a.p >= max / 2);
  let totale = C.conseil_totale_base + C.conseil_totale_pente * arts.reduce((a, x) => a + x.p, 0) / n;
  let partielle = (1 - totale) * (1 - arts.reduce((a, x) => a * (1 - x.p), 1));
  if (retires.length >= n) { totale += partielle; partielle = 0; }
  return { arts, n, retires, totale, partielle };
}

// Risque pour la prévisualisation, la décision et le banc. Pur, sans state.rng. Sans saisine : 0.
export function risqueConseil(s: GameState, b: Bill) {
  const sa = saisine(s, b), p = probas(b);
  return {
    saisine: sa && { chambre: sa.chambre, groupes: sa.groupes, sieges: sa.sieges },
    partielle: sa ? p.partielle : 0, totale: sa ? p.totale : 0, articles: p.arts,
  };
}

// Pose la saisine après l'adoption définitive (tick étape 2, 49.3). false = pas de saisine : promulguer tout de suite.
// Pendant l'examen, le texte est 'preparation' (après un 49.3, il était 'rejetee' par l'Assemblée).
export function poser(s: GameState, b: Bill, out: TurnEvent[]): boolean {
  const sa = saisine(s, b);
  if (!sa) return false;
  b.saisine = sa;
  b.status = 'preparation';
  out.push({ kind: 'saisine', billId: b.id, chambre: sa.chambre, groupes: sa.groupes, sieges: sa.sieges });
  return true;
}

// Décision (étape 2a), un seul tirage sur graine(s, 15, t, n° de loi) : identique en tick normal et en prévisualisation.
// Censure partielle : texte réduit puis promulgué (promulgate ne lit que spec ; tags gardés). Modifie s (déjà copié) et b.
export function decider(s: GameState, b: Bill, t: number): TurnEvent[] {
  const sa = b.saisine!;
  const [u] = rand(graine(s, 15, t, Number(/\d+$/.exec(b.id)?.[0] ?? 0)));
  const { n, retires, totale, partielle } = probas(b);
  const issue = u < totale ? 'totale' : u < totale + partielle ? 'partielle' : 'conforme';
  const source = { kind: 'event' as const, id: `conseil:${b.id}` }, d = C.conseil_duree_choc_mois;
  const recul = (k: number) => {
    s.relations = Object.fromEntries(Object.entries(toutesRelations(s)).map(([id, v]) => {
      const g = s.parliament.assemblee.find((x) => x.groupId === id);
      return [id, g && g.rapport !== 'opposition' ? Math.max(-1, v - k) : v];
    }));
  };
  sa.issue = issue;
  if (issue === 'totale') {
    b.status = 'rejetee';
    s.effects.push(qualitativeEffect(s, source, { kind: 'popularite' }, -1, 'moyenne', 'choc', t, 0, d),
      qualitativeEffect(s, source, { kind: 'stabilite' }, -1, 'faible', 'choc', t, 0, d));
    recul(2 * C.conseil_relation_censure);
    return [{ kind: 'conseil', billId: b.id, issue, censures: [] }];
  }
  if (issue === 'partielle') {
    const hors = (x: object) => !retires.some((a) => a.levier === x || a.mesure === x);
    const { reforme, ...reste } = b.spec;
    b.spec = { ...reste, levers: b.spec.levers.filter(hors), qualitative: b.spec.qualitative.filter(hors),
      ...(reforme && !retires.some((a) => a.reforme) && { reforme }) };
    sa.censures = retires.map(({ motif, label, levier, mesure, reforme: r }) => ({ motif, label, ...(levier && { levier }), ...(mesure && { mesure }), ...(r && { reforme: r }) }));
    s.effects.push({ source, cible: { kind: 'popularite' }, amplitude: bareme({ kind: 'popularite' }, -1, 'faible') * retires.length / n, forme: 'choc', debut: t, rampe: 0, duree: d });
    recul(C.conseil_relation_censure);
  } else if (C.conseil_popularite_conforme) {
    s.effects.push({ source, cible: { kind: 'popularite' }, amplitude: C.conseil_popularite_conforme, forme: 'choc', debut: t, rampe: 0, duree: d });
  }
  promulgate(s, b, t);
  return [{ kind: 'conseil', billId: b.id, issue, censures: (sa.censures ?? []).map((c) => c.label) }, { kind: 'promulgation', billId: b.id }];
}

// Étape 2a du tick : décisions dues ce mois (ou en retard), sans filtre de dissolution (le Conseil est indépendant de l'Assemblée).
// Dernier tick (décembre 2030, t = 59) : tout texte déféré est décidé, sinon une loi votée ce mois resterait sans décision.
export const decisions = (s: GameState, t: number): TurnEvent[] => s.bills.flatMap((b) =>
  b.status === 'preparation' && b.saisine && !b.saisine.issue && (monthIndex(b.saisine.decisionLe) <= t || t >= 59) ? decider(s, b, t) : []);
