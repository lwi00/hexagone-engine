// Banc d'équilibrage : scénarios types joués sans LLM, et calage 2026 sur la réalité. Usage : npm run balance
// Sert à régler gamedata/coefficients.json : on lit les tableaux, on ajuste, on relance.
import { engine } from '../src/index.ts';
import { forecastCircuit, parBloc } from '../src/institutions.ts';
import { CANDIDATS } from '../src/presidentielle.ts';
import { forecastVote } from '../src/parliament.ts';
import { ASSIETTE, IMPOT, describeReforme, rendement } from '../src/reformes.ts';
import { C, politics } from '../src/init.ts';
import type { BillSpec, GameState, Reforme, TurnEvent } from '../src/types.ts';

const loi = (title: string, levers: BillSpec['levers'], tags: string[], qualitative: BillSpec['qualitative'] = []): BillSpec =>
  ({ title, summary: title, articles: [title], levers, qualitative, tags, prepMonths: 1, rampMonths: 6, estimatedCost: 0 });

const SCENARIOS: Record<string, BillSpec[]> = {
  'Ne rien faire': [],
  'Austérité (−20 Md€, TVA +1)': [loi('Austérité', [
    { id: 'depenses.sante', delta: -5 }, { id: 'depenses.collectivites', delta: -8 }, { id: 'depenses.aides_sociales', delta: -7 },
    { id: 'tva.taux_normal', delta: 1 }], ['austerite_depenses', 'fiscalite_hausse'])],
  'Relance (+20 Md€)': [loi('Relance', [
    { id: 'depenses.ecologie', delta: 8 }, { id: 'depenses.education', delta: 6 }, { id: 'depenses.sante', delta: 6 }], ['relance_depenses', 'services_publics'])],
  'Retraites à 64 ans': [loi('Retraites 64 ans', [{ id: 'retraite.age_legal', delta: 1.25 }], ['retraites_durcissement', 'austerite_depenses'])],
  'SMIC +100 €': [loi('SMIC +100 €', [{ id: 'travail.smic', delta: 100 }], ['redistribution'])],
  'Défense +5 Md€': [loi('Défense', [{ id: 'depenses.defense', delta: 5 }], ['securite_justice', 'relance_depenses'])],
  'Dérapage (+90 Md€, TVA −5)': [loi('Dérapage', [
    { id: 'depenses.sante', delta: 30 }, { id: 'depenses.education', delta: 30 }, { id: 'depenses.aides_sociales', delta: 30 }, { id: 'tva.taux_normal', delta: -5 }], ['relance_depenses'])],
  'Austérité brutale': [loi('Austérité brutale', [
    { id: 'retraite.age_legal', delta: 3 }, { id: 'tva.taux_normal', delta: 4 }, { id: 'depenses.aides_sociales', delta: -30 }, { id: 'depenses.sante', delta: -20 }],
    ['retraites_durcissement', 'austerite_depenses', 'fiscalite_hausse'])],
};

// Changements de rapport d'un groupe (ENGINE.md §13) : attendu 0 dans les cohortes « au gouvernement » sans loi répétée.
const nRapports = (ev: TurnEvent[]) => ev.filter((e) => e.kind === 'rapport').length;
const pct = (x: number) => (100 * x).toFixed(0).padStart(4);
const f = (x: number, k = 1) => x.toFixed(k).padStart(6);

// Un mois : 49.3 systématique après un rejet, nomination obligatoire d'un PM du camp présidentiel si le gouvernement est démissionnaire.
function avance(s: GameState) {
  for (const b of s.bills) if (b.status === 'rejetee' && !b.usage493) s = engine.use493(s, b.id).state;
  if (engine.pouvoir(s).gouvernement.demissionnaire) s = engine.nominate(s, 'camp_presidentiel').state;
  return engine.endTurn(s);
}

