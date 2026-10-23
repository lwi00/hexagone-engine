// Conseil constitutionnel (ENGINE.md §15).
import { describe, expect, test } from 'vitest';
import { engine } from './index.ts';
import { articles, decider, decisions, risqueConseil, saisine } from './conseil.ts';
import { can493 } from './parliament.ts';
import { C } from './init.ts';
import { REQUIRED_COEFFICIENTS, Tags } from './schemas.ts';
import { monthIndex } from './types.ts';
import type { Bill, BillSpec, GameMode, GameState, TurnEvent } from './types.ts';
import coefficients from '../gamedata/coefficients.json';
import tags from '../gamedata/tags.json';

const spec = (title: string, levers: BillSpec['levers'], tagsLoi: string[], extra: Partial<BillSpec> = {}): BillSpec => ({
  title, summary: title, articles: [title], levers, qualitative: [], tags: tagsLoi, prepMonths: 1, rampMonths: 0, estimatedCost: 0, ...extra,
});
const SMIC = spec('SMIC', [{ id: 'travail.smic', delta: 100 }], ['redistribution']);
const DEFENSE = spec('Défense', [{ id: 'depenses.defense', delta: 5 }], ['securite_justice', 'relance_depenses']);
const AUSTERITE = spec('Austérité', [{ id: 'depenses.sante', delta: -5 }, { id: 'depenses.collectivites', delta: -8 }, { id: 'depenses.aides_sociales', delta: -7 },
  { id: 'tva.taux_normal', delta: 1 }], ['austerite_depenses', 'fiscalite_hausse']);
const tension = (intensite: 'faible' | 'moyenne' | 'forte'): BillSpec['qualitative'][number] => ({ cible: { kind: 'tension' }, direction: 1, intensite, justification: 'Mesure test' });
const IMMIGRATION = spec('Immigration', [{ id: 'depenses.securite', delta: 1 }], ['immigration_restriction'], { qualitative: [tension('forte')] });
const IMPOT = spec('Impôt', [], ['redistribution'], { reforme: { modele: 'creer_impot', assiette: 'tres_hauts_patrimoines', taux: 4 } });

const depose = (s: GameState, sp: BillSpec) => { s = engine.addDraft(s, sp); return engine.deposit(s, s.bills.at(-1)!.id); };
const bill = (sp: BillSpec, extra: Partial<Bill> = {}): Bill => ({ id: 'loi-1', spec: structuredClone(sp), status: 'preparation', votes: [], ...extra });
// Tours jusqu'au premier événement du genre demandé (12 au plus) : [état après ce tour, événements du tour].
function jusqua(s: GameState, kind: TurnEvent['kind']): [GameState, TurnEvent[]] {
  for (let i = 0; i < 12; i++) {
    const r = engine.endTurn(s);
    s = r.state;
    if (r.report.events.some((e) => e.kind === kind)) return [s, r.report.events];
  }
  throw new Error(`pas d'événement ${kind}`);
}
// Première graine de décision qui donne l'issue voulue, en partie neuve (texte déféré au mois 0).
function graineIssue(sp: BillSpec, issue: 'partielle' | 'totale', extra: Partial<Bill> = {}, mode: GameMode = 'democratie') {
  for (let seed = 1; seed <= 500; seed++) {
    const s = engine.newGame({ seed, mode }), b = bill(sp, extra);
    const sa = saisine(s, b);
    if (!sa) continue;
    b.saisine = sa;
    s.bills.push(b);
    const ev = decider(s, b, 0);
    if (ev[0].kind === 'conseil' && ev[0].issue === issue) return { s, b, ev };
  }
  throw new Error(`aucune graine pour ${issue}`);
}

