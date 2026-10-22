import { describe, expect, test } from 'vitest';
import { engine } from './index.ts';
import type { BillSpec, GameMode, GameState } from './types.ts';
import events from '../gamedata/events-2026.json';

const spec = (levers: BillSpec['levers'], extra: Partial<BillSpec> = {}): BillSpec => ({
  title: 'Loi test', summary: 'Résumé', articles: ['Article 1'], levers, qualitative: [], tags: ['redistribution'],
  prepMonths: 0, rampMonths: 0, estimatedCost: 0, ...extra,
});
const start = (mode: GameMode = 'decret', withEvents = false, seed = 1) => {
  const s = engine.newGame({ seed, mode });
  if (!withEvents) s.firedEvents = [...events.map((e) => e.id), ...[2027, 2028, 2029, 2030].map((y) => `loi_speciale_${y}`)];
  return s;
};
const run = (s: GameState, n: number) => {
  for (let i = 0; i < n; i++) s = engine.endTurn(s).state;
  return s;
};
const pass = (s: GameState, sp: BillSpec) => {
  s = engine.addDraft(s, sp);
  return engine.deposit(s, s.bills[s.bills.length - 1].id);
};

describe('moteur', () => {
  test('déterminisme : même seed ⇒ même état après 24 mois', () => {
    const play = () => {
      let s = start('democratie', true, 42);
      s = pass(s, spec([{ id: 'tva.taux_normal', delta: 1 }], { tags: ['fiscalite_hausse'], prepMonths: 2 }));
      s = run(s, 1); // un dépôt par mois
      s = pass(s, spec([{ id: 'social.rsa_montant', delta: 30 }], { prepMonths: 4 }));
      return run(s, 23);
    };
    const a = play(), b = play();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.bills.every((x) => x.votes.length > 0)).toBe(true);
  });

  test('12 mois sans action ni événement ≈ papersim', () => {
    const s = run(start(), 12);
    // papersim (node scripts/papersim.cjs . 12) : dette 3 611,5 Md€ / 117,86 %, chômage 7,977 %, inflation 1,26 %
    // écart attendu de quelques Md€ : compte central indexé et élasticités conjoncturelles (absents de papersim)
    expect(Math.abs(s.national.dette_publique_md / 3611.5 - 1)).toBeLessThan(0.005);
    expect(Math.abs(s.national.dette_publique - 117.86)).toBeLessThan(0.5);
    expect(Math.abs(s.national.chomage_bit - 7.977)).toBeLessThan(0.05);
    expect(Math.abs(s.national.inflation - 1.26)).toBeLessThan(0.15);
    // point fixe de l'opinion
    expect(s.national.popularite).toBeCloseTo(0.18, 6);
    expect(s.groups.retraites.satisfaction).toBeCloseTo(0.204, 6);
  });

  test('invariant budgétaire : variation de dette = -solde', () => {
    let s = pass(start('decret', true), spec([{ id: 'depenses.defense', delta: 10 }]));
    for (let i = 0; i < 24; i++) {
      const d0 = s.national.dette_publique_md;
      s = engine.endTurn(s).state;
      const rec = Object.values(s.budget.recettes).reduce((a, b) => a + b, 0);
      const dep = Object.values(s.budget.depenses).reduce((a, b) => a + b, 0);
      expect(s.national.dette_publique_md - d0).toBeCloseTo(-(rec - dep) / 12, 9);
    }
  });

  test('RSA +50 € vs +100 € : gain de satisfaction proportionnel, sans double compte', () => {
    const base = run(start(), 36).groups.chomeurs_inactifs.satisfaction;
    const gain = (d: number) => run(pass(start(), spec([{ id: 'social.rsa_montant', delta: d }])), 36).groups.chomeurs_inactifs.satisfaction - base;
    const g50 = gain(50), g100 = gain(100);
    expect(g100 / g50).toBeGreaterThan(1.9);
    expect(g100 / g50).toBeLessThan(2.1);
    // une seule voie : 0,0006/€ × 50 € = 0,03 de cible, atteinte à ~97 % en 36 mois (pas d'effet Prest en plus)
    expect(g50).toBeGreaterThan(0.025);
    expect(g50).toBeLessThan(0.033);
  });

  test("SMIC fixé en juillet 2026 : l'écart se mesure par rapport à la référence indexée", () => {
    let s = run(start('decret', true), 6); // → juillet 2026
    expect(s.date).toEqual({ year: 2026, month: 7 });
    // revalorisation automatique de juin 2026 (12,02 → 12,31 €/h), comme le ferait l'indexation : seule reference bouge
    s.levers['travail.smic'].reference *= 12.31 / 12.02;
    expect(s.effects.some((e) => e.source.id === 'travail.smic')).toBe(false);
    const ref = s.levers['travail.smic'].reference;
    s = pass(s, spec([{ id: 'travail.smic', delta: 1950 - ref }]));
    s = engine.endTurn(s).state;
    const lv = s.levers['travail.smic'];
    expect(lv.reference + lv.delta).toBeCloseTo(1950, 6);
    expect(lv.delta).toBeCloseTo(1950 - ref, 6);
    const chomage = s.effects.find((e) => e.source.id === 'travail.smic' && e.cible.kind === 'indicator' && e.cible.id === 'chomage_bit')!;
    expect(chomage.amplitude).toBeCloseTo(0.0031 * (1950 - ref), 9); // et non 0,0031 × (1950 − 1823,03)
  });

  test('TVA +2 points : recettes ≈ +2 × 7,5 Md€, inflation en hausse', () => {
    const a = run(pass(start(), spec([{ id: 'tva.taux_normal', delta: 2 }], { tags: ['fiscalite_hausse'] })), 3);
    const b = run(start(), 3);
    const dTva = a.budget.recettes.tva - b.budget.recettes.tva;
    expect(dTva).toBeGreaterThan(14);
    expect(dTva).toBeLessThan(16);
    expect(a.national.inflation - b.national.inflation).toBeGreaterThan(0.6); // 2 × 0,37 % sur le niveau des prix
    expect(a.national.dette_publique_md).toBeLessThan(b.national.dette_publique_md);
  });

  test("un événement echeance n'a pas d'effet", () => {
    const { state, report } = engine.endTurn(start('decret', true));
    const ech = report.events.find((e) => e.kind === 'event' && e.id === 'loi_speciale_lfss_2026');
    expect(ech).toMatchObject({ type: 'echeance' });
    expect(state.effects.some((e) => e.source.id === 'loi_speciale_lfss_2026')).toBe(false);
    expect(state.effects.some((e) => e.source.id === 'colere_agricole_janvier')).toBe(true); // exogène du même mois
  });

  test('validateBill refuse leviers inconnus, bornes et cibles dérivées', () => {
    const s = start();
    expect(engine.validateBill(s, spec([{ id: 'tva.taux_normal', delta: 1 }]))).toEqual([]);
    expect(engine.validateBill(s, spec([{ id: 'inconnu', delta: 1 }])).length).toBe(1);
    expect(engine.validateBill(s, spec([{ id: 'tva.taux_normal', delta: 50 }])).length).toBe(1);
    const derive = spec([], { qualitative: [{ cible: { kind: 'indicator', id: 'dette_publique' }, direction: -1, intensite: 'forte', justification: 'x' }] });
    expect(engine.validateBill(s, derive).length).toBe(1);
  });

  test('pensions −1 point : économie au 1er janvier suivant, cumulée chaque année comme l\'indice Pen', () => {
    const base = start(), loi = pass(start(), spec([{ id: 'retraite.indexation_pensions', delta: -1 }], { tags: ['austerite_depenses'] }));
    const eco = (n: number) => run(loi, n).budget.depenses.retraites - run(base, n).budget.depenses.retraites;
    expect(Math.abs(eco(11))).toBeLessThan(0.01); // rien avant janvier 2027
    expect(eco(13)).toBeGreaterThan(-3.2);
    expect(eco(13)).toBeLessThan(-2.7); // ≈ 2,9 Md€ la 1re année
    expect(eco(49)).toBeLessThan(-10); // ≈ 4 × 2,9 Md€ en 2030
  });

  test('pensions −1 point : l\'économie se cumule à chaque revalorisation (3 ans)', () => {
    const base = start(), loi = pass(start(), spec([{ id: 'retraite.indexation_pensions', delta: -1 }], { tags: ['austerite_depenses'] }));
    const eco = (n: number) => run(loi, n).budget.depenses.retraites - run(base, n).budget.depenses.retraites;
    const [e1, e2, e3] = [13, 25, 37].map(eco); // février 2027, 2028, 2029
    // 1, 2 puis 3 points d'écart cumulé, en euros courants (PIB nominal potentiel ≈ +2,8 %/an) : ≈ 2 × 1,028 et 3 × 1,028²
    expect(e1).toBeLessThan(-2.7);
    expect(e2 / e1).toBeGreaterThan(2);
    expect(e2 / e1).toBeLessThan(2.12);
    expect(e3 / e1).toBeGreaterThan(3.05);
    expect(e3 / e1).toBeLessThan(3.25);
  });

  test("Okun : un choc de croissance d'événement fait bouger le chômage, un effet d'offre de levier non", () => {
    const choc = (kind: 'event' | 'lever') => {
      const s = start();
      s.effects.push({ source: { kind, id: 'x' }, cible: { kind: 'indicator', id: 'croissance_pib' }, amplitude: -1, forme: 'niveau', debut: 0, rampe: 0, duree: 24 });
      return run(s, 9).national.chomage_bit - run(start(), 9).national.chomage_bit;
    };
    expect(choc('event')).toBeGreaterThan(0.1);
    expect(Math.abs(choc('lever'))).toBeLessThan(1e-9);
  });

  test('croissance potentielle : transition progressive de 1,2 % à 1,0 % (mi-2028 → mi-2029)', () => {
    let s = start();
    const g: number[] = [];
    for (let t = 0; t < 60; t++) {
      const y0 = s.internals['x.lnYt'];
      s = engine.endTurn(s).state;
      g.push(1200 * (s.internals['x.lnYt'] - y0));
    }
    expect(g[29]).toBeCloseTo(1.2, 9);
    expect(g[36]).toBeCloseTo(1.1, 9);
    expect(g[42]).toBeCloseTo(1.0, 9);
    for (let t = 1; t < 60; t++) {
      expect(g[t]).toBeLessThanOrEqual(g[t - 1] + 1e-12);
      expect(g[t - 1] - g[t]).toBeLessThan(0.02); // pas de marche
    }
  });

  test('validateBill : effets qualitatifs limités, sans doublon, ni notation, prime de risque ou intérêts', () => {
    const s = start();
    const q = (kind: string, id?: string) => ({ cible: { kind, id } as BillSpec['qualitative'][0]['cible'], direction: 1 as const, intensite: 'forte' as const, justification: 'x' });
    const v = (...qs: ReturnType<typeof q>[]) => engine.validateBill(s, spec([], { qualitative: qs }));
    expect(v(q('popularite'), q('budget', 'recettes.tva'), q('region', '53'))).toEqual([]);
    expect(v(q('popularite'), q('tension'), q('stabilite'), q('budget', 'recettes.tva')).length).toBe(1);
    expect(v(q('budget', 'recettes.tva'), q('budget', 'recettes.tva')).length).toBe(1);
    expect(v(q('popularite'), q('popularite', 'national')).length).toBe(1);
    for (const bad of [q('notation', 'S&P'), q('prime_risque'), q('budget', 'depenses.interets_dette'), q('region', 'bretagne')]) expect(v(bad).length).toBe(1);
  });

  test('effets qualitatifs de lois successives : cumul plafonné au barème « forte »', () => {
    let s = start();
    for (let i = 0; i < 5; i++) s = pass(s, spec([], { qualitative: [{ cible: { kind: 'indicator', id: 'chomage_bit' }, direction: -1, intensite: 'forte', justification: 'x' }] }));
    const d = run(s, 2).national.chomage_bit - run(start(), 2).national.chomage_bit;
    expect(d).toBeGreaterThan(-0.31); // une seule fois 0,3 point, pas 5 × 0,3
    expect(d).toBeLessThan(-0.25);
  });

  test('partie complète jusqu’à décembre 2030 sans NaN ni score hors bornes', () => {
    let s = start('democratie', true, 7);
    s = pass(s, spec([{ id: 'retraite.age_legal', delta: 1 }], { tags: ['retraites_durcissement'], prepMonths: 3 }));
    s = engine.endTurn(s).state; // un dépôt par mois
    s = pass(s, spec([{ id: 'depenses.education', delta: 8 }], { tags: ['services_publics', 'relance_depenses'], prepMonths: 5,
      qualitative: [{ cible: { kind: 'group', id: 'etudiants_jeunes' }, direction: 1, intensite: 'moyenne', justification: 'x' }] }));
    const scores = (x: GameState) => [x.national.popularite, x.national.tension, x.national.stabilite,
      ...Object.values(x.groups).map((g) => g.satisfaction), ...Object.values(x.regions).map((r) => r.tension)];
    for (let i = 0; i < 59; i++) {
      expect(engine.isOver(s)).toBe(false);
      s = engine.endTurn(s).state;
      const rejet = s.bills.find((b) => b.status === 'rejetee' && !b.usage493);
      if (rejet) s = engine.use493(s, rejet.id).state;
      for (const v of Object.values(s.national)) expect(Number.isFinite(v)).toBe(true);
      for (const v of scores(s)) expect(v >= 0 && v <= 1).toBe(true);
      expect(Object.values(s.intentions).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
    }
    expect(s.date).toEqual({ year: 2031, month: 1 });
    expect(s.history.at(-1)!.date).toEqual({ year: 2030, month: 12 });
    expect(engine.isOver(s)).toBe(true);
  });

  test("sauvegarde antérieure à x.Ol : pas de saut de chômage au chargement", () => {
    let s = pass(start(), spec([{ id: 'retraite.age_legal', delta: 2 }], { tags: ['retraites_durcissement'] }));
    s = run(s, 24);
    expect(s.internals['x.Ol']).toBeGreaterThan(0);
    const ancienne = structuredClone(s);
    delete ancienne.internals['x.Ol'];
    const a = run(s, 6), b = run(ancienne, 6);
    // seul le mois de chargement perd la correction du mois (petite) ; avant : +0,15 pt
    expect(Math.abs(b.national.chomage_bit - a.national.chomage_bit)).toBeLessThan(0.02);
  });
});

