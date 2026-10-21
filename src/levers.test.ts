import { expect, test } from 'vitest';
import { bareme, effectValue, sumEffects } from './levers.ts';
import type { ActiveEffect } from './types.ts';

const eff = (e: Partial<ActiveEffect>): ActiveEffect => ({
  source: { kind: 'lever', id: 'x' }, cible: { kind: 'popularite' }, amplitude: 1, forme: 'niveau', debut: 2, rampe: 0, ...e,
});

test('effectValue : délai, rampe, niveau borné, choc décroissant', () => {
  expect(effectValue(eff({}), 1)).toBe(0);
  expect(effectValue(eff({}), 2)).toBe(1);
  expect(effectValue(eff({ rampe: 4 }), 3)).toBe(0.5);
  expect(effectValue(eff({ rampe: 4 }), 10)).toBe(1);
  expect(effectValue(eff({ duree: 3 }), 5)).toBe(0);
  expect(effectValue(eff({ forme: 'choc', duree: 4 }), 2)).toBe(1);
  expect(effectValue(eff({ forme: 'choc', duree: 4 }), 4)).toBe(0.5);
  expect(effectValue(eff({ forme: 'choc', duree: 4 }), 6)).toBe(0);
});

test('barème et agrégation', () => {
  expect(bareme({ kind: 'indicator', id: 'inflation' }, 1, 'forte')).toBe(1.2);
  expect(bareme({ kind: 'region', id: '11' }, -1, 'moyenne')).toBe(-0.05);
  expect(bareme({ kind: 'notation', id: 'Scope' }, 1, 'forte')).toBe(1); // crans directement (ENGINE.md §5)
  const acc = sumEffects([
    eff({ cible: { kind: 'notation', id: 'Scope' }, debut: 0 }),
    eff({ cible: { kind: 'notation', id: 'Fitch' }, debut: 0 }),
    eff({ cible: { kind: 'group', id: 'cadres' }, forme: 'choc', duree: 2, debut: 0 }),
  ], 0);
  expect(acc.notation).toBe(1.5);
  expect(acc['group:cadres:choc']).toBe(1);
});

test('cibles scalaires : id ignoré', () => {
  expect(sumEffects([eff({ cible: { kind: 'popularite', id: 'national' }, debut: 0 })], 0)['popularite:']).toBe(1);
});
