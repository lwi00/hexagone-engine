import { describe, expect, test } from 'vitest';
import { engine } from './index.ts';
import { JOUEUR, PRESIDENTIELLE, presidentielle } from './presidentielle.ts';
import { monthIndex, type GameState, type TurnEvent } from './types.ts';

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
});