function joue(lois: BillSpec[], seed: number, mode: 'democratie' | 'decret') {
  let s = engine.newGame({ seed, mode });
  for (const spec of lois) { s = engine.addDraft(s, spec); s = engine.deposit(s, s.bills[s.bills.length - 1].id); }
  const snaps: GameState[] = [];
  const greves = new Set<string>();
  let maxGreves = 0, bascules = 0;
  while (!engine.isOver(s)) {
    const r = avance(s);
    s = r.state;
    bascules += nRapports(r.report.events);
    snaps.push(s);
    const g = Object.entries(s.regions).filter(([, r]) => r.greve).map(([c]) => c);
    g.forEach((c) => greves.add(c));
    maxGreves = Math.max(maxGreves, g.length);
  }
  return { s, snaps, greves, maxGreves, bascules };
}

console.log('== Scénarios (mode décret : effet pur des mesures ; seed 1) ==');
console.log('scénario                       mois  croiss chômage  infl. déficit  dette  OAT  pop  tens stab  écart-type tension rég.');
const base = joue([], 1, 'decret');
for (const [nom, lois] of Object.entries(SCENARIOS)) {
  const { snaps, greves, maxGreves } = joue(lois, 1, 'decret');
  for (const m of [6, 12, 24, 59]) {
    if (!snaps[m]) { console.log(`${''.padEnd(30)} ${String(m + 1).padStart(4)}   partie perdue (${base.s.defaite ? '' : snaps.at(-1)!.defaite?.cause})`); break; }
    const n = snaps[m].national, b = base.snaps[m].national;
    // Écart-type entre régions de l'effet sur la tension (0 = toutes les régions réagissent pareil).
    const tens = (Object.keys(snaps[m].regions) as (keyof GameState['regions'])[]).map((k) => snaps[m].regions[k].tension - base.snaps[m].regions[k].tension);
    const moy = tens.reduce((a, x) => a + x, 0) / tens.length;
    const et = Math.sqrt(tens.reduce((a, x) => a + (x - moy) ** 2, 0) / tens.length);
    const d = (k: keyof typeof n, kk = 2) => (nom === 'Ne rien faire' ? f(n[k], kk) : f(n[k] - b[k], kk));
    console.log(`${(m === 6 ? nom : '').padEnd(30)} ${String(m + 1).padStart(4)} ${d('croissance_pib')} ${d('chomage_bit')} ${d('inflation')} ${d('deficit_public')} ${d('dette_publique', 1)} ${d('taux_oat_10')} ${nom === 'Ne rien faire' ? pct(n.popularite) : f(100 * (n.popularite - b.popularite), 1)} ${nom === 'Ne rien faire' ? pct(n.tension) : f(100 * (n.tension - b.tension), 1)} ${nom === 'Ne rien faire' ? pct(n.stabilite) : f(100 * (n.stabilite - b.stabilite), 1)}   ${f(100 * et, 2)}`);
  }
  console.log(`${''.padEnd(30)}      régions passées en grève : ${greves.size} (max simultané ${maxGreves})`);
}

console.log('\n== Votes en démocratie (10 graines) : adoptions à l\'AN / 49.3 / censures ==');
for (const [nom, lois] of Object.entries(SCENARIOS)) {
  if (!lois.length) continue;
  let adopt = 0, n493 = 0, cens = 0;
  const probas: number[] = [];
  for (let seed = 1; seed <= 10; seed++) {
    const s0 = engine.newGame({ seed, mode: 'democratie' });
    probas.push(engine.previewBill(s0, lois[0], 12).vote[0]?.probabiliteAdoption ?? NaN);
    const { s } = joue(lois, seed, 'democratie');
    const b = s.bills[0];
    if (b.votes[0]?.adopte) adopt++;
    if (b.usage493) n493++;
    if (b.status === 'censuree') cens++;
  }
  console.log(`${nom.padEnd(30)} AN ${adopt}/10, 49.3 ${n493}/10, censure ${cens}/10, probabilité prévue ${probas.map((p) => pct(p)).join(' ')}`);
}

