// Réformes de structure (ENGINE.md §14).
import { describe, expect, test } from 'vitest';
import { engine } from './index.ts';
import { BillSpec } from './types.ts';
import type { Bill, GameMode, GameState, Reforme } from './types.ts';
import { REQUIRED_COEFFICIENTS } from './schemas.ts';
import { centralFactor } from './init.ts';
import { billGroups } from './levers.ts';
import { can493, isBudget } from './parliament.ts';
import { forecastLegislatives, referendumOui, resoudreReferendum, scrutin } from './institutions.ts';
import { ASSIETTE, effetsReforme, montantsReformes, regles, rendement } from './reformes.ts';
import events from '../gamedata/events-2026.json';
import budget from '../gamedata/budget.json';
import politics from '../gamedata/politics.json';
import coefficients from '../gamedata/coefficients.json';

const C = Object.fromEntries(coefficients.map((c) => [c.id, c.value]));
const spec = (reforme: Reforme | undefined, tags: string[], extra: Partial<BillSpec> = {}): BillSpec => ({
  title: 'Réforme test', summary: 'Résumé', articles: ['Article 1'], levers: [], qualitative: [], tags,
  prepMonths: 0, rampMonths: 12, estimatedCost: 0, ...(reforme && { reforme }), ...extra,
});
const start = (mode: GameMode = 'decret', seed = 1) => {
  const s = engine.newGame({ seed, mode });
  s.firedEvents = [...events.map((e) => e.id), ...[2027, 2028, 2029, 2030].map((y) => `loi_speciale_${y}`)];
  return s;
};
const run = (s: GameState, n: number) => { for (let i = 0; i < n; i++) s = engine.endTurn(s).state; return s; };
const pass = (s: GameState, sp: BillSpec, voie?: 'congres' | 'referendum') => {
  s = engine.addDraft(s, sp);
  return engine.deposit(s, s.bills.at(-1)!.id, voie);
};
// Loi adoptée sans passer par le tick (règles en vigueur, prévisions).
const adoptee = (s: GameState, sp: BillSpec) => {
  const r = engine.addDraft(s, sp);
  Object.assign(r.bills.at(-1)!, { status: 'adoptee', promulgueLe: { ...s.date } });
  return r;
};
const positions = (an: number, se: number) => Object.fromEntries([
  ...politics.assemblee.groupes.map((g) => [`assemblee_${g.id}`, an]), ...politics.senat.groupes.map((g) => [`senat_${g.id}`, se])]);
const THP: Reforme = { modele: 'creer_impot', assiette: 'tres_hauts_patrimoines', taux: 2 };
const P493: Reforme = { modele: 'suppression_493', portee: 'totale' };
const PROP: Reforme = { modele: 'proportionnelle', seuil: 5, prime: 0 };
const ordinaire = (tags: string[], extra: Partial<BillSpec> = {}): Bill => ({ id: 'x', spec: spec(undefined, tags, extra), status: 'preparation', votes: [] });

describe('parse et validateBill', () => {
  test('un BillSpec par modèle passe le parse ; assiette inconnue refusée', () => {
    for (const r of [THP, { modele: 'supprimer_impot', impot: 'ifi' }, PROP, P493, { modele: 'capitalisation', part: 5 }] as Reforme[])
      expect(BillSpec.safeParse(spec(r, ['fiscalite_hausse'])).success).toBe(true);
    expect(BillSpec.safeParse(spec({ modele: 'creer_impot', assiette: 'yachts', taux: 1 } as never, ['fiscalite_hausse'])).success).toBe(false);
  });

  test('messages d\'erreur', () => {
    const s = start();
    const v = (sp: BillSpec, st = s) => engine.validateBill(st, sp);
    expect(v(spec({ ...THP, taux: 6 } as Reforme, ['fiscalite_hausse']))).toContain('reforme.taux : 6 hors bornes [0.5, 5] pour tres_hauts_patrimoines (%)');
    expect(v(spec(THP, ['securite_justice']))).toContain('reforme creer_impot:tres_hauts_patrimoines : ajoute l\'un des tags fiscalite_hausse, redistribution');
    expect(v(spec(P493, ['institutions_democratie_directe'], { levers: [{ id: 'tva.taux_normal', delta: 1 }] })))
      .toContain('une révision constitutionnelle ne contient ni levier, ni effet qualitatif, ni loi de finances');
    expect(v(spec({ modele: 'supprimer_impot', impot: 'ir' }, ['fiscalite_baisse'], { levers: [{ id: 'ir.bareme', delta: -5 }] })))
      .toContain('levier ir.bareme incompatible avec la suppression de ir');
    const enVigueur = adoptee(s, spec(THP, ['fiscalite_hausse']));
    expect(v(spec(THP, ['fiscalite_hausse']), enVigueur)[0]).toMatch(/^réforme déjà en vigueur : .*\(loi-1\)$/);
    const depose = pass(s, spec(THP, ['fiscalite_hausse'], { prepMonths: 3 }));
    expect(v(spec(THP, ['fiscalite_hausse']), depose)[0]).toMatch(/^réforme déjà déposée : .*\(loi-1\)$/);
    expect(engine.validateBill(depose, spec(THP, ['fiscalite_hausse'], { title: 'Amendé' }), 'loi-1')).toEqual([]); // projet amendé : pas son propre doublon
    const sansIfi = adoptee(s, spec({ modele: 'supprimer_impot', impot: 'ifi' }, ['fiscalite_baisse']));
    expect(v(spec(undefined, ['fiscalite_hausse'], { levers: [{ id: 'patrimoine.ifi_bareme', delta: 10 }] }), sansIfi))
      .toContain('patrimoine.ifi_bareme : l\'impôt ifi a été supprimé par la loi');
  });
});