describe('un dépôt par mois', () => {
  const spec = (loiDeFinances?: number): BillSpec => ({
    title: 't', summary: 's', articles: [], levers: [], qualitative: [], tags: ['fiscalite_hausse'],
    prepMonths: 1, rampMonths: 0, estimatedCost: 1, ...(loiDeFinances && { loiDeFinances }),
  });
  test('second dépôt refusé le même mois, accepté le mois suivant ; lois de finances hors compte', () => {
    let s = engine.newGame({ seed: 1, mode: 'democratie' });
    for (const sp of [spec(), spec(), spec(2027)]) s = engine.addDraft(s, sp);
    const [a, b, plf] = s.bills.map((x) => x.id);
    s = engine.deposit(s, a);
    expect(engine.deposit(s, b)).toBe(s);
    s = engine.deposit(s, plf);
    expect(s.bills.find((x) => x.id === plf)!.status).toBe('preparation');
    s = engine.endTurn(s).state;
    expect(engine.deposit(s, b).bills.find((x) => x.id === b)!.status).toBe('preparation');
  });
});

describe('amendement et retrait', () => {
  const spec = (title: string): BillSpec => ({
    title, summary: 's', articles: [], levers: [], qualitative: [], tags: ['fiscalite_hausse'], prepMonths: 3, rampMonths: 0, estimatedCost: 1,
  });
  test('amend remplace le texte (brouillon, préparation avec la même date de vote), pas après le vote', () => {
    let s = engine.addDraft(engine.newGame({ seed: 1, mode: 'democratie' }), spec('v1'));
    const id = s.bills[0].id;
    s = engine.amend(s, id, spec('v2'));
    expect(s.bills).toHaveLength(1);
    expect(s.bills[0].spec.title).toBe('v2');
    s = engine.deposit(s, id);
    const voteLe = s.bills[0].voteLe;
    s = engine.amend(s, id, { ...spec('v3'), prepMonths: 1 });
    expect(s.bills[0]).toMatchObject({ status: 'preparation', voteLe, spec: { title: 'v3' } });
    const retiree = engine.withdraw(s, id);
    expect(engine.amend(retiree, id, spec('v4'))).toBe(retiree);
  });
  test('un projet retiré disparaît à la fin du mois', () => {
    let s = engine.addDraft(engine.newGame({ seed: 1, mode: 'democratie' }), spec('a'));
    s = engine.addDraft(s, spec('b'));
    s = engine.withdraw(s, s.bills[0].id);
    expect(s.bills).toHaveLength(2);
    s = engine.endTurn(s).state;
    expect(s.bills.map((b) => b.spec.title)).toEqual(['b']);
    s = engine.withdraw(s, s.bills[0].id);
    s = engine.addDraft(engine.endTurn(s).state, spec('c'));
    expect(s.bills[0].id).toBe('loi-3'); // jamais réutilisé
  });
});