console.log('\n== Événements aléatoires et défaites (50 graines, démocratie, 49.3 systématique) ==');
const causes: Record<string, number> = {};
for (const [nom, lois] of Object.entries(SCENARIOS)) {
  let nEv = 0, mois = 0, def = 0, tDef = 0, bas = 0;
  for (const k of Object.keys(causes)) delete causes[k];
  for (let seed = 1; seed <= 50; seed++) {
    const { s, snaps, bascules } = joue(lois, seed, 'democratie');
    mois += snaps.length;
    bas += bascules;
    // ponytail: les événements aléatoires sont recomptés depuis internals (dernier tirage par modèle) : sous-estime les répétitions
    nEv += snaps.reduce((a, x, i) => a + Object.keys(x.internals).filter((k) => k.startsWith('ev:') && x.internals[k] === i).length, 0);
    if (s.defaite) { def++; tDef += snaps.length; causes[s.defaite.cause] = (causes[s.defaite.cause] ?? 0) + 1; }
  }
  console.log(`${nom.padEnd(30)} événements/an ${f((12 * nEv) / mois)}   défaites ${String(def).padStart(2)}/50 ${def ? `(mois moyen ${Math.round(tDef / def)}, ${JSON.stringify(causes)})` : ''}   bascules ${bas}`);
}

console.log('\n== Dissolution au 13e mois (50 graines × 4 scénarios, démocratie) : issue selon la popularité, puis 12 mois ==');
{
  const TRANCHES = ['<15 %', '15–20', '20–25', '≥25 %'];
  const tranche = (p: number) => (p < 0.15 ? 0 : p < 0.2 ? 1 : p < 0.25 ? 2 : 3);
  type Ligne = { n: number; pop: number; hor: number; blocs: number[]; issues: Record<string, number>; prevu: number; obtenu: number; stab: number };
  const L: Ligne[] = TRANCHES.map(() => ({ n: 0, pop: 0, hor: 0, blocs: [], issues: { majorite: 0, cohabitation: 0, sans_majorite: 0 }, prevu: 0, obtenu: 0, stab: 0 }));
  let noms: string[] = [];
  // Gouvernement démissionnaire après le scrutin : chaque profil nommable est joué 12 mois (défaites, stabilité).
  const PROFILS = ['camp_presidentiel', 'ouverture_gauche', 'ouverture_droite', 'technicien'] as const;
  const P = PROFILS.map(() => ({ def: 0, stab: 0, bas: 0 }));
  let nP = 0, bas = 0;
  const douze = (s: GameState, b = { n: 0 }) => {
    for (let i = 0; i < 12 && !engine.isOver(s); i++) { const r = avance(s); s = r.state; b.n += nRapports(r.report.events); }
    return s;
  };
  for (const nom of ['Ne rien faire', 'Relance (+20 Md€)', 'SMIC +100 €', 'Austérité brutale']) {
    for (let seed = 1; seed <= 50; seed++) {
      let s = engine.newGame({ seed, mode: 'democratie' });
      for (const spec of SCENARIOS[nom]) { s = engine.addDraft(s, spec); s = engine.deposit(s, s.bills[s.bills.length - 1].id); }
      for (let i = 0; i < 12 && !engine.isOver(s); i++) s = avance(s).state;
      if (!engine.pouvoir(s).peutDissoudre) continue; // défaite avant le 13e mois
      const pop = s.national.popularite, hor = s.intentions.horizons, fc = engine.forecastLegislatives(s);
      const r = engine.endTurn(engine.dissolve(s).state);
      const leg = r.report.events.find((e) => e.kind === 'legislatives');
      if (leg?.kind !== 'legislatives') throw new Error('législatives absentes');
      s = r.state;
      if (engine.pouvoir(s).gouvernement.demissionnaire) {
        nP++;
        PROFILS.forEach((p, i) => {
          const b = { n: 0 }, x = douze(engine.nominate(s, p).state, b);
          P[i].def += x.defaite ? 1 : 0; P[i].stab += x.national.stabilite; P[i].bas += b.n;
        });
      }
      const b = { n: nRapports(r.report.events) };
      s = douze(s, b); // camp présidentiel si démissionnaire (avance)
      bas += b.n;
      const l = L[tranche(pop)], blocs = parBloc(leg.apres);
      noms = blocs.map((b) => b.id);
      l.n++; l.pop += pop; l.hor += hor; l.issues[leg.issue]++;
      blocs.forEach((b, i) => (l.blocs[i] = (l.blocs[i] ?? 0) + b.sieges));
      l.prevu += fc.blocs.find((b) => b.id === 'centre')!.sieges; l.obtenu += blocs.find((b) => b.id === 'centre')!.sieges;
      l.stab += s.national.stabilite;
    }
  }
  console.log(`tranche    n   pop  horiz ${noms.map((b) => b.padStart(7)).join('')}   maj.  cohab. sans maj.   centre prévu/obtenu   stab +12 mois`);
  L.forEach((l, i) => {
    if (!l.n) return console.log(`${TRANCHES[i].padEnd(8)} ${String(0).padStart(3)}`);
    console.log(`${TRANCHES[i].padEnd(8)} ${String(l.n).padStart(3)} ${pct(l.pop / l.n)} ${f(l.hor / l.n)} ${l.blocs.map((x) => f(x / l.n, 0).padStart(7)).join('')}  ${pct(l.issues.majorite / l.n)}  ${pct(l.issues.cohabitation / l.n)}     ${pct(l.issues.sans_majorite / l.n)}     ${f(l.prevu / l.n, 0)} / ${f(l.obtenu / l.n, 0)}          ${pct(l.stab / l.n)}`);
  });
  console.log(`bascules (scrutin et 12 mois suivants, toutes tranches) : ${bas}`);
  console.log(`Gouvernement démissionnaire après le scrutin (${nP} cas), profil nommé : défaites en 12 mois / stabilité finale / bascules`);
  console.log(PROFILS.map((p, i) => `  ${p.padEnd(18)} ${String(P[i].def).padStart(3)}/${nP} ${pct(P[i].stab / nP)}   ${P[i].bas}`).join('\n'));
}