describe('Conseil constitutionnel (§15)', () => {
  test('Défense : pas de saisine, promulgation au mois du vote', () => {
    const [s, ev] = jusqua(depose(engine.newGame({ seed: 1, mode: 'democratie' }), DEFENSE), 'promulgation');
    const b = s.bills[0];
    expect(ev.some((e) => e.kind === 'saisine')).toBe(false);
    expect(b.saisine).toBeUndefined();
    expect(b.promulgueLe).toEqual(b.voteLe);
  });

  test('SMIC : saisine au vote, texte gelé, décision et promulgation le mois suivant', () => {
    const [s, ev] = jusqua(depose(engine.newGame({ seed: 1, mode: 'democratie' }), SMIC), 'saisine');
    const b = s.bills[0], vote = monthIndex(s.date) - 1;
    expect(b.status).toBe('preparation');
    expect(ev.some((e) => e.kind === 'promulgation')).toBe(false);
    expect(monthIndex(b.saisine!.decisionLe)).toBe(vote + 1);
    expect(b.saisine!.sieges).toBeGreaterThanOrEqual(60);
    expect(engine.withdraw(s, b.id)).toBe(s);
    expect(engine.amend(s, b.id, { ...SMIC, title: 'autre' })).toBe(s);
    const r = engine.endTurn(s);
    const kinds = r.report.events.map((e) => e.kind).filter((k) => k === 'conseil' || k === 'promulgation');
    expect(kinds).toEqual(['conseil', 'promulgation']);
    expect(monthIndex(r.state.bills[0].promulgueLe!)).toBe(vote + 1);
  });

  test('49.3 non censuré : saisine posée, décision au tick suivant ; loi de finances en décembre décidée dans le tick', () => {
    let s = engine.newGame({ seed: 1, mode: 'democratie' });
    s = jusqua(depose(s, AUSTERITE), 'vote')[0];
    expect(s.bills[0].status).toBe('rejetee');
    const u = engine.use493(s, 'loi-1');
    expect(u.events.map((e) => e.kind)).toEqual(['vote', 'censure', 'saisine']);
    const b = u.state.bills[0];
    expect(b.status).toBe('preparation');
    expect(monthIndex(b.saisine!.decisionLe)).toBe(monthIndex(u.state.date) + 1);
    const t1 = engine.endTurn(u.state);
    expect(t1.report.events.some((e) => e.kind === 'conseil')).toBe(false);
    expect(engine.endTurn(t1.state).report.events.some((e) => e.kind === 'conseil')).toBe(true);

    // Loi de finances pour 2027 rejetée à l'Assemblée en décembre 2026, 49.3 : décision le même mois, pas de loi spéciale.
    const lf = { ...AUSTERITE, title: 'Loi de finances 2027', loiDeFinances: 2027 };
    for (let seed = 1; seed <= 50; seed++) {
      const x = engine.newGame({ seed, mode: 'democratie' });
      x.date = { year: 2026, month: 12 };
      x.bills.push(bill(lf, { status: 'rejetee', deposeLe: { year: 2026, month: 11 }, voteLe: { year: 2026, month: 11 } }));
      const r = engine.use493(x, 'loi-1');
      if (!r.state.bills[0].saisine) continue; // censure adoptée : graine suivante
      expect(r.state.bills[0].saisine!.decisionLe).toEqual({ year: 2026, month: 12 });
      const t = engine.endTurn(r.state);
      const c = t.report.events.find((e) => e.kind === 'conseil');
      if (c?.kind !== 'conseil' || c.issue === 'totale') continue;
      expect(t.state.bills[0].status).toBe('adoptee');
      expect(t.report.events.some((e) => e.kind === 'event' && e.id === 'loi_speciale_2027')).toBe(false);
      return;
    }
    throw new Error('aucune graine sans censure');
  });

  test('articles et censure partielle : cavalier retiré, leviers conservés', () => {
    const lf = spec('Loi de finances', [{ id: 'depenses.defense', delta: 2 }], ['fiscalite_hausse'], { loiDeFinances: 2027, qualitative: [tension('forte')] });
    expect(articles(bill(lf))).toEqual([expect.objectContaining({ motif: 'cavalier', p: C.conseil_p_cavalier, label: 'Mesure test' })]);
    const { s, b, ev } = graineIssue(lf, 'partielle');
    expect(b.status).toBe('adoptee');
    expect(b.spec.qualitative).toEqual([]);
    expect(b.spec.levers).toEqual(lf.levers);
    expect(b.saisine!.censures).toHaveLength(1);
    expect(b.saisine!.censures![0].mesure).toEqual(tension('forte'));
    expect(s.effects.some((e) => e.source.kind === 'bill')).toBe(false);
    expect(s.effects.some((e) => e.source.kind === 'lever' && e.source.id === 'depenses.defense')).toBe(true);
    expect(ev).toEqual([{ kind: 'conseil', billId: 'loi-1', issue: 'partielle', censures: ['Mesure test'] }, { kind: 'promulgation', billId: 'loi-1' }]);
  });

  test('censure totale : rejetée, plus de 49.3, chocs', () => {
    const { s, b } = graineIssue(IMPOT, 'totale', { usage493: true });
    expect(b.status).toBe('rejetee');
    expect(b.saisine!.issue).toBe('totale');
    expect(b.promulgueLe).toBeUndefined();
    expect(can493(s, b)).toBe(false);
    expect(engine.use493(s, b.id).events).toEqual([]);
    const chocs = s.effects.filter((e) => e.source.id === 'conseil:loi-1').map((e) => e.cible.kind).sort();
    expect(chocs).toEqual(['popularite', 'stabilite']);
  });

  test('révision constitutionnelle et décret : jamais de saisine', () => {
    const s = engine.newGame({ seed: 1, mode: 'democratie' });
    const rev = spec('Proportionnelle', [], ['institutions_democratie_directe'], { reforme: { modele: 'proportionnelle', seuil: 5, prime: 0 } });
    expect(saisine(s, bill(rev, { usage493: true }))).toBeNull();
    expect(saisine(engine.newGame({ seed: 1, mode: 'decret' }), bill(SMIC, { usage493: true }))).toBeNull();
    const [d, ev] = jusqua(depose(engine.newGame({ seed: 1, mode: 'decret' }), SMIC), 'promulgation');
    expect(ev.some((e) => e.kind === 'saisine')).toBe(false);
    expect(d.bills[0].saisine).toBeUndefined();
  });

  test('decider ne touche pas s.rng ; risqueConseil est pur', () => {
    const s = engine.newGame({ seed: 3, mode: 'democratie' }), b = bill(IMMIGRATION);
    const avant = structuredClone(s);
    risqueConseil(s, b);
    expect(s).toEqual(avant);
    b.saisine = saisine(s, b)!;
    s.bills.push(b);
    decider(s, b, 0);
    expect(s.rng).toBe(avant.rng);
  });

  test('loi sans champ saisine (sauvegarde antérieure) : jamais décidée', () => {
    let s = jusqua(depose(engine.newGame({ seed: 1, mode: 'democratie' }), DEFENSE), 'promulgation')[0];
    s = JSON.parse(JSON.stringify(s));
    expect(decisions(s, monthIndex(s.date))).toEqual([]);
    const r = engine.endTurn(s);
    expect(r.report.events.some((e) => e.kind === 'conseil' || e.kind === 'saisine')).toBe(false);
  });

  test('previewBill : risque de censure pour l\'immigration, aucun pour la Défense', () => {
    const s = engine.newGame({ seed: 1, mode: 'democratie' });
    const imm = engine.previewBill(s, IMMIGRATION, 6).conseil!;
    expect(imm.saisine).not.toBeNull();
    expect(imm.partielle).toBeGreaterThan(0);
    expect(imm.articles).toEqual([{ label: 'Mesure test', motif: 'libertes', p: 0.5 }]);
    expect(engine.previewBill(s, DEFENSE, 6).conseil!.saisine).toBeNull();
    expect(engine.previewBill(engine.newGame({ seed: 1, mode: 'decret' }), IMMIGRATION, 6).conseil).toBeUndefined();
  });

  test('une dissolution le mois de la décision ne la reporte pas', () => {
    const [s] = jusqua(depose(engine.newGame({ seed: 1, mode: 'democratie' }), SMIC), 'saisine');
    const d = engine.dissolve(s);
    expect(d.events).toEqual([{ kind: 'dissolution' }]);
    const r = engine.endTurn(d.state);
    expect(r.report.events.some((e) => e.kind === 'conseil')).toBe(true);
    expect(r.report.events.some((e) => e.kind === 'legislatives')).toBe(true);
  });

  test('texte déféré en décembre 2030 : décidé au dernier tick (t = 59), pas en 2031', () => {
    const s = engine.newGame({ seed: 1, mode: 'democratie' }), b = bill(SMIC);
    const sa = saisine(s, b)!;
    b.saisine = { ...sa, decisionLe: { year: 2031, month: 1 } };
    s.bills.push(b);
    expect(decisions(s, 58)).toEqual([]);
    const ev = decisions(s, 59);
    expect(ev[0].kind).toBe('conseil');
    expect(b.saisine.issue).toBeDefined();
    expect(ev.some((e) => e.kind === 'promulgation')).toBe(b.saisine.issue !== 'totale');
  });

  test('validateur et coefficients', () => {
    expect(Tags.safeParse(tags).success).toBe(true);
    expect(tags.filter((t) => 'conseil' in t).map((t) => t.id).sort()).toEqual(['fiscalite_hausse', 'immigration_restriction', 'redistribution', 'securite_justice']);
    const ids = coefficients.filter((c) => c.id.startsWith('conseil_')).map((c) => c.id);
    expect(ids).toHaveLength(9);
    for (const id of ids) {
      expect(REQUIRED_COEFFICIENTS).toContain(id);
      expect(coefficients.find((c) => c.id === id)?.hypothese).toBe(true);
    }
  });
});
