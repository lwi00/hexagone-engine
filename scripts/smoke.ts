// Test de fumée : parties complètes 2026-2030 sans LLM. Usage : npm run smoke
// Échoue (code 1) sur NaN, valeur hors bornes ou dérive absurde.
import { engine } from '../src/index.ts';
import type { BillSpec, GameMode, GameState } from '../src/types.ts';
import levers from '../gamedata/levers.json';

const loi = (title: string, l: BillSpec['levers'], q: BillSpec['qualitative'], tags: string[]): BillSpec =>
  ({ title, summary: title, articles: [title], levers: l, qualitative: q, tags, prepMonths: 1, rampMonths: 6, estimatedCost: 0 });

// Lois scriptées, déposées au mois indiqué (index depuis janvier 2026).
const LOIS: [number, BillSpec][] = [
  [2, loi('TVA +1 point', [{ id: 'tva.taux_normal', delta: 1 }], [], ['fiscalite_hausse'])],
  [5, loi('SMIC +50 €', [{ id: 'travail.smic', delta: 50 }], [], ['redistribution'])],
  [8, loi('Loi de programmation militaire', [{ id: 'depenses.defense', delta: 5 }], [], ['relance_depenses', 'securite_justice'])],
  [14, loi('Plan de soutien aux agriculteurs', [], [{ cible: { kind: 'group', id: 'agriculteurs' }, direction: 1, intensite: 'moyenne', justification: 'aides directes' }], ['agriculture_soutien'])],
];

const BORNES = new Map(levers.map((l) => [l.id, [l.min, l.max]]));
const errors: string[] = [];
const check = (ok: boolean, msg: string) => { if (!ok && errors.length < 20) errors.push(msg); };

function verifie(s: GameState, label: string, sansAction: boolean) {
  const d = `${label} ${s.date.year}-${String(s.date.month).padStart(2, '0')}`;
  const nums: [string, number][] = [
    ...Object.entries(s.national), ...Object.entries(s.intentions),
    ...Object.entries(s.budget.recettes), ...Object.entries(s.budget.depenses),
    ...Object.entries(s.groups).map(([k, g]): [string, number] => [`groupe ${k}`, g.satisfaction]),
    ...Object.entries(s.regions).flatMap(([k, r]): [string, number][] => [[`chomage ${k}`, r.chomage], [`tension ${k}`, r.tension]]),
  ];
  for (const [k, v] of nums) check(Number.isFinite(v), `${d} : ${k} = ${v}`);
  const n = s.national;
  for (const k of ['popularite', 'tension', 'stabilite'] as const) check(n[k] >= 0 && n[k] <= 1, `${d} : ${k} = ${n[k]} hors [0,1]`);
  for (const [k, g] of Object.entries(s.groups)) check(g.satisfaction >= 0 && g.satisfaction <= 1, `${d} : satisfaction ${k} = ${g.satisfaction}`);
  for (const [k, r] of Object.entries(s.regions)) check(r.tension >= 0 && r.tension <= 1, `${d} : tension ${k} = ${r.tension}`);
  const somme = Object.values(s.intentions).reduce((a, b) => a + b, 0);
  check(Math.abs(somme - 100) < 0.5, `${d} : intentions somment à ${somme}`);
  check(n.chomage_bit > 2 && n.chomage_bit < 30, `${d} : chômage ${n.chomage_bit}`);
  check(n.inflation > -5 && n.inflation < 20, `${d} : inflation ${n.inflation}`);
  check(n.taux_oat_10 > 0 && n.taux_oat_10 < 15, `${d} : OAT ${n.taux_oat_10}`);
  check(n.dette_publique < (sansAction ? 300 : 400), `${d} : dette ${n.dette_publique} % du PIB`);
  for (const [id, l] of Object.entries(s.levers)) {
    const [min, max] = BORNES.get(id)!; const v = l.reference + l.delta;
    check(v >= min - 1e-9 && v <= max + 1e-9, `${d} : levier ${id} = ${v} hors [${min}, ${max}]`);
  }
}

const f = (x: number, k = 1) => x.toFixed(k).padStart(6);
function partie(label: string, mode: GameMode, avecLois: boolean) {
  console.log(`\n== ${label} (${mode}${avecLois ? ', lois scriptées' : ', sans action'}) ==`);
  console.log('  date      croiss chômage  infl. déficit  dette   OAT  popul. tension stab.');
  let s = engine.newGame({ seed: 42, mode });
  for (let t = 0; !engine.isOver(s); t++) {
    if (avecLois) for (const [m, spec] of LOIS) if (m === t) {
      const pb = engine.validateBill(s, spec);
      check(pb.length === 0, `${label} : « ${spec.title} » invalide : ${pb.join(', ')}`);
      s = engine.addDraft(s, spec);
      s = engine.deposit(s, s.bills[s.bills.length - 1].id);
    }
    // Loi rejetée à l'Assemblée : on tente le 49.3.
    for (const b of s.bills) if (b.status === 'rejetee' && !b.usage493) {
      const r = engine.use493(s, b.id);
      if (r.events.length) console.log(`  ${b.spec.title} rejetée → 49.3, censure ${r.events.some((e) => e.kind === 'censure' && e.adoptee) ? 'adoptée' : 'repoussée'}`);
      s = r.state;
    }
    s = engine.endTurn(s).state;
    verifie(s, label, !avecLois);
    const n = s.national;
    if (s.date.month === 1 || engine.isOver(s))
      console.log(`  ${s.date.year}-${String(s.date.month).padStart(2, '0')} ${f(n.croissance_pib, 2)} ${f(n.chomage_bit, 2)} ${f(n.inflation, 2)} ${f(n.deficit_public, 2)} ${f(n.dette_publique)} ${f(n.taux_oat_10, 2)} ${f(n.popularite, 2)} ${f(n.tension, 2)} ${f(n.stabilite, 2)}`);
  }
  if (avecLois) console.log('  lois : ' + s.bills.map((b) => `${b.spec.title} [${b.status}]`).join(' ; '));
  return s;
}

partie('Référence', 'democratie', false);
const decret = partie('Décret', 'decret', true);
partie('Démocratie', 'democratie', true);
check(decret.bills.every((b) => b.status === 'adoptee'), 'Décret : toutes les lois devraient être adoptées');
check(decret.levers['tva.taux_normal'].delta === 1, 'Décret : TVA non appliquée');

// Prévisualisation : effet de la TVA +1 sur 60 mois, valeurs finies et sens attendu.
const p = engine.previewBill(engine.newGame({ seed: 42, mode: 'democratie' }), LOIS[0][1], 60);
for (const [k, v] of Object.entries(p.ecart)) check(Number.isFinite(v), `Prévisualisation : écart ${k} = ${v}`);
check(p.budget.find((l) => l.ligne === 'recettes.tva')!.ecart > 0, 'Prévisualisation : recettes de TVA non relevées');
check(p.vote.length === 2 && p.vote.every((v) => v.probabiliteAdoption >= 0 && v.probabiliteAdoption <= 1), 'Prévisualisation : prévision de vote invalide');
console.log(`\nPrévisualisation TVA +1 (60 mois) : dette ${p.ecart.dette_publique!.toFixed(2)} pt de PIB, inflation ${p.ecart.inflation!.toFixed(2)} pt, `
  + `adoption AN ${(100 * p.vote[0].probabiliteAdoption).toFixed(0)} %`);

if (errors.length) { console.error('\nÉCHEC :\n- ' + errors.join('\n- ')); process.exit(1); }
console.log('\nOK : aucune anomalie.');
