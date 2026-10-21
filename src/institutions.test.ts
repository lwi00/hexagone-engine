import { describe, expect, test } from 'vitest';
import { engine } from './index.ts';
import { INSTITUTIONS0 } from './init.ts';
import { issue, parBloc, scrutin } from './institutions.ts';
import { can493, forecastVote } from './parliament.ts';
import type { Bill, BillSpec, GameState, Sieges } from './types.ts';
import { C } from './init.ts';
import { REQUIRED_COEFFICIENTS } from './schemas.ts';
import coefficients from '../gamedata/coefficients.json';

const spec = (tags: string[], extra: Partial<BillSpec> = {}): BillSpec => ({
  title: 'Loi test', summary: 'Résumé', articles: ['Article 1'], levers: [], qualitative: [], tags, prepMonths: 0, rampMonths: 0, estimatedCost: 0, ...extra,
});
const bill = (tags: string[]): Bill => ({ id: 'b', spec: spec(tags), status: 'preparation', votes: [] });
const start = (mode: 'democratie' | 'decret' = 'democratie') => engine.newGame({ seed: 3, mode });
const rapports = (s: GameState) => Object.fromEntries(s.parliament.assemblee.map((g) => [g.groupId, g.rapport]));
const demission = (s: GameState): GameState => ({ ...s, institutions: { ...s.institutions!, gouvernement: { ...s.institutions!.gouvernement, demissionnaire: true } } });
// Intentions forcées pour un parti, les autres réduits à proportion.
const intentions = (s: GameState, party: string, pct: number): GameState => {
  const k = (100 - pct) / (100 - s.intentions[party]);
  return { ...s, intentions: Object.fromEntries(Object.entries(s.intentions).map(([p, v]) => [p, p === party ? pct : v * k])) };
};

// Censure adoptée : toute l'Assemblée en opposition, popularité au plancher, texte d'austérité rejeté puis passé au 49.3.
function censure(): GameState {
  let s = engine.addDraft(start(), spec(['austerite_depenses', 'fiscalite_hausse', 'retraites_durcissement'], { estimatedCost: -20 }));
  s.bills[0].status = 'rejetee';
  s.parliament.assemblee.forEach((g) => (g.rapport = 'opposition'));
  s.national.popularite = 0.05;
  const r = engine.use493(s, s.bills[0].id);
  expect(r.events).toContainEqual({ kind: 'censure', billId: s.bills[0].id, adoptee: true });
  return r.state;
}