describe('sans réforme', () => {
  test('règles vides, lignes budgétaires inchangées, champ undefined neutre', () => {
    expect(regles(engine.newGame({ seed: 1, mode: 'democratie' }))).toEqual({ supprimes: [], crees: [] });
    const a = run(pass(start('democratie', 3), spec(undefined, ['redistribution'], { levers: [{ id: 'social.rsa_montant', delta: 30 }], reforme: undefined })), 24);
    const b = run(pass(start('democratie', 3), spec(undefined, ['redistribution'], { levers: [{ id: 'social.rsa_montant', delta: 30 }] })), 24);
    expect(Object.keys(a.budget.recettes)).toEqual(Object.keys(budget.recettes));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('une réforme en préparation ne change ni le scrutin ni le 49.3', () => {
    const s = start('democratie');
    const p = pass(s, spec(PROP, ['institutions_democratie_directe'], { prepMonths: 6 }));
    const q = pass(s, spec(P493, ['institutions_democratie_directe'], { prepMonths: 6 }));
    expect(scrutin(p, 123)).toEqual(scrutin(s, 123));
    const loi = ordinaire(['securite_justice']);
    expect(can493(q, loi)).toBe(can493(s, loi));
  });
});

describe('creer_impot', () => {
  test('ligne propre, montée en charge, Laffer, PO, prévisualisation', () => {
    const s0 = start();
    let s = pass(s0, spec(THP, ['fiscalite_hausse']));
    expect(s.budget.recettes.impot_tres_hauts_patrimoines).toBeUndefined();
    s = run(s, 11);
    const avant = s;
    s = run(s, 1);
    const a = ASSIETTE.get('tres_hauts_patrimoines')!;
    expect(s.budget.recettes.impot_tres_hauts_patrimoines).toBeCloseTo(rendement(a, 2) * centralFactor(avant), 9);
    expect(rendement(a, 4)).toBeLessThan(2 * rendement(a, 2));
    expect(rendement(a, 1 / a.erosion.value)).toBeGreaterThan(Math.max(rendement(a, 2.5), rendement(a, 3.5)));
    expect(s.national.prelevements_obligatoires).toBeGreaterThan(run(s0, 12).national.prelevements_obligatoires);
    const p = engine.previewBill(s0, spec(THP, ['fiscalite_hausse']), 6);
    expect(p.budget.some((l) => l.ligne === 'recettes.impot_tres_hauts_patrimoines' && l.ecart > 0)).toBe(true);
    expect(p.ecart.croissance_pib!).toBeLessThan(0);
  });
});

describe('supprimer_impot', () => {
  test('IFI : recette retirée, leviers remis à zéro, pas de second dépôt', () => {
    const base = run(start(), 14);
    let s = run(pass(start(), spec(undefined, ['fiscalite_hausse'], { levers: [{ id: 'patrimoine.ifi_bareme', delta: 20 }] })), 1);
    const sup = spec({ modele: 'supprimer_impot', impot: 'ifi' }, ['fiscalite_baisse'], { rampMonths: 0 });
    s = pass(s, sup);
    s = run(s, 1);
    expect(s.levers['patrimoine.ifi_bareme'].delta).toBe(0);
    expect(s.effects.some((e) => e.source.kind === 'lever' && e.source.id === 'patrimoine.ifi_bareme')).toBe(false);
    expect(engine.canDeposit(run(s, 1), sup)).toBe(false);
    const avant = run(s, 11);
    s = run(avant, 1);
    expect(s.budget.recettes.impots_patrimoine - base.budget.recettes.impots_patrimoine).toBeCloseTo(-2.8 * centralFactor(avant), 1);
  });

  test('levier d\'un texte déposé avant la suppression : ignoré à la promulgation', () => {
    let s = pass(start(), spec(undefined, ['fiscalite_hausse'], { prepMonths: 3, levers: [{ id: 'patrimoine.ifi_bareme', delta: 20 }] }));
    s = pass(run(s, 1), spec({ modele: 'supprimer_impot', impot: 'ifi' }, ['fiscalite_baisse'], { rampMonths: 0 }));
    s = run(s, 4);
    expect(s.bills.every((b) => b.status === 'adoptee')).toBe(true);
    expect(s.levers['patrimoine.ifi_bareme'].delta).toBe(0);
    expect(s.effects.some((e) => e.source.kind === 'lever' && e.source.id === 'patrimoine.ifi_bareme')).toBe(false);
  });

  test('IR : effet sur les cadres plafonné', () => {
    const b: Bill = { id: 'loi-1', spec: spec({ modele: 'supprimer_impot', impot: 'ir' }, ['fiscalite_baisse']), status: 'adoptee', votes: [] };
    const cadres = effetsReforme(b, 0).find((e) => e.cible.kind === 'group' && e.cible.id === 'cadres')!;
    expect(cadres.amplitude).toBe(C.reforme_satisfaction_max);
  });
});

describe('capitalisation', () => {
  const CAP = spec({ modele: 'capitalisation', part: 10 }, ['retraites_durcissement'], { rampMonths: 0 });
  test('cotisations en moins, pensions dues, déficit, satisfaction, groupes', () => {
    const base = start(), s = pass(base, CAP);
    const s12 = run(s, 12), b12 = run(base, 12);
    expect(montantsReformes(s12, 12, 1)).toEqual({ 'recettes.cotisations_sociales': -0.1 * 250 });
    // Aucun écart discrétionnaire : seul le niveau des prix (compte central nominal) bouge, de l'ordre de 1e-5 en relatif.
    expect(s12.budget.depenses.retraites).toBeCloseTo(b12.budget.depenses.retraites, 1);
    const d = run(s12, 12).national.deficit_public - run(b12, 12).national.deficit_public;
    expect(d).toBeGreaterThan(0.5);
    expect(d).toBeLessThan(1);
    expect(s12.groups.retraites.satisfaction).toBeLessThan(b12.groups.retraites.satisfaction);
    expect(billGroups(s.bills[0])).toContainEqual(expect.objectContaining({ group: 'retraites', direction: -1 }));
  });
});

describe('proportionnelle', () => {
  test('mêmes tirages, sièges à la proportionnelle, seuil, prime, règles', () => {
    const s = start('democratie');
    const p = (seuil: number, prime: number) => adoptee(s, spec({ modele: 'proportionnelle', seuil, prime }, ['institutions_democratie_directe']));
    expect(scrutin(p(5, 0), 7).rng).toBe(scrutin(s, 7).rng);
    const N = 577 - 22 - 9; // LIOT et NI gardent leurs sièges
    const voix = (ids: string[], seuil: number) => ids.reduce((a, x) => a + ((s.intentions[x] ?? 0) >= seuil ? s.intentions[x] : 0), 0);
    const blocs = politics.institutions.blocs, tot = blocs.reduce((a, b) => a + voix(b.parties, 5), 0);
    const f = forecastLegislatives(p(5, 0));
    blocs.forEach((b, i) => expect(Math.abs(f.blocs[i].sieges - (N * voix(b.parties, 5)) / tot)).toBeLessThan(0.03 * N));
    expect(forecastLegislatives(p(10, 0)).blocs.find((b) => b.id === 'droite')!.sieges).toBe(0); // LR 7,75 % < 10 %
    const r = scrutin(p(5, 15), 11).assemblee, parBloc = blocs.map((b) => r.filter((g) => b.groupes.includes(g.groupId)).reduce((a, g) => a + g.sieges, 0));
    expect(Math.max(...parBloc)).toBeGreaterThanOrEqual(Math.round(0.15 * N));
    expect(engine.pouvoir(p(5, 15)).regles.proportionnelle).toEqual({ seuil: 5, prime: 15 });
  });
});

describe('49.3', () => {
  test('portée, révision constitutionnelle, isBudget', () => {
    const s = start('democratie');
    const totale = adoptee(s, spec(P493, ['institutions_democratie_directe']));
    const hors = adoptee(s, spec({ modele: 'suppression_493', portee: 'hors_budget' }, ['institutions_democratie_directe']));
    const budgetaire = ordinaire(['fiscalite_hausse'], { estimatedCost: 5 }), autre = ordinaire(['securite_justice']);
    expect(can493(totale, budgetaire)).toBe(false);
    expect(can493(hors, budgetaire)).toBe(true);
    expect(can493(hors, autre)).toBe(false);
    expect(can493(s, { ...autre, voie: 'congres' })).toBe(false);
    expect(isBudget(ordinaire(['fiscalite_hausse'], { reforme: THP }))).toBe(true);
    // Doublon déposé après le rejet du premier texte : plus de 49.3 sur celui-ci.
    const ifi: Reforme = { modele: 'supprimer_impot', impot: 'ifi' };
    const rejete: Bill = { ...ordinaire(['fiscalite_baisse'], { reforme: ifi }), id: 'loi-a', status: 'rejetee' };
    expect(can493({ ...s, bills: [rejete] }, rejete)).toBe(true);
    expect(can493({ ...s, bills: [rejete, { ...rejete, id: 'loi-b', status: 'preparation' }] }, rejete)).toBe(false);
  });
});

describe('circuit constitutionnel', () => {
  const texte = (an: number, se: number, extra: Partial<BillSpec> = {}) => spec(P493, ['institutions_democratie_directe'], { positions: positions(an, se), ...extra });

  test('Congrès : chambres, puis 3/5 le mois suivant, puis promulgation ; même graine, même issue', () => {
    const joue = () => {
      let s = pass(start('democratie'), texte(1, 1), 'congres');
      expect(s.bills[0].voie).toBe('congres');
      s = engine.endTurn(s).state;
      const b = s.bills[0];
      expect(b.votes.map((v) => v.chambre)).toEqual(['assemblee', 'senat']);
      expect(b).toMatchObject({ status: 'preparation', voteLe: { year: 2026, month: 2 } });
      expect(engine.amend(s, b.id, texte(1, 1, { title: 'autre' }))).toBe(s); // pas d'amendement après un vote
      const r = engine.endTurn(s);
      const c = r.state.bills[0].votes[2];
      expect(c.chambre).toBe('congres');
      expect(c.adopte).toBe(5 * c.pour >= 3 * (c.pour + c.contre));
      expect(r.state.bills[0].status).toBe(c.adopte ? 'adoptee' : 'rejetee');
      return r.state;
    };
    const a = joue();
    expect(a.bills[0].status).toBe('adoptee');
    expect(engine.pouvoir(a).regles.sans493).toBe('totale');
    expect(JSON.stringify(joue())).toBe(JSON.stringify(a));
  });

  test('règle des 3/5 sur des votes partagés', () => {
    for (let seed = 1; seed <= 20; seed++) {
      let s = pass(start('democratie', seed), texte(0.2, 0.2), 'congres');
      s.bills[0].votes = [
        { chambre: 'assemblee', date: s.date, pour: 300, contre: 200, abstention: 77, adopte: true, parGroupe: [] },
        { chambre: 'senat', date: s.date, pour: 200, contre: 100, abstention: 48, adopte: true, parGroupe: [] },
      ];
      s = engine.endTurn(s).state;
      const c = s.bills[0].votes[2];
      expect(c.adopte).toBe(5 * c.pour >= 3 * (c.pour + c.contre));
    }
  });

  test('veto du Sénat, référendum après campagne, décret sans vote', () => {
    const veto = engine.endTurn(pass(start('democratie'), texte(1, -1), 'congres')).state.bills[0];
    expect(veto.status).toBe('rejetee');
    expect(veto.votes).toHaveLength(2);
    const ref = engine.endTurn(pass(start('democratie'), texte(1, 1), 'referendum')).state.bills[0];
    expect(ref.voteLe).toEqual({ year: 2026, month: 1 + C.referendum_campagne_mois });
    const d = engine.endTurn(pass(start('decret'), texte(1, 1), 'congres')).state.bills[0];
    expect(d).toMatchObject({ status: 'adoptee', votes: [] });
    expect(d.voie).toBeUndefined();
  });

  test('dissolution à l\'étape finale : report, puis Congrès sans revote des chambres', () => {
    let s = engine.endTurn(pass(start('democratie'), texte(1, 1), 'congres')).state;
    s = engine.endTurn(engine.dissolve(s).state).state;
    expect(s.bills[0]).toMatchObject({ status: 'preparation', voteLe: { year: 2026, month: 3 } });
    if (s.institutions!.gouvernement.demissionnaire) s = engine.nominate(s, 'technicien').state;
    const r = engine.endTurn(s);
    expect(r.state.bills[0].votes.map((v) => v.chambre)).toEqual(['assemblee', 'senat', 'congres']);
  });
});

describe('référendum', () => {
  const pret = (mode: GameMode, popularite: number, pos: number) => {
    const s = pass(start(mode), spec(P493, ['institutions_democratie_directe'], { positions: positions(pos, pos) }), 'referendum');
    s.national.popularite = popularite;
    s.bills[0].votes = [
      { chambre: 'assemblee', date: s.date, pour: 300, contre: 200, abstention: 77, adopte: true, parGroupe: [] },
      { chambre: 'senat', date: s.date, pour: 200, contre: 100, abstention: 48, adopte: true, parGroupe: [] },
    ];
    return s;
  };

  test('oui croît avec la popularité ; sans aléa, déterministe et sans tirage', () => {
    const s = pret('democratie', 0.2, 0), b = s.bills[0];
    expect(referendumOui({ ...s, national: { ...s.national, popularite: 0.4 } }, b, 0)).toBeGreaterThan(referendumOui(s, b, 0));
    const x = structuredClone(s), y = structuredClone(s);
    expect(resoudreReferendum(x, x.bills[0], 0, false)).toEqual(resoudreReferendum(y, y.bills[0], 0, false));
    expect(x.rng).toBe(s.rng);
  });

  test('échec : événement, rejet, chocs, relations ; jamais une défaite en bac à sable', () => {
    for (const mode of ['democratie', 'bac_a_sable'] as const) {
      const s = pret(mode, 0.05, -1);
      const r = engine.endTurn(s);
      expect(r.report.events).toContainEqual(expect.objectContaining({ kind: 'referendum', billId: 'loi-1', adopte: false }));
      expect(r.state.bills[0].status).toBe('rejetee');
      expect(r.state.effects.some((e) => e.source.id === 'referendum:loi-1')).toBe(true);
      expect(r.state.defaite).toBeUndefined();
    }
    const s = pret('democratie', 0.05, -1), x = structuredClone(s);
    resoudreReferendum(x, x.bills[0], 0, false);
    const avant = engine.pouvoir(s).relations, apres = engine.pouvoir(x).relations;
    for (const k of Object.keys(avant)) expect(apres[k]).toBeCloseTo(Math.max(-1, avant[k] - C.referendum_echec_relation), 12);
  });
});

describe('previewBill', () => {
  test('circuit, législatives, texte ordinaire', () => {
    const s = start('democratie');
    const sp = spec(P493, ['institutions_democratie_directe']);
    const a = engine.previewBill(s, sp, 6), b = engine.previewBill(s, sp, 6);
    for (const k of ['congres', 'referendum'] as const) { expect(a.circuit![k]).toBeGreaterThanOrEqual(0); expect(a.circuit![k]).toBeLessThanOrEqual(1); }
    expect(a.circuit).toEqual(b.circuit);
    const p = engine.previewBill(s, spec(PROP, ['institutions_democratie_directe']), 6);
    expect(p.legislatives?.sans.blocs).toHaveLength(5);
    expect(p.legislatives?.avec.blocs.find((x) => x.id === 'rn')!.sieges).not.toBe(p.legislatives?.sans.blocs.find((x) => x.id === 'rn')!.sieges);
    expect(engine.previewBill(s, spec(undefined, ['redistribution'], { levers: [{ id: 'social.rsa_montant', delta: 30 }] }), 6).circuit).toBeUndefined();
  });
});

test('coefficients des réformes présents, requis, hypothèses', () => {
  const ids = ['reforme_satisfaction_max', 'referendum_poids_popularite', 'referendum_pivot', 'referendum_poids_consignes', 'referendum_incertitude',
    'referendum_campagne_mois', 'referendum_duree_choc_mois', 'referendum_echec_relation'];
  for (const id of ids) {
    expect(REQUIRED_COEFFICIENTS).toContain(id);
    expect(coefficients.find((c) => c.id === id)?.hypothese).toBe(true);
  }
});
