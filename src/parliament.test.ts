import { describe, expect, it } from 'vitest';
import { can493, forecastVote, PARLIAMENT_COEFFICIENTS, voteBill, voteCensure } from './parliament.ts';
import type { Bill, GameState } from './types.ts';
import { Coefficients } from './schemas.ts';
import politics from '../gamedata/politics.json';

// État minimal : seuls les champs lus par le Parlement.
const state = (over: Partial<GameState> = {}): GameState => ({
  rng: 42,
  date: { year: 2026, month: 3 },
  national: { popularite: 0.18 },
  parliament: {
    assemblee: politics.assemblee.groupes.map((g) => ({ groupId: g.id, sieges: g.sieges, rapport: g.rapport_gouvernement as 'majorite' })),
    usages493: [],
  },
  ...over,
} as GameState);

const bill = (tags: string[], extra: { estimatedCost?: number; levers?: { id: string; delta: number }[] } = {}): Bill => ({
  id: 'b1', status: 'preparation', votes: [],
  spec: { title: 't', summary: 's', articles: ['a'], levers: extra.levers ?? [], qualitative: [], tags, prepMonths: 0, rampMonths: 0, estimatedCost: extra.estimatedCost ?? 0 },
});

const camp = (r: ReturnType<typeof voteBill>['result'], ids: string[]) =>
  r.parGroupe.filter((g) => ids.includes(g.groupId)).reduce((s, g) => ({ pour: s.pour + g.pour, contre: s.contre + g.contre }), { pour: 0, contre: 0 });
const GAUCHE = ['lfi_nfp', 'ecos', 'gdr', 'soc'];
const DROITE = ['rn', 'dr', 'udr'];

describe('parlement', () => {
  it('coefficients au format de coefficients.json', () => {
    expect(Coefficients.parse(PARLIAMENT_COEFFICIENTS)).toHaveLength(PARLIAMENT_COEFFICIENTS.length);
    expect(PARLIAMENT_COEFFICIENTS.every((c) => c.hypothese)).toBe(true);
  });

  it('est déterministe et fait avancer le rng', () => {
    const a = voteBill(state(), bill(['austerite_depenses']), 'assemblee');
    const b = voteBill(state(), bill(['austerite_depenses']), 'assemblee');
    expect(a).toEqual(b);
    expect(a.rng).not.toBe(42);
    expect(voteBill(state({ rng: 7 }), bill(['austerite_depenses']), 'assemblee').result).not.toEqual(a.result);
  });

  it('somme des voix ≤ sièges', () => {
    for (const tags of [['agriculture_soutien'], ['redistribution'], ['immigration_restriction']]) {
      const an = voteBill(state(), bill(tags), 'assemblee').result;
      expect(an.pour + an.contre + an.abstention).toBeLessThanOrEqual(577);
      const se = voteBill(state(), bill(tags), 'senat').result;
      expect(se.pour + se.contre + se.abstention).toBeLessThanOrEqual(348);
      for (const g of an.parGroupe) expect(Math.min(g.pour, g.contre, g.abstention)).toBeGreaterThanOrEqual(0);
    }
  });

  it('une mesure consensuelle passe, un budget d\'austérité échoue', () => {
    // Le vote est tiré (chocs parlement_incertitude_*) : on teste la probabilité prévue.
    expect(forecastVote(state(), bill(['agriculture_soutien']), 'assemblee').probabiliteAdoption).toBeGreaterThan(0.6);
    expect(forecastVote(state(), bill(['austerite_depenses', 'fiscalite_hausse']), 'assemblee').probabiliteAdoption).toBeLessThan(0.2);
  });

  it('une loi marquée à droite est rejetée par la gauche, et inversement', () => {
    const droite = voteBill(state(), bill(['immigration_restriction', 'securite_justice']), 'assemblee').result;
    expect(camp(droite, GAUCHE).contre).toBeGreaterThan(camp(droite, GAUCHE).pour);
    expect(camp(droite, DROITE).pour).toBeGreaterThan(camp(droite, DROITE).contre);
    const gauche = voteBill(state(), bill(['redistribution', 'fiscalite_hausse']), 'assemblee').result;
    expect(camp(gauche, DROITE).contre).toBeGreaterThan(camp(gauche, DROITE).pour);
    expect(camp(gauche, GAUCHE).pour).toBeGreaterThan(camp(gauche, GAUCHE).contre);
  });

  it('censure adoptée si et seulement si ≥ 289 voix', () => {
    const forte = voteCensure(state(), bill(['austerite_depenses', 'fiscalite_hausse'])).result;
    expect(forte.chambre).toBe('censure');
    expect(forte.pour).toBeGreaterThanOrEqual(289);
    expect(forte.adopte).toBe(true);
    const faible = voteCensure(state(), bill(['agriculture_soutien'])).result;
    expect(faible.pour).toBeLessThan(289);
    expect(faible.adopte).toBe(false);
    // La majorité ne vote pas la censure.
    expect(forte.parGroupe.map((g) => g.groupId)).not.toContain('epr');
  });

  it('49.3 : illimité pour un budget, une fois par année civile sinon', () => {
    const budget = bill(['fiscalite_hausse'], { estimatedCost: 5 });
    const autre = bill(['securite_justice']);
    const deja = state({ parliament: { ...state().parliament, usages493: [2026, 2026, 2026] } });
    expect(can493(deja, budget)).toBe(true);
    expect(can493(state(), autre)).toBe(true);
    expect(can493(deja, autre)).toBe(false);
    expect(can493(state({ parliament: { ...state().parliament, usages493: [2025] } }), autre)).toBe(true);
    // Tag budgétaire sans coût : pas un budget.
    expect(can493(deja, bill(['fiscalite_hausse']))).toBe(false);
  });
});

it('censure : les groupes hors majorité peuvent atteindre le seuil (opposition seule : non)', () => {
  const hors = politics.assemblee.groupes.filter((g) => g.rapport_gouvernement !== 'majorite').reduce((a, g) => a + g.sieges, 0);
  const opposition = politics.assemblee.groupes.filter((g) => g.rapport_gouvernement === 'opposition').reduce((a, g) => a + g.sieges, 0);
  const seuil = PARLIAMENT_COEFFICIENTS.find((c) => c.id === 'censure_seuil')!.value;
  expect(hors).toBeGreaterThanOrEqual(seuil);
  expect(opposition).toBeLessThan(seuil);
});