console.log('\n== Calage 2026 (sans action, démocratie, seed 1) vs réalité ==');
const r = joue([], 1, 'democratie').snaps;
const at = (y: number, m: number) => r[(y - 2026) * 12 + m - 1].national;
const CIBLES: [string, number, number, (n: GameState['national']) => number, string][] = [
  ['Inflation août 2026', 2026, 8, (n) => n.inflation, '2,4 %'],
  ['Inflation septembre 2026', 2026, 9, (n) => n.inflation, '3,1 %'],
  ['Chômage juin 2026 (T2)', 2026, 6, (n) => n.chomage_bit, '8,3 %'],
  ['Spread fin septembre 2026', 2026, 9, (n) => n.spread_oat_bund, '124 pb'],
];
for (const [label, y, m, get, reel] of CIBLES) console.log(`${label.padEnd(30)} simulé ${f(get(at(y, m)), 2)}   réel ${reel}`);
const smic = r.findIndex((s) => s.levers['travail.smic'].reference !== r[0].levers['travail.smic'].reference);
console.log(`Première revalorisation du SMIC : ${smic < 0 ? 'aucune' : `${r[smic].history.at(-1)!.date.year}-${r[smic].history.at(-1)!.date.month}`}   réel 2026-6`);
console.log('Tension nationale 2026 :', r.slice(0, 12).map((s) => pct(s.national.tension)).join(''));
console.log('Popularité 2026        :', r.slice(0, 12).map((s) => pct(s.national.popularite)).join(''));
console.log('Régions en grève 2026  :', r.slice(0, 12).map((s) => String(Object.values(s.regions).filter((x) => x.greve).length).padStart(4)).join(''));

