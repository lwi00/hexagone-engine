import { describe, expect, test } from 'vitest';
import { engine } from './index.ts';
import type { GameState, TurnEvent } from './types.ts';

const play = (seed: number, n: number) => {
  let s = engine.newGame({ seed, mode: 'decret' });
  const ev: TurnEvent[] = [];
  for (let i = 0; i < n && !engine.isOver(s); i++) { const r = engine.endTurn(s); s = r.state; ev.push(...r.report.events); }
  return { s, ev };
};
const aleatoires = (ev: TurnEvent[]) => ev.filter((e) => e.kind === 'event' && e.type === 'aleatoire');

describe('événements aléatoires (ENGINE.md §5b)', () => {
  test('tirés selon la graine, reproductibles, au plus un par mois', () => {
    const a = play(7, 60), b = play(7, 60);
    expect(aleatoires(a.ev).length).toBeGreaterThan(5);
    expect(aleatoires(b.ev)).toEqual(aleatoires(a.ev));
  });

  test('absents de la prévisualisation : la trajectoire ne dépend pas de la graine', () => {
    const loi = { title: 't', summary: 't', articles: ['t'], levers: [], qualitative: [], tags: ['redistribution'], prepMonths: 0, rampMonths: 0, estimatedCost: 0 };
    const p = (seed: number) => engine.previewBill(engine.newGame({ seed, mode: 'decret' }), loi, 60).sans;
    expect(p(8)).toEqual(p(7));
  });
});

describe('fin de partie anticipée (ENGINE.md §10)', () => {
  const effondre = (): GameState => {
    const s = engine.newGame({ seed: 1, mode: 'decret' });
    s.internals.Sl = -1; // stabilité lissée très négative : reste sous le seuil plusieurs mois
    return s;
  };

  test('alerte au premier mois, défaite au troisième, partie terminée', () => {
    let s = effondre();
    const r1 = engine.endTurn(s); s = r1.state;
    expect(r1.report.events).toContainEqual({ kind: 'alerte', cause: 'regime', moisRestants: 2 });
    expect(engine.dangers(s)).toMatchObject([{ cause: 'regime', mois: 1, limite: 3 }]);
    expect(engine.isOver(s)).toBe(false);
    s = engine.endTurn(s).state;
    const r3 = engine.endTurn(s); s = r3.state;
    expect(r3.report.events).toContainEqual({ kind: 'defaite', cause: 'regime' });
    expect(s.defaite).toEqual({ cause: 'regime', date: { year: 2026, month: 3 } });
    expect(engine.isOver(s)).toBe(true);
  });

  test("le compteur repart de zéro dès que l'indicateur repasse le seuil", () => {
    let s = engine.endTurn(effondre()).state;
    s.internals.Sl = 0.5;
    s = engine.endTurn(s).state;
    expect(engine.dangers(s)).toEqual([]);
    expect(s.internals['def:regime']).toBe(0);
  });

  test('sans action, aucune défaite sur 10 graines', () => {
    for (let seed = 1; seed <= 10; seed++) expect(play(seed, 60).s.defaite).toBeUndefined();
  });
});