describe('institutions (ENGINE.md §11)', () => {
  test('nouvelle partie : gouvernement Lecornu, législatives de juillet 2024', () => {
    const s = start();
    expect(s.institutions!.gouvernement.premierMinistre).toContain('Lecornu');
    expect(s.institutions!.gouvernement.demissionnaire).toBe(false);
    expect(s.institutions!.legislatives).toEqual({ year: 2024, month: 7 });
    expect(engine.pouvoir(s).peutDissoudre).toBe(true);
    expect(engine.pouvoir(start('decret')).peutDissoudre).toBe(false);
  });

  test('sauvegarde antérieure (sans institutions) : valeurs de INSTITUTIONS0', () => {
    const s = start();
    delete s.institutions;
    const p = engine.pouvoir(s);
    expect(p.gouvernement).toEqual(INSTITUTIONS0.gouvernement);
    expect(p.legislatives).toEqual(INSTITUTIONS0.legislatives);
    expect(engine.endTurn(s).state.date).toEqual({ year: 2026, month: 2 });
    expect(engine.dissolve(s).state.institutions?.dissolution).toEqual(s.date);
    const d = engine.addDraft(s, spec(['redistribution']));
    expect(engine.deposit(d, d.bills[0].id).bills[0].status).toBe('preparation');
    expect(INSTITUTIONS0.gouvernement.demissionnaire).toBe(false); // constante intacte
  });

  test('scrutin : 577 sièges, hors blocs inchangés, déterministe, fait avancer le rng', () => {
    const s = start();
    const a = scrutin(s, 42), b = scrutin(s, 42), c = scrutin(s, 43);
    expect(a.assemblee.reduce((x, g) => x + g.sieges, 0)).toBe(577);
    for (const id of ['liot', 'ni']) expect(a.assemblee.find((g) => g.groupId === id)!.sieges).toBe(s.parliament.assemblee.find((g) => g.groupId === id)!.sieges);
    expect(a.assemblee.every((g) => g.sieges >= 0)).toBe(true);
    expect(a).toEqual(b);
    expect(c.assemblee).not.toEqual(a.assemblee);
    expect(a.rng).not.toBe(42);
  });

  test('monotonie : plus d\'intentions pour le camp présidentiel, plus de sièges', () => {
    const centre = (s: GameState) => engine.forecastLegislatives(s).blocs.find((b) => b.id === 'centre')!.sieges;
    const s = start();
    expect(centre(intentions(s, 'horizons', 25))).toBeGreaterThan(centre(s));
  });

  test('prévision : déterministe, pure, issues de somme 1, 546 sièges en jeu', () => {
    const s = start();
    const avant = JSON.stringify(s);
    const f = engine.forecastLegislatives(s);
    expect(engine.forecastLegislatives(s)).toEqual(f);
    expect(JSON.stringify(s)).toBe(avant);
    expect(Object.values(f.issues).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(f.blocs.reduce((a, b) => a + b.sieges, 0)).toBeCloseTo(546, 6); // 577 − LIOT et NI
    for (const b of f.blocs) expect(b.bas).toBeLessThanOrEqual(b.haut);
  });

  test('dissolution : législatives à la fin du mois, puis pas de nouvelle dissolution pendant un an', () => {
    const s = start();
    const d = engine.dissolve(s);
    expect(d.events).toEqual([{ kind: 'dissolution' }]);
    expect(d.state.institutions!.dissolution).toEqual(s.date);
    expect(d.state.effects.some((e) => e.source.id === 'dissolution' && e.cible.kind === 'stabilite')).toBe(true);
    expect(engine.dissolve(d.state)).toEqual({ state: d.state, events: [] });
    const r = engine.endTurn(d.state);
    let x = r.state;
    expect(x.parliament.assemblee.map((g) => g.sieges)).not.toEqual(s.parliament.assemblee.map((g) => g.sieges));
    expect(x.institutions!.legislatives).toEqual(s.date);
    expect(x.institutions!.dissolution).toBeUndefined();
    const leg = r.report.events.find((e) => e.kind === 'legislatives');
    expect(leg).toBeDefined();
    expect(x.effects.some((e) => e.source.id === 'legislatives' && e.cible.kind === 'popularite')).toBe(true);
    for (let i = 0; i < 11; i++) {
      expect(engine.pouvoir(x).peutDissoudre).toBe(false);
      x = engine.endTurn(x).state;
    }
    expect(x.date).toEqual({ year: 2027, month: 1 });
    expect(engine.pouvoir(x).peutDissoudre).toBe(true);
  });

  test('Assemblée dissoute : les votes du mois sont reportés d\'un mois', () => {
    let s = engine.addDraft(start(), spec(['agriculture_soutien']));
    s = engine.deposit(s, s.bills[0].id);
    s = engine.dissolve(s).state;
    const b = engine.endTurn(s).state.bills[0];
    expect(b.status).toBe('preparation');
    expect(b.voteLe).toEqual({ year: 2026, month: 2 });
    expect(b.votes).toEqual([]);
  });

  test('Assemblée dissoute : le vote de l\'ancienne Assemblée ne vaut pas dernier mot', () => {
    let s = engine.addDraft(start(), spec(['redistribution']));
    s = engine.deposit(s, s.bills[0].id);
    // Fin janvier : adopté par l'Assemblée sortante, rejeté par le Sénat, dernier mot prévu en février.
    s.bills[0].votes = [
      { chambre: 'assemblee', date: s.date, pour: 300, contre: 200, abstention: 77, adopte: true, parGroupe: [] },
      { chambre: 'senat', date: s.date, pour: 100, contre: 200, abstention: 48, adopte: false, parGroupe: [] },
    ];
    s.bills[0].voteLe = { year: 2026, month: 2 };
    s = engine.endTurn(s).state;
    s = engine.endTurn(engine.dissolve(s).state).state; // février : dissolution, examen reporté en mars
    expect(s.bills[0]).toMatchObject({ status: 'preparation', voteLe: { year: 2026, month: 3 } });
    if (s.institutions!.gouvernement.demissionnaire) s = engine.nominate(s, 'technicien').state;
    const r = engine.endTurn(s);
    expect(r.report.events.filter((e) => e.kind === 'vote')).toHaveLength(2); // la nouvelle Assemblée revote
    expect(r.state.bills[0].votes).toHaveLength(4);
  });

  test('censure : gouvernement démissionnaire jusqu\'à la nomination', () => {
    let s = censure();
    expect(s.institutions!.gouvernement.demissionnaire).toBe(true);
    const d = engine.addDraft(s, spec(['redistribution']));
    expect(engine.deposit(d, d.bills.at(-1)!.id)).toBe(d);
    expect(can493(s, bill(['austerite_depenses']))).toBe(false);
    expect(engine.nominate(s, 'cohabitation' as never)).toEqual({ state: s, events: [] });
    const n = engine.nominate(s, 'technicien');
    expect(n.events).toEqual([{ kind: 'nomination', profil: 'technicien' }]);
    s = n.state;
    expect(s.institutions!.gouvernement).toMatchObject({ profil: 'technicien', demissionnaire: false });
    expect(s.institutions!.gouvernement.premierMinistre).toBeUndefined();
    expect(s.parliament.assemblee.some((g) => g.rapport === 'majorite')).toBe(false);
    expect(engine.nominate(s, 'camp_presidentiel')).toEqual({ state: s, events: [] }); // pas de remaniement volontaire
  });

  test('profils : ouverture à gauche ou à droite', () => {
    const s = demission(start());
    const g = engine.nominate(s, 'ouverture_gauche').state, d = engine.nominate(s, 'ouverture_droite').state;
    expect(rapports(g)).toMatchObject({ soc: 'majorite', dr: 'opposition', epr: 'majorite' });
    expect(rapports(d)).toMatchObject({ dr: 'majorite', rn: 'soutien_conditionnel', soc: 'opposition' });
    const p = (x: GameState) => forecastVote(x, bill(['redistribution']), 'assemblee').probabiliteAdoption;
    expect(p(g)).toBeGreaterThan(p(d));
  });

  test('issue du scrutin : majorité présidentielle d\'abord, puis coalitions dans l\'ordre', () => {
    const a = (x: Record<string, number>): Sieges => Object.entries(x).map(([groupId, sieges]) => ({ groupId, sieges }));
    expect(issue(a({ epr: 200, dr: 100, rn: 200 }))).toEqual({ issue: 'majorite' });
    expect(issue(a({ epr: 250, dr: 50, rn: 240 }))).toEqual({ issue: 'majorite' }); // union des droites aussi ≥ 289
    expect(issue(a({ rn: 250, dr: 50, epr: 200 }))).toEqual({ issue: 'cohabitation', coalition: 'union_droites' });
    expect(issue(a({ soc: 150, lfi_nfp: 150, rn: 200 }))).toEqual({ issue: 'cohabitation', coalition: 'union_gauche' });
    expect(issue(a({ rn: 200, epr: 200, soc: 150 }))).toEqual({ issue: 'sans_majorite' });
    expect(parBloc(a({ liot: 20, ni: 5, rn: 3 })).at(-1)).toMatchObject({ id: 'autres', sieges: 25 });
  });

  test('cohabitation de bout en bout : RN dominant, dissolution, gouvernement de l\'union des droites', () => {
    const s0 = intentions(start(), 'rn', 70);
    const r = engine.endTurn(engine.dissolve(s0).state);
    const s = r.state;
    expect(s.institutions!.gouvernement).toMatchObject({ profil: 'cohabitation', coalition: 'union_droites', demissionnaire: false });
    expect(r.report.events).toContainEqual({ kind: 'nomination', profil: 'cohabitation', coalition: 'union_droites' });
    expect(rapports(s)).toMatchObject({ rn: 'majorite', udr: 'majorite', dr: 'majorite', epr: 'soutien_conditionnel', dem: 'soutien_conditionnel', hor: 'soutien_conditionnel', soc: 'opposition' });
    expect(engine.pouvoir(s).cohabitation).toBe(true);
    expect(can493(s, bill(['austerite_depenses']))).toBe(false);
    // Mêmes rapports sans cohabitation : la majorité vote davantage pour (malus parlement_malus_cohabitation).
    const sans: GameState = { ...s, institutions: { ...s.institutions!, gouvernement: { profil: 'technicien', depuis: s.date, demissionnaire: false } } };
    const pour = (x: GameState) => forecastVote(x, bill(['securite_justice']), 'assemblee').pour;
    expect(pour(s)).toBeLessThan(pour(sans));
  });

  test('fin de cohabitation sans nouvelle coalition : gouvernement démissionnaire, plus de cohabitation', () => {
    let s = engine.endTurn(engine.dissolve(intentions(start(), 'rn', 70)).state).state;
    expect(engine.pouvoir(s).cohabitation).toBe(true);
    for (let i = 0; i < 11; i++) s = engine.endTurn(s).state;
    s = intentions(s, 'horizons', 60); // majorité présidentielle
    const r = engine.endTurn(engine.dissolve(s).state);
    expect(r.report.events).toContainEqual(expect.objectContaining({ kind: 'legislatives', issue: 'majorite' }));
    const p = engine.pouvoir(r.state);
    expect(p.gouvernement).toMatchObject({ profil: 'technicien', demissionnaire: true });
    expect(p.cohabitation).toBe(false);
    expect(p.assise.majorite).toBe(0); // la coalition battue n'est plus comptée en majorité
  });

  test('prévisualisation pendant une dissolution : pas de prévision de vote', () => {
    const s = engine.dissolve(start()).state;
    expect(engine.previewBill(s, spec(['redistribution'], { prepMonths: 1 }), 6).vote).toEqual([]);
    expect(engine.previewBill(start(), spec(['redistribution'], { prepMonths: 1 }), 6).vote).toHaveLength(2);
  });

  test('popularité : prime du camp présidentiel aux législatives', () => {
    const s = start();
    const centre = (pop: number) => engine.forecastLegislatives({ ...s, national: { ...s.national, popularite: pop } }).blocs.find((b) => b.id === 'centre')!.sieges;
    expect(centre(0.3)).toBeGreaterThan(centre(s.national.popularite) + 30);
    expect(centre(0.1)).toBeLessThan(centre(s.national.popularite));
  });

  test('stabilité : écart de cohésion borné (stabilite_cohesion_perte_max, stabilite_cohesion_gain_max)', () => {
    const s = start();
    const stab = (r: GameState['parliament']['assemblee'][number]['rapport'] | null) => {
      const x = structuredClone(s);
      if (r) x.parliament.assemblee.forEach((g) => (g.rapport = r));
      return engine.endTurn(x).state.national.stabilite;
    };
    const base = stab(null), k = (1 - C.stabilite_inertie) * C.stabilite_poids_cohesion_majorite;
    expect(base - stab('opposition')).toBeCloseTo(k * C.stabilite_cohesion_perte_max, 9);
    expect(stab('majorite') - base).toBeCloseTo(k * C.stabilite_cohesion_gain_max, 9);
  });

  test('coefficients des institutions présents et requis', () => {
    const ids = ['legislatives_exposant', 'legislatives_barrage', 'legislatives_ancrage_local', 'legislatives_incertitude', 'legislatives_effet_popularite', 'legislatives_prime_popularite',
      'dissolution_choc_stabilite', 'dissolution_duree_choc_mois', 'dissolution_delai_mois', 'parlement_malus_cohabitation'];
    for (const id of ids) {
      expect(REQUIRED_COEFFICIENTS).toContain(id);
      expect(coefficients.find((c) => c.id === id)?.hypothese).toBe(id !== 'dissolution_delai_mois');
    }
  });
});