console.log('\n== Camps (bac à sable, sans action, seed 1) : assise de départ, présidentielle prévue au départ et au 15e mois ==');
console.log('camp             maj. soutien opp.   victoire départ / avril 2027   bascules');
for (const camp of [undefined, ...CANDIDATS]) {
  let s = engine.newGame({ seed: 1, mode: 'bac_a_sable', camp });
  const a = engine.pouvoir(s).assise, v0 = engine.forecastPresidentielle(s).victoire;
  let bas = 0;
  for (let i = 0; i < 15; i++) { const r = avance(s); s = r.state; bas += nRapports(r.report.events); }
  console.log(`${(camp ?? 'au gouvernement').padEnd(16)} ${String(a.majorite).padStart(4)} ${String(a.soutien_conditionnel).padStart(7)} ${String(a.opposition).padStart(4)}   ${pct(v0)} / ${pct(engine.forecastPresidentielle(s).victoire)}                ${bas}`);
}

console.log('\n== Réformes (décret, 50 graines, contre « Ne rien faire ») ==');
{
  // 60 mois joués sans arrêt à la défaite (présidentielle comprise) : seul l'écart à « Ne rien faire » compte.
  const soixante = (lois: BillSpec[], seed: number) => {
    let s = engine.newGame({ seed, mode: 'decret' });
    for (const spec of lois) { s = engine.addDraft(s, spec); s = engine.deposit(s, s.bills[s.bills.length - 1].id); }
    const snaps: GameState[] = [];
    for (let i = 0; i < 60; i++) { s = engine.endTurn(s).state; snaps.push(s); }
    return snaps;
  };
  const ref = (r: Reforme, tag: string): BillSpec => ({ ...loi(describeReforme(r), [], [tag]), reforme: r, rampMonths: 12 });
  const MODELES: [string, Reforme, string, string][] = [
    ...[...ASSIETTE.values()].map((a) => [a.id, { modele: 'creer_impot', assiette: a.id, taux: a.taux_defaut }, a.tags_requis[0], `recettes.impot_${a.id}`] as [string, Reforme, string, string]),
    ...(['ifi', 'taxe_fonciere', 'ir'] as const).map((i) => [`supprimer ${i}`, { modele: 'supprimer_impot', impot: i }, 'fiscalite_baisse', `recettes.${IMPOT.get(i)!.ligne}`] as [string, Reforme, string, string]),
    ...[5, 10].map((part) => [`capitalisation ${part} %`, { modele: 'capitalisation', part }, 'retraites_durcissement', 'recettes.cotisations_sociales'] as [string, Reforme, string, string]),
  ];
  const bases = Array.from({ length: 50 }, (_, k) => soixante([], k + 1));
  const ligne = (s: GameState, l: string) => { const [c, k] = l.split('.') as ['recettes', string]; return s.budget[c][k] ?? 0; };
  console.log('modèle (défaut)                ligne 2027  ligne 2030  déficit 2030  dette 2030  pop 2027   défaites démocratie');
  for (const [nom, r, tag, l] of MODELES) {
    const m = { l27: 0, l30: 0, def: 0, dette: 0, pop: 0 };
    let def = 0;
    const causes: Record<string, number> = {};
    for (let k = 0; k < 50; k++) {
      const a = soixante([ref(r, tag)], k + 1), b = bases[k];
      m.l27 += (ligne(a[23], l) - ligne(b[23], l)) / 50; m.l30 += (ligne(a[59], l) - ligne(b[59], l)) / 50;
      m.def += (a[59].national.deficit_public - b[59].national.deficit_public) / 50; m.dette += (a[59].national.dette_publique - b[59].national.dette_publique) / 50;
      m.pop += (100 * (a[23].national.popularite - b[23].national.popularite)) / 50;
      const { s } = joue([ref(r, tag)], k + 1, 'democratie');
      if (s.defaite) { def++; causes[s.defaite.cause] = (causes[s.defaite.cause] ?? 0) + 1; }
    }
    console.log(`${nom.padEnd(30)} ${f(m.l27, 1).padStart(10)}  ${f(m.l30, 1).padStart(10)}  ${f(m.def, 2).padStart(12)}  ${f(m.dette, 1).padStart(10)}  ${f(m.pop, 1).padStart(7)}   ${String(def).padStart(2)}/50 ${JSON.stringify(causes)}`);
  }

  const a = ASSIETTE.get('tres_hauts_patrimoines')!;
  console.log(`Laffer tres_hauts_patrimoines (Md€ 2026) : ${[1, 2, 3, 4, 5].map((t) => `${t} % → ${rendement(a, t).toFixed(1)}`).join(' ; ')}`);

  // Circuit constitutionnel et législatives, seed 1, démocratie, état initial.
  const s0 = engine.newGame({ seed: 1, mode: 'democratie' });
  console.log('circuit (seed 1)               P(AN) P(Sénat) Congrès référendum  oui moyen');
  for (const r of [{ modele: 'suppression_493', portee: 'totale' }, { modele: 'proportionnelle', seuil: 5, prime: 0 }] as Reforme[]) {
    const bill = { id: 'x', spec: ref(r, 'institutions_democratie_directe'), status: 'preparation' as const, votes: [] };
    const c = forecastCircuit(s0, bill);
    console.log(`${r.modele.padEnd(30)} ${pct(forecastVote(s0, bill, 'assemblee').probabiliteAdoption)}  ${pct(forecastVote(s0, bill, 'senat').probabiliteAdoption).padStart(6)}  ${pct(c.congres).padStart(6)}  ${pct(c.referendum).padStart(9)}  ${f(c.oui, 1).padStart(9)}`);
  }
  const adopte = (r: Reforme) => {
    const s = engine.addDraft(s0, ref(r, 'institutions_democratie_directe'));
    Object.assign(s.bills[s.bills.length - 1], { status: 'adoptee', promulgueLe: s0.date });
    return s;
  };
  console.log(`législatives (seed 1)          ${politics.institutions.blocs.map((b) => b.id.padStart(7)).join('')}   maj.  cohab. sans maj.`);
  for (const [nom, s] of [['scrutin majoritaire', s0], ['proportionnelle 5 %', adopte({ modele: 'proportionnelle', seuil: 5, prime: 0 })],
    ['proportionnelle 5 %, prime 15', adopte({ modele: 'proportionnelle', seuil: 5, prime: 15 })]] as [string, GameState][]) {
    const fc = engine.forecastLegislatives(s);
    console.log(`${nom.padEnd(30)} ${fc.blocs.map((b) => f(b.sieges, 0).padStart(7)).join('')}  ${pct(fc.issues.majorite)}  ${pct(fc.issues.cohabitation)}     ${pct(fc.issues.sans_majorite)}`);
  }
  // Recoupements historiques du référendum, consignes moyennes (−1..1) approximatives, z = 0 : formule de referendumOui.
  const oui = (pop: number, c: number) => 100 / (1 + Math.exp(-(C.referendum_poids_popularite * (pop - C.referendum_pivot) + C.referendum_poids_consignes * c)));
  console.log('recoupements (popularité, consignes → oui simulé / réel) : ' + ([['1969', 0.45, -0.3, '47,6'], ['1992', 0.3, 0.4, '51,0'], ['2000', 0.5, 0.8, '73,2'], ['2005', 0.35, 0.3, '45,3']] as const)
    .map(([y, p, c, r]) => `${y} (${p}, ${c}) → ${oui(p, c).toFixed(0)} / ${r}`).join(' ; '));
}
