import { describe, expect, test } from 'vitest';
import { engine } from './index.ts';
import { forecastVote, voteBill } from './parliament.ts';
import tagList from '../gamedata/tags.json';
import type { BillSpec, GameState } from './types.ts';

const spec = (levers: BillSpec['levers'], extra: Partial<BillSpec> = {}): BillSpec => ({
  title: 'Loi test', summary: 'Résumé', articles: ['Article 1'], levers, qualitative: [], tags: ['redistribution'],
  prepMonths: 0, rampMonths: 0, estimatedCost: 0, ...extra,
});
const run = (s: GameState, n: number) => {
  for (let i = 0; i < n; i++) s = engine.endTurn(s).state;
  return s;
};
const TVA = spec([{ id: 'tva.taux_normal', delta: 2 }], { tags: ['fiscalite_hausse'], prepMonths: 1 });

describe('previewBill', () => {
  test('loi vide : écart nul partout', () => {
    // tag sans réaction négative : une loi impopulaire, même vide, ferait monter la tension (ENGINE.md §3)
    const p = engine.previewBill(engine.newGame({ seed: 3, mode: 'democratie' }), spec([], { tags: ['services_publics'] }), 24);
    expect(p.months).toBe(24);
    expect(p.dates).toHaveLength(24);
    expect(p.dates[0]).toEqual({ year: 2026, month: 1 });
    expect(Object.values(p.ecart).every((v) => v === 0)).toBe(true);
    expect(p.budget).toEqual([]);
    for (const x of [...p.groupes, ...p.intentions]) expect(x.ecart).toBe(0);
    for (const r of p.regions) expect([r.tension, r.chomage]).toEqual([0, 0]);
    expect(JSON.stringify(p.avec)).toBe(JSON.stringify(p.sans));
  });

  test('TVA +2 : recettes de TVA et inflation en hausse', () => {
    const p = engine.previewBill(engine.newGame({ seed: 1, mode: 'decret' }), TVA, 12);
    expect(p.ecart.inflation!).toBeGreaterThan(0.5);
    expect(p.budget[0]).toMatchObject({ ligne: 'recettes.tva' });
    expect(p.budget[0].ecart).toBeGreaterThan(14);
    // adoptée en février, effets de la TVA un mois plus tard (delai_mois du levier) : janvier identique, puis divergence
    expect(p.avec[0]).toEqual(p.sans[0]);
    expect(p.avec[2].inflation).toBeGreaterThan(p.sans[2].inflation);
    for (let i = 1; i < p.budget.length; i++) expect(Math.abs(p.budget[i].ecart)).toBeLessThanOrEqual(Math.abs(p.budget[i - 1].ecart));
    expect(p.vote).toEqual([]); // mode décret
  });

  test("ne modifie pas l'état d'entrée et est déterministe", () => {
    const s = run(engine.newGame({ seed: 5, mode: 'democratie' }), 3);
    const avant = JSON.stringify(s);
    const a = engine.previewBill(s, TVA, 18), b = engine.previewBill(s, TVA, 18);
    expect(JSON.stringify(s)).toBe(avant);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.dates[0]).toEqual({ year: 2026, month: 4 });
  });

  test('horizon compté après l\'adoption, borné à [6, 60] et à la fin de la partie', () => {
    const s = engine.newGame({ seed: 1, mode: 'decret' });
    expect(engine.previewBill(s, TVA, 2).months).toBe(7); // adoption en février + 6 mois
    // préparation plus longue que l'horizon : la loi est quand même appliquée dans la fenêtre
    const long = engine.previewBill(s, { ...TVA, prepMonths: 12 }, 6);
    expect(long.months).toBe(18);
    expect(long.ecart.inflation!).toBeGreaterThan(0.5);
    expect(engine.previewBill(s, TVA, 99).months).toBe(60);
    const fin = run(s, 56); // septembre 2030 : 4 mois restants
    const p = engine.previewBill(fin, TVA, 24);
    expect(p.months).toBe(4);
    expect(p.dates.at(-1)).toEqual({ year: 2030, month: 12 });
  });

  test('loi déjà déposée retirée de la liste : prévisualise bien la nouvelle loi', () => {
    // loi-1 brouillon, loi-2 déposée (retirée de l'état comme dans l'interface), loi-3 brouillon SMIC : le brouillon
    // ajouté par la prévisualisation ne doit pas prendre l'id d'une loi existante.
    let s = engine.newGame({ seed: 2, mode: 'decret' });
    s = engine.addDraft(s, TVA);
    s = engine.addDraft(s, spec([], { tags: ['services_publics'] }));
    s = engine.addDraft(s, spec([], { tags: ['services_publics'] }));
    s = engine.addDraft(s, spec([{ id: 'tva.taux_normal', delta: -2 }], { tags: ['services_publics'] }));
    expect(s.bills.map((b) => b.id)).toEqual(['loi-1', 'loi-2', 'loi-3', 'loi-4']);
    const sansLoi2 = { ...s, bills: s.bills.filter((b) => b.id !== 'loi-2') };
    expect(engine.addDraft(sansLoi2, TVA).bills.at(-1)!.id).toBe('loi-5');
    const p = engine.previewBill(sansLoi2, spec([], { tags: ['services_publics'] }), 12);
    expect(Object.values(p.ecart).every((v) => v === 0)).toBe(true);
    expect(p.budget).toEqual([]);
  });

  // Seuil large : ~30 ms seul, jusqu'à 250 ms quand toute la suite tourne en parallèle.
  test('rapide : 60 mois en moins de 250 ms', () => {
    const s = engine.newGame({ seed: 1, mode: 'democratie' });
    engine.previewBill(s, TVA, 60); // chauffe
    const t = performance.now();
    engine.previewBill(s, TVA, 60);
    expect(performance.now() - t).toBeLessThan(250);
  });

  test('prévision de vote cohérente avec voteBill', () => {
    const s = engine.newGame({ seed: 1, mode: 'democratie' });
    const cas = [['agriculture_soutien'], ['austerite_depenses', 'fiscalite_hausse'], ['immigration_restriction', 'securite_justice'], ['redistribution', 'fiscalite_hausse']];
    for (const tags of cas) {
      const sp = spec([], { tags });
      const [an, se] = engine.previewBill(s, sp, 6).vote;
      expect([an.chambre, se.chambre]).toEqual(['assemblee', 'senat']);
      const bill = { id: 'x', spec: sp, status: 'preparation' as const, votes: [] };
      for (const v of [an, se]) {
        const reel = voteBill(s, bill, v.chambre).result;
        if (v.probabiliteAdoption < 0.02 || v.probabiliteAdoption > 0.98) expect(v.probabiliteAdoption > 0.5).toBe(reel.adopte);
        expect(v.pour + v.contre + v.abstention).toBeCloseTo(reel.pour + reel.contre + reel.abstention, 6);
        expect(Math.abs(v.pour - reel.pour)).toBeLessThan(80); // l'écart vient des chocs et de la dissidence tirés
        expect(v.probabiliteAdoption).toBeGreaterThanOrEqual(0);
        expect(v.probabiliteAdoption).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('forecastVote contre voteBill tiré', () => {
  test('probabilité et voix attendues proches de la fréquence simulée', () => {
    const s = engine.newGame({ seed: 1, mode: 'democratie' });
    const ids = tagList.map((t) => t.id);
    const cas: string[][] = [];
    for (let i = 0; i < ids.length; i++) for (let j = i; j < ids.length; j++) cas.push(i === j ? [ids[i]] : [ids[i], ids[j]]);
    let pires = 0, n = 0;
    for (const tags of cas) {
      const bill = { id: 'x', spec: spec([], { tags }), status: 'preparation' as const, votes: [] };
      for (const ch of ['assemblee', 'senat'] as const) {
        const f = forecastVote(s, bill, ch);
        if (f.probabiliteAdoption < 0.05 || f.probabiliteAdoption > 0.95) continue;
        const N = 1500;
        let adopt = 0, pour = 0;
        for (let k = 0; k < N; k++) {
          const r = voteBill({ ...s, rng: (k * 2654435761) >>> 0 }, bill, ch).result;
          adopt += r.adopte ? 1 : 0; pour += r.pour;
        }
        n++; pires = Math.max(pires, Math.abs(f.probabiliteAdoption - adopt / N));
        expect(Math.abs(f.pour - pour / N)).toBeLessThan(3);
      }
    }
    expect(n).toBeGreaterThan(10);
    expect(pires).toBeLessThan(0.08); // deux Monte-Carlo indépendants (1000 et 1500 tirages)
  }, 30000);
});
