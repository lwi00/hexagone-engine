// Score et bilan de fin de mandat (ENGINE.md §16).
import { describe, expect, test } from 'vitest';
import { engine } from './index.ts';
import { bilan } from './bilan.ts';
import { C } from './init.ts';
import { REQUIRED_COEFFICIENTS } from './schemas.ts';
import type { GameMode, GameState } from './types.ts';
import coefficients from '../gamedata/coefficients.json';

const joue = (mode: GameMode, mois: number, seed = 1) => {
  let s = engine.newGame({ seed, mode });
  for (let i = 0; i < mois && !engine.isOver(s); i++) s = engine.endTurn(s).state;
  return s;
};
const note = (s: GameState, id: string) => bilan(s).rubriques.find((r) => r.id === id)!.note;

describe('bilan de fin de mandat (§16)', () => {
  test('partie neuve : provisoire, notes à 50, aucun fait', () => {
    const b = bilan(engine.newGame({ seed: 1, mode: 'democratie' }));
    expect(b.provisoire).toBe(true);
    expect(b.score).toBe(50);
    expect(b.rubriques.map((r) => r.note)).toEqual([50, 50, 50, 50, 50, 50]);
    expect(b.faits).toEqual([]);
    expect(engine.bilan).toBe(bilan);
  });

  test('bac à sable sans action sur 60 mois : score dans [40, 55], « Mandat d\'attente »', () => {
    const s = joue('bac_a_sable', 60);
    expect(engine.isOver(s)).toBe(true);
    const b = bilan(s);
    expect(b.provisoire).toBe(false);
    expect(b.score).toBeGreaterThanOrEqual(40);
    expect(b.score).toBeLessThanOrEqual(55);
    expect(b.mention).toBe("Mandat d'attente");
    expect(b.faits.length).toBeLessThanOrEqual(3);
    expect(b.rubriques.find((r) => r.id === 'finances')!.detail).toMatch(/^Dette \d+,\d % du PIB \(\+\d+,\d\), déficit \d+,\d %/);
  });

  test('défaite posée : score plafonné, mention de la cause, fait daté', () => {
    const s = joue('democratie', 3);
    s.defaite = { cause: 'dette', date: { ...s.history.at(-1)!.date } };
    const b = bilan(s);
    expect(b.plafond).toBe(C.bilan_plafond_defaite);
    expect(b.score).toBeLessThanOrEqual(C.bilan_plafond_defaite);
    expect(b.mention).toBe('Banqueroute');
    expect(b.faits[0].texte).toMatch(/^Crise de la dette/);
    s.defaite.cause = 'presidentielle';
    expect(bilan(s)).toMatchObject({ plafond: C.bilan_plafond_presidentielle, mention: 'Mandat sans lendemain' });
  });

  test('pureté : état inchangé, s.rng intact', () => {
    const s = joue('democratie', 4);
    const avant = structuredClone(s);
    bilan(s);
    expect(s).toEqual(avant);
    expect(JSON.stringify(s)).toBe(JSON.stringify(avant));
  });

  test('dette plus basse → note des finances plus haute', () => {
    const s = joue('democratie', 3), t = structuredClone(s);
    t.national.dette_publique -= 5;
    expect(note(t, 'finances') - note(s, 'finances')).toBe(5 * C.bilan_k_dette);
  });

  test('dissolve incrémente n:dissolutions et retire bilan_pts_dissolution à la note institutions', () => {
    const s = joue('democratie', 1, 3);
    expect(s.internals['n:dissolutions']).toBeUndefined();
    const d = engine.dissolve(s).state;
    expect(d.internals['n:dissolutions']).toBe(1);
    expect(note(s, 'institutions') - note(d, 'institutions')).toBe(C.bilan_pts_dissolution);
  });

  test('pres:reelu posé au second tour (bac à sable compris), déduit pour une ancienne sauvegarde', () => {
    let s = joue('bac_a_sable', 16);
    expect(s.internals['pres:reelu']).toBeUndefined();
    const r = engine.endTurn(s); // tick de mai 2027 : second tour
    s = r.state;
    const t2 = r.report.events.find((e) => e.kind === 'presidentielle' && e.tour === 2);
    const t1elimine = s.internals['pres:reelu'] === 0 && !t2;
    expect(t1elimine || s.internals['pres:reelu'] === (t2 && t2.kind === 'presidentielle' && t2.elu === t2.joueur ? 1 : 0)).toBe(true);
    // Réélu : bonus de bilan_pts_reelection ; ancienne sauvegarde en Réaliste sans défaite : réélection déduite.
    const x = structuredClone(s);
    x.internals['pres:reelu'] = 1;
    const y = structuredClone(x);
    y.internals['pres:reelu'] = 0;
    expect(note(x, 'institutions') - note(y, 'institutions')).toBe(C.bilan_pts_reelection);
    delete y.internals['pres:reelu'];
    y.mode = 'democratie';
    expect(note(y, 'institutions')).toBe(note(x, 'institutions'));
  });

  test('coefficients bilan_* présents, requis, hypothèses ; poids de somme 1', () => {
    const b = coefficients.filter((x) => x.id.startsWith('bilan_'));
    expect(b).toHaveLength(26);
    for (const c of b) {
      expect(REQUIRED_COEFFICIENTS).toContain(c.id);
      expect(c.hypothese).toBe(true);
    }
    expect(b.filter((x) => x.id.startsWith('bilan_poids_')).reduce((a, x) => a + x.value, 0)).toBeCloseTo(1, 9);
  });
});
