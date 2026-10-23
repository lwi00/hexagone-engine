import { describe, expect, test } from 'vitest';
import { engine } from './index.ts';
import { JOUEUR, PRESIDENTIELLE, positionDe, positionPresident, presidentielle } from './presidentielle.ts';
import { monthIndex, type BillSpec, type GameState, type TurnEvent } from './types.ts';

const T1 = monthIndex(PRESIDENTIELLE.tour1);
const jouer = (n: number) => {
  let s = engine.newGame({ seed: 11, mode: 'decret' });
  const ev: TurnEvent[] = [];
  for (let i = 0; i < n && !engine.isOver(s); i++) { const r = engine.endTurn(s); s = r.state; ev.push(...r.report.events); }
  return { s, ev };
};
const avec = (s: GameState, joueur: number) => {
  const x = structuredClone(s);
  x.intentions[JOUEUR] = joueur;
  return x;
};

describe('présidentielle 2027 (ENGINE.md §12)', () => {
  test('annonce en janvier 2027, premier tour au tick d\'avril, deux qualifiés', () => {
    const { ev } = jouer(T1 + 1);
    expect(ev.some((e) => e.kind === 'event' && e.id === 'presidentielle_2027_annonce')).toBe(true);
    const t1 = ev.find((e) => e.kind === 'presidentielle' && e.tour === 1);
    expect(t1).toBeDefined();
    if (t1?.kind !== 'presidentielle') return;
    expect(t1.resultats.reduce((a, r) => a + r.pct, 0)).toBeCloseTo(100, 6);
    expect(t1.qualifies).toEqual([t1.resultats[0].partyId, t1.resultats[1].partyId]);
  });

  test('éliminé au premier tour : défaite', () => {
    const s = avec(jouer(T1).s, 0.5);
    const ev = presidentielle(s, T1);
    expect(ev.map((e) => e.kind)).toEqual(['presidentielle', 'defaite']);
    expect(s.defaite?.cause).toBe('presidentielle');
    expect(engine.isOver(s)).toBe(true);
  });

  test('largement en tête : réélu au second tour, état de grâce', () => {
    const s = avec(jouer(T1).s, 80);
    presidentielle(s, T1);
    const n = s.effects.length;
    const ev = presidentielle(s, T1 + 1);
    expect(ev[0]).toMatchObject({ kind: 'presidentielle', tour: 2, elu: JOUEUR });
    expect(s.defaite).toBeUndefined();
    expect(s.effects.length).toBe(n + 2);
  });

  test('prévision : pure, probabilités cohérentes', () => {
    const s = engine.newGame({ seed: 1, mode: 'democratie' });
    const a = engine.forecastPresidentielle(s), b = engine.forecastPresidentielle(s);
    expect(a).toEqual(b);
    expect(a.victoire).toBeLessThanOrEqual(a.qualification);
    expect(a.adversaires.reduce((x, y) => x + y.frequence, 0)).toBeCloseTo(a.qualification, 6);
  });

  // Positionnement du Président (ENGINE.md §13).
  const adoptees = (s: GameState, tags: string[], n: number, extra: Partial<BillSpec> = {}): GameState => {
    const x = structuredClone(s);
    for (let i = 0; i < n; i++) x.bills.push({ id: `loi-${i + 1}`, status: 'adoptee', promulgueLe: { year: 2026, month: 1 + i }, votes: [],
      spec: { title: 'Loi', summary: 'Loi', articles: ['Article 1'], levers: [], qualitative: [], tags, prepMonths: 0, rampMonths: 0, estimatedCost: 0, ...extra } });
    return x;
  };

  test('sans loi : position du parti, prévision identique à main', () => {
    const s = engine.newGame({ seed: 1, mode: 'democratie' });
    expect(positionPresident(s)).toEqual(positionDe(JOUEUR));
    const f = engine.forecastPresidentielle(s);
    expect(f.qualification).toBe(0.926); // instantanés pris sur main avant le chantier
    expect(f.victoire).toBe(0.21);
    expect(f.premierTour.find((r) => r.partyId === JOUEUR)!.pct).toBe(16.98972415215752);
  });

  test('une loi de droite déplace la position, une loi de finances non', () => {
    const s = engine.newGame({ seed: 1, mode: 'democratie' }), base = positionDe(JOUEUR);
    const p = positionPresident(adoptees(s, ['entreprises_competitivite'], 1));
    expect(p.economie).toBeGreaterThan(base.economie);
    expect(p.economie - base.economie).toBeLessThanOrEqual(0.8 * 0.06);
    expect(positionPresident(adoptees(s, ['entreprises_competitivite'], 1, { loiDeFinances: 2027 }))).toEqual(base);
    expect(engine.pouvoir(adoptees(s, ['entreprises_competitivite'], 1)).positionnement).toEqual(p);
  });

  test('dérive vers LR : électeurs qui suivent, somme 100, déterministe', () => {
    const s = engine.newGame({ seed: 1, mode: 'democratie' });
    const x = adoptees(s, ['retraites_durcissement', 'securite_justice'], 12);
    const a = engine.forecastPresidentielle(x), b = engine.forecastPresidentielle(x), base = engine.forecastPresidentielle(s);
    const pct = (f: typeof a, p: string) => f.premierTour.find((r) => r.partyId === p)!.pct;
    expect(a).toEqual(b);
    expect(pct(a, JOUEUR)).toBeGreaterThan(pct(base, JOUEUR));
    expect(pct(a, 'lr')).toBeLessThan(pct(base, 'lr'));
    expect(a.premierTour.reduce((t, r) => t + r.pct, 0)).toBeCloseTo(100, 6);
    expect(x.intentions).toEqual(s.intentions); // intentions du tick inchangées
  });
});
