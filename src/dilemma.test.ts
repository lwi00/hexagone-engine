import { describe, expect, test } from 'vitest';
import { engine } from './index.ts';
import { premierMardiOctobre } from './tick.ts';
import type { GameState } from './types.ts';

// Un dilemme en attente, tel que le tick le pose après le tirage de « crise_bancaire » (ENGINE.md §5c).
const pending = (): GameState => {
  const s = engine.newGame({ seed: 3, mode: 'decret' });
  s.dilemme = { id: 'crise_bancaire', titre: 'Crise', description: '', choix: [
    { id: 'rassurer', label: 'Rassurer', description: '' }, { id: 'garantie', label: 'Garantir', description: '' }, { id: 'recapitalisation', label: 'Recapitaliser', description: '' },
  ] };
  return s;
};

describe('dilemmes (ENGINE.md §5c)', () => {
  test('choose applique les effets du choix et lève le dilemme', () => {
    const s = pending();
    const r = engine.choose(s, 'recapitalisation');
    expect(r.state.dilemme).toBeUndefined();
    expect(r.events).toEqual([{ kind: 'choix', eventId: 'crise_bancaire', titre: 'Crise', label: 'Recapitaliser les banques fragiles', parDefaut: false }]);
    expect(r.state.effects.length - s.effects.length).toBe(3);
    expect(s.dilemme).toBeDefined(); // pur
    expect(engine.choose(s, 'inconnu').state).toBe(s);
  });

  test('sans décision, le mois suivant applique le premier choix', () => {
    const { state, report } = engine.endTurn(pending());
    expect(report.events[0]).toMatchObject({ kind: 'choix', label: 'Rassurer sans engager d\'argent public', parDefaut: true });
    expect(state.dilemme?.id).not.toBe('crise_bancaire');
  });

  test('le tirage pose un dilemme pour les modèles à choix', () => {
    let found = false;
    for (let seed = 1; seed <= 40 && !found; seed++) {
      let s = engine.newGame({ seed, mode: 'decret' });
      for (let i = 0; i < 60 && !engine.isOver(s) && !found; i++) {
        s = engine.endTurn(s).state;
        if (s.dilemme) found = s.dilemme.choix.length >= 2;
      }
    }
    expect(found).toBe(true);
  });
});

describe('calendrier budgétaire (ENGINE.md §5d)', () => {
  const jusqua = (s: GameState, month: number) => {
    const ev = [];
    while (s.date.year === 2026 && s.date.month <= month) { const r = engine.endTurn(s); s = r.state; ev.push(...r.report.events); }
    return { s, ev };
  };

  test('premier mardi d\'octobre', () => {
    expect([2026, 2027, 2028, 2029].map(premierMardiOctobre)).toEqual([6, 5, 3, 2]);
  });

  test('rentrée en septembre, loi spéciale sans PLF adopté au 31 décembre', () => {
    const { ev } = jusqua(engine.newGame({ seed: 5, mode: 'decret' }), 12);
    const ids = ev.flatMap((e) => (e.kind === 'event' ? [e.id] : []));
    expect(ids).toContain('rentree_budgetaire_2027');
    expect(ids).toContain('loi_speciale_2027');
  });

  test('un PLF adopté évite la loi spéciale', () => {
    let s = jusqua(engine.newGame({ seed: 5, mode: 'decret' }), 8).s; // 1er septembre 2026
    s = engine.addDraft(s, { title: 'PLF 2027', summary: 's', articles: ['a'], levers: [{ id: 'depenses.defense', delta: 1 }], qualitative: [],
      tags: ['relance_depenses'], prepMonths: 2, rampMonths: 0, estimatedCost: 1, loiDeFinances: 2027 });
    s = engine.deposit(s, s.bills[s.bills.length - 1].id);
    const ids = jusqua(s, 12).ev.flatMap((e) => (e.kind === 'event' ? [e.id] : []));
    expect(ids).not.toContain('loi_speciale_2027');
  });
});
