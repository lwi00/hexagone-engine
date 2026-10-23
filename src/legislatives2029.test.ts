// Législatives de juin 2029 (ENGINE.md §17).
import { describe, expect, test } from 'vitest';
import { engine } from './index.ts';
import { echeanceLegislatives, elections } from './institutions.ts';
import { endTurn } from './tick.ts';
import { monthIndex } from './types.ts';
import type { GameState, TurnEvent } from './types.ts';

// État au début du mois t, en bac à sable (aucune défaite) ; partagé par les tests (lecture seule).
const jusqua = (s: GameState, t: number, evs: TurnEvent[][] = []) => {
  while (monthIndex(s.date) < t) { const r = engine.endTurn(s); evs.push(r.report.events); s = r.state; }
  return s;
};
const evs: TurnEvent[][] = [];
const s40 = jusqua(engine.newGame({ seed: 1, mode: 'bac_a_sable' }), 40, evs);
const leg = (e: TurnEvent[]) => e.find((x) => x.kind === 'legislatives');

describe('législatives de juin 2029 (ENGINE.md §17)', () => {
  test('bac à sable : annonce en mars, scrutin en juin, dissolution possible en juin 2030', () => {
    expect(echeanceLegislatives(s40)).toEqual({ year: 2029, month: 6 });
    expect(engine.pouvoir(s40).prochainesLegislatives).toEqual({ year: 2029, month: 6 });
    const annonce = evs[38].find((e) => e.kind === 'event' && e.id === 'legislatives_2029_annonce');
    expect(annonce?.kind === 'event' && annonce.description).toContain('19 juin');
    expect(evs.slice(0, 40).some((e) => leg(e))).toBe(false);
    const s41 = jusqua(s40, 41), r = engine.endTurn(s41), l = leg(r.report.events);
    expect(l?.kind === 'legislatives' && l.normales).toBe(true);
    expect(r.state.institutions!.legislatives).toEqual({ year: 2029, month: 6 });
    expect(echeanceLegislatives(r.state).year).toBe(2034);
    let x = r.state;
    for (let t = 42; t < 53; t++) { expect(engine.pouvoir(x).peutDissoudre).toBe(false); x = engine.endTurn(x).state; }
    expect(engine.pouvoir(x).peutDissoudre).toBe(true); // juin 2030
  });

  test('elections(s, t, true) laisse s.rng intact', () => {
    const s = structuredClone(s40), rng = s.rng;
    elections(s, 41, true);
    expect(s.rng).toBe(rng);
  });

  test('dissolution en 2027 : pas de scrutin en juin 2029', () => {
    let s = jusqua(engine.newGame({ seed: 1, mode: 'bac_a_sable' }), 18);
    s = engine.dissolve(s).state;
    const e: TurnEvent[][] = [];
    s = jusqua(s, 42, e);
    expect(e.filter((x) => leg(x)).length).toBe(1); // l'anticipée seulement
    expect(echeanceLegislatives(s).year).toBe(2032);
    expect(e.flat().some((x) => x.kind === 'event' && x.id.startsWith('legislatives_') && x.id.endsWith('_annonce'))).toBe(false);
  });

  test('décret : scrutin tenu, sièges modifiés, gouvernement non démissionnaire', () => {
    const s = { ...jusqua(s40, 41), mode: 'decret' as const }, r = engine.endTurn(s);
    expect(leg(r.report.events)).toBeTruthy();
    expect(r.report.events.some((e) => e.kind === 'nomination')).toBe(false);
    expect(r.state.parliament.assemblee).not.toEqual(s.parliament.assemblee);
    expect(r.state.institutions!.gouvernement).toEqual(s.institutions!.gouvernement);
  });

  test('défaite posée : pas de scrutin ; prévisualisation : pas de scrutin', () => {
    const s = jusqua(s40, 41);
    expect(leg(engine.endTurn({ ...s, defaite: { cause: 'regime', date: s.date } }).report.events)).toBeUndefined();
    const p = endTurn(s, { aleatoire: false });
    expect(leg(p.report.events)).toBeUndefined();
    expect(p.state.institutions!.legislatives).toEqual({ year: 2024, month: 7 });
  });

  test('un texte au vote en juin 2029 est voté en juillet', () => {
    const s = structuredClone(jusqua(s40, 41));
    s.mode = 'democratie';
    s.bills.push({ id: 'b9', spec: { title: 'Loi test', summary: 'R', articles: ['A'], levers: [], qualitative: [], tags: ['services_publics'], prepMonths: 0, rampMonths: 0, estimatedCost: 0 },
      status: 'preparation', votes: [], voteLe: { year: 2029, month: 6 } });
    const r = engine.endTurn(s), b = r.state.bills.find((x) => x.id === 'b9')!;
    expect(b.votes).toEqual([]);
    expect(b.voteLe).toEqual({ year: 2029, month: 7 });
    const r2 = engine.endTurn(r.state);
    expect(r2.state.bills.find((x) => x.id === 'b9')!.votes.length).toBeGreaterThan(0);
  });
});
