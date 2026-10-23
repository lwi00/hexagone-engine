// Relations dynamiques, Sénat, nominations et choix du camp (ENGINE.md §13).
import { describe, expect, test } from 'vitest';
import politics from '../gamedata/politics.json';
import { engine } from './index.ts';
import { C, REL0, dansBande, seuil } from './init.ts';
import { issue } from './institutions.ts';
import { promulgate } from './levers.ts';
import { fond, forecastVote } from './parliament.ts';
import { PRESIDENTIELLE, presidentielle } from './presidentielle.ts';
import { endTurn } from './tick.ts';
import { monthIndex, type Bill, type BillSpec, type GameState, type Rapport, type Sieges, type TurnEvent } from './types.ts';

const spec = (tags: string[], extra: Partial<BillSpec> = {}): BillSpec => ({
  title: 'Loi test', summary: 'Résumé', articles: ['Article 1'], levers: [], qualitative: [], tags, prepMonths: 0, rampMonths: 0, estimatedCost: 0, ...extra,
});
const bill = (tags: string[], extra: Partial<BillSpec> = {}): Bill => ({ id: 'b', spec: spec(tags, extra), status: 'preparation', votes: [] });
const start = (mode: 'democratie' | 'decret' | 'bac_a_sable' = 'democratie', camp?: string) => engine.newGame({ seed: 3, mode, camp });
const rapport = (s: GameState, id: string) => s.parliament.assemblee.find((g) => g.groupId === id)!.rapport;
const demission = (s: GameState): GameState => ({ ...s, institutions: { ...s.institutions!, gouvernement: { ...s.institutions!.gouvernement, demissionnaire: true } } });
const avecRelations = (s: GameState, r: Record<string, number>): GameState => ({ ...s, relations: { ...engine.pouvoir(s).relations, ...r } });
const rapports = (ev: TurnEvent[]) => ev.filter((e): e is Extract<TurnEvent, { kind: 'rapport' }> => e.kind === 'rapport');
// Opposition au départ réel : plancher des camps choisis.
const OPP0 = politics.assemblee.groupes.filter((g) => g.rapport_gouvernement === 'opposition').reduce((a, g) => a + g.sieges, 0);

describe('relations et rapports (ENGINE.md §13)', () => {
  test('départ : relations = centres de bande, aucun champ nouveau dans l\'état', () => {
    const s = start(), p = engine.pouvoir(s);
    expect(s.parliament.assemblee).toHaveLength(12);
    for (const g of s.parliament.assemblee) expect(p.relations[g.groupId]).toBe(REL0[g.rapport]);
    expect(politics.senat.groupes).toHaveLength(9);
    for (const g of politics.senat.groupes) expect(p.relations[`senat_${g.id}`]).toBe(REL0[g.rapport_gouvernement as Rapport]);
    expect(Object.keys(p.relations)).toHaveLength(21);
    for (const k of ['relations', 'camp', 'senat']) expect(k in s).toBe(false);
    expect(Object.keys(s.internals).filter((k) => /rel|camp|senat/.test(k))).toEqual([]);
    expect(p.joueur).toBe('horizons');
    expect(p.campAutre).toBe(false);
    expect(p.senat.map((g) => g.rapport)).toEqual(politics.senat.groupes.map((g) => g.rapport_gouvernement));
  });

  test('centres de bande à l\'intérieur de leur bande : un état sans relations garde ses rapports', () => {
    for (const r of ['opposition', 'soutien_conditionnel', 'majorite'] as Rapport[]) {
      expect(seuil(REL0[r], r)).toBe(r);
      expect(dansBande(REL0[r], r)).toBe(REL0[r]);
    }
  });

  test('fond : position Jev si présente, sinon produit scalaire ; votes identiques à main', () => {
    const b = bill(['retraites_durcissement', 'austerite_depenses']);
    expect(fond(b, 'assemblee', 'soc')).toBeCloseTo(-0.1, 9); // (0,7 ; 0,05 ; 0,2) · (−0,33 ; −0,46 ; 0,77)
    expect(fond(bill(['redistribution'], { positions: { assemblee_soc: -0.4 } }), 'assemblee', 'soc')).toBe(-0.4);
    expect(fond(bill(['redistribution'], { positions: { assemblee_soc: -0.4 } }), 'senat', 'ser')).not.toBe(-0.4);
    // Instantanés pris sur main avant la refactorisation (seed 1, état neuf).
    const s = engine.newGame({ seed: 1, mode: 'democratie' });
    const r = forecastVote(s, b, 'assemblee'), l = forecastVote(s, bill(['relance_depenses', 'services_publics']), 'assemblee');
    expect(r.probabiliteAdoption).toBe(0.053);
    expect(r.pour).toBeCloseTo(158.874, 6);
    expect(forecastVote(s, b, 'senat').probabiliteAdoption).toBe(0.703);
    expect(l.probabiliteAdoption).toBe(0.979);
    expect(l.contre).toBeCloseTo(98.658, 6);
  });

  test('ancienne sauvegarde : sans relations = relations REL0 explicites', () => {
    let s = start();
    for (let i = 0; i < 3; i++) s = engine.endTurn(s).state;
    const sans = { ...s, relations: undefined };
    const avec = { ...s, relations: Object.fromEntries([
      ...s.parliament.assemblee.map((g) => [g.groupId, REL0[g.rapport]]),
      ...politics.senat.groupes.map((g) => [`senat_${g.id}`, REL0[g.rapport_gouvernement as Rapport]]),
    ]) };
    const a = engine.endTurn(sans).state, b = engine.endTurn(avec).state;
    expect(a.parliament).toEqual(b.parliament);
    expect(a.national).toEqual(b.national);
    expect(a.rng).toBe(b.rng);
  });

  test('hystérésis : seuils de montée et de descente, un cran par mois', () => {
    const tick = (r: Record<string, number>) => engine.endTurn(avecRelations(start(), r));
    expect(rapport(tick({ soc: -0.25 }).state, 'soc')).toBe('soutien_conditionnel');
    const bas = tick({ soc: -0.35 });
    expect(rapport(bas.state, 'soc')).toBe('opposition');
    expect(bas.report.events).toContainEqual({ kind: 'rapport', chambre: 'assemblee', groupId: 'soc', avant: 'soutien_conditionnel', apres: 'opposition' });
    expect(rapport(tick({ rn: -0.15 }).state, 'rn')).toBe('opposition');
    expect(rapport(tick({ rn: -0.05 }).state, 'rn')).toBe('soutien_conditionnel');
    expect(rapport(tick({ epr: -1 }).state, 'epr')).toBe('soutien_conditionnel');
    expect(seuil(-1, 'majorite')).toBe('soutien_conditionnel');
  });

  test('lois rejetées par un groupe (positions Jev) : bascule au bout de quelques mois, sans retour', () => {
    let s = start('decret');
    const ev: TurnEvent[] = [];
    let mois = 0;
    // redistribution plaît à SOC par les tags : la position Jev prime.
    while (rapport(s, 'soc') === 'soutien_conditionnel' && mois < 8) {
      s = engine.addDraft(s, spec(['redistribution'], { positions: { assemblee_soc: -1 } }));
      s = engine.deposit(s, s.bills.at(-1)!.id);
      const r = engine.endTurn(s);
      s = r.state; ev.push(...r.report.events); mois++;
      if (mois === 1) expect(rapports(r.report.events).filter((e) => e.groupId === 'soc')).toEqual([]); // une loi isolée ne suffit pas
    }
    expect(rapport(s, 'soc')).toBe('opposition');
    expect(mois).toBeGreaterThan(1);
    expect(mois).toBeLessThanOrEqual(4);
    expect(ev).toContainEqual(expect.objectContaining({ kind: 'rapport', groupId: 'soc', apres: 'opposition' }));
    expect(rapport(engine.endTurn(s).state, 'soc')).toBe('opposition');
  });

  test('une loi isolée ne fait basculer aucun groupe', () => {
    for (const tags of [['retraites_durcissement', 'austerite_depenses'], ['redistribution'], ['immigration_restriction']]) {
      let s = engine.addDraft(start('decret'), spec(tags));
      s = engine.deposit(s, s.bills[0].id);
      const ev: TurnEvent[] = [];
      for (let i = 0; i < 12; i++) { const r = engine.endTurn(s); s = r.state; ev.push(...r.report.events); }
      expect(rapports(ev)).toEqual([]);
    }
  });

  test('49.3 : malus pour les groupes hors majorité opposés au texte, seulement eux', () => {
    const s0 = engine.addDraft(start(), spec(['austerite_depenses', 'fiscalite_hausse']));
    promulgate(s0, s0.bills[0], monthIndex(s0.date));
    const s1 = structuredClone(s0);
    s1.bills[0].usage493 = true;
    const a = engine.pouvoir(engine.endTurn(s0).state).relations, b = engine.pouvoir(engine.endTurn(s1).state).relations;
    let touches = 0;
    for (const g of s0.parliament.assemblee) {
      const f = fond(s0.bills[0], 'assemblee', g.groupId);
      if (g.rapport !== 'majorite' && f < 0) { expect(a[g.groupId] - b[g.groupId]).toBeCloseTo(C.parlement_relation_493, 9); touches++; }
      else expect(b[g.groupId]).toBe(a[g.groupId]);
    }
    expect(touches).toBeGreaterThan(0);
    for (const g of politics.senat.groupes) expect(b[`senat_${g.id}`]).toBe(a[`senat_${g.id}`]);
  });

  test('cohabitation : rapports de l\'Assemblée figés, relations et Sénat mobiles', () => {
    let s = start();
    s = { ...s, institutions: { ...s.institutions!, gouvernement: { profil: 'cohabitation', coalition: 'union_gauche', depuis: s.date, demissionnaire: false } } };
    const r = engine.endTurn(avecRelations(s, { soc: -0.9, senat_lr: -0.9 }));
    const p = engine.pouvoir(r.state);
    expect(rapport(r.state, 'soc')).toBe('soutien_conditionnel');
    expect(p.relations.soc).toBeLessThan(-0.8);
    expect(r.state.senat).toEqual({ lr: 'opposition' });
    expect(p.senat.find((g) => g.groupId === 'lr')!.rapport).toBe('opposition');
    expect(r.report.events).toContainEqual({ kind: 'rapport', chambre: 'senat', groupId: 'lr', avant: 'soutien_conditionnel', apres: 'opposition' });
    expect(rapports(r.report.events)).toHaveLength(1);
  });

  test('nomination : rapports du profil, mémoire des griefs, coût de rupture, pas de rebascule', () => {
    const s = demission(start());
    const cp = engine.nominate(s, 'camp_presidentiel').state;
    expect(rapport(cp, 'soc')).toBe('opposition');
    expect(engine.pouvoir(cp).relations.soc).toBeCloseTo(-0.7, 9);
    const og = engine.nominate(s, 'ouverture_gauche').state;
    expect(rapport(og, 'soc')).toBe('majorite');
    expect(engine.pouvoir(og).relations.soc).toBeCloseTo(0.6, 9);
    expect(engine.pouvoir(og).relations.epr).toBeCloseTo(0.6, 9); // sans camp choisi : pas de fidélité
    for (const p of ['camp_presidentiel', 'ouverture_gauche', 'ouverture_droite', 'technicien'] as const)
      expect(rapports(engine.endTurn(engine.nominate(s, p).state).report.events)).toEqual([]);
    const grief = engine.nominate(avecRelations(s, { soc: -0.2 }), 'ouverture_gauche').state;
    expect(engine.pouvoir(grief).relations.soc).toBeCloseTo(0.6 + 0.5 * (-0.2 - 0.1), 9);
    expect(engine.nominate(start(), 'technicien').state).toEqual(start()); // contrat inchangé : seulement si démissionnaire
  });

  test('garde : le coût de rupture ne fait jamais rebasculer un groupe', () => {
    expect(C.parlement_relation_cout_rupture).toBeLessThan(REL0.soutien_conditionnel - (C.parlement_relation_seuil_soutien - C.parlement_relation_hysteresis));
    expect(REL0.majorite - C.parlement_relation_fidelite).toBeGreaterThan(C.parlement_relation_seuil_majorite - C.parlement_relation_hysteresis);
  });

  test('dissolution : choc pour les groupes hors opposition, Sénat intact', () => {
    const s = start(), avant = engine.pouvoir(s).relations, d = engine.dissolve(s).state, apres = engine.pouvoir(d).relations;
    for (const g of s.parliament.assemblee)
      expect(apres[g.groupId]).toBeCloseTo(avant[g.groupId] - (g.rapport !== 'opposition' ? C.parlement_relation_dissolution : 0), 9);
    for (const g of politics.senat.groupes) expect(apres[`senat_${g.id}`]).toBe(avant[`senat_${g.id}`]);
  });

  test('déterminisme : prévisualisation stable, aucun tirage ajouté', () => {
    const s = start();
    expect(endTurn(s, { aleatoire: false })).toEqual(endTurn(s, { aleatoire: false }));
    const sp = spec(['retraites_durcissement'], { prepMonths: 1 });
    expect(engine.previewBill(s, sp, 12)).toEqual(engine.previewBill(s, sp, 12));
    // rng et rapports après 24 mois sans loi : instantané pris sur main avant l'étape 7b.
    let x = engine.newGame({ seed: 1, mode: 'democratie' });
    for (let i = 0; i < 24; i++) x = engine.endTurn(x).state;
    expect(x.rng).toBe(-447588378);
    expect(x.national.stabilite).toBe(0.2748162118042276);
  });
});

describe('choix du camp (ENGINE.md §13)', () => {
  const assise = (camp: string) => engine.pouvoir(start('decret', camp)).assise;

  test('ignoré en Réaliste', () => {
    expect(engine.newGame({ seed: 5, mode: 'democratie', camp: 'rn' })).toEqual(engine.newGame({ seed: 5, mode: 'democratie' }));
    expect('camp' in engine.newGame({ seed: 5, mode: 'decret', camp: 'inconnu' })).toBe(false);
  });

  test('camp RN : coalition minoritaire, PM fictif, joueur RN, majorité présidentielle [rn, droite]', () => {
    const s = start('decret', 'rn'), p = engine.pouvoir(s);
    for (const id of ['rn', 'udr']) expect(rapport(s, id)).toBe('majorite');
    for (const id of ['dr', 'liot', 'ni']) expect(rapport(s, id)).toBe('soutien_conditionnel');
    expect(rapport(s, 'epr')).toBe('opposition');
    expect(p.assise.opposition).toBeGreaterThanOrEqual(OPP0);
    expect(p.joueur).toBe('rn');
    expect(p.campAutre).toBe(true);
    expect(p.gouvernement.premierMinistre).toBeUndefined();
    expect(p.gouvernement.profil).toBe('camp_presidentiel');
    expect(p.positionnementInitial).toEqual(politics.parties.find((x) => x.id === 'rn')!.positionnement);
    const ev = presidentielle(structuredClone(s), monthIndex(PRESIDENTIELLE.tour1));
    expect(ev[0]).toMatchObject({ kind: 'presidentielle', joueur: 'rn' });
    const a = (x: Record<string, number>): Sieges => Object.entries(x).map(([groupId, sieges]) => ({ groupId, sieges }));
    expect(issue(a({ rn: 250, dr: 50, epr: 200 }), s)).toEqual({ issue: 'majorite' });
    expect(issue(a({ rn: 250, dr: 50, epr: 200 }))).toEqual({ issue: 'cohabitation', coalition: 'union_droites' });
    expect(issue(a({ epr: 250, dr: 50, rn: 240 }), s)).toEqual({ issue: 'majorite' }); // rn + dr ≥ 289
    expect(issue(a({ soc: 150, lfi_nfp: 150, rn: 200 }), s)).toEqual({ issue: 'cohabitation', coalition: 'union_gauche' });
  });

  test('camps PP, Écologistes, LR, LFI : assises de départ et plancher d\'opposition', () => {
    expect(assise('pp')).toEqual({ majorite: 107, soutien_conditionnel: 192, opposition: 276 });
    expect(assise('ecologistes')).toEqual(assise('pp'));
    expect(assise('lr')).toEqual({ majorite: 49, soutien_conditionnel: 208, opposition: 318 });
    expect(rapport(start('decret', 'lr'), 'rn')).toBe('opposition'); // plancher
    expect(assise('lfi').majorite).toBe(88);
    for (const c of ['pp', 'lr', 'lfi', 'rn']) expect(assise(c).opposition).toBeGreaterThanOrEqual(OPP0);
  });

  test('camp choisi : pas de choc de cohésion au départ, une nomination garde la règle du profil', () => {
    const rn = start('decret', 'rn'), base = start('decret');
    expect(engine.endTurn(rn).state.national.stabilite).toBeCloseTo(engine.endTurn(base).state.national.stabilite, 9);
    const og = engine.nominate(demission(rn), 'ouverture_gauche').state; // [rn, droite] en majorité
    expect(rapport(og, 'dr')).toBe('majorite');
    expect(engine.pouvoir(og).relations.rn).toBeCloseTo(REL0.majorite - C.parlement_relation_fidelite, 9); // le parti punit l'ouverture
  });

  test('camp Horizons : départ réel, fidélité de parti à l\'ouverture', () => {
    const h = start('decret', 'horizons'), base = start('decret');
    expect(h.parliament).toEqual(base.parliament);
    expect(engine.pouvoir(h).campAutre).toBe(false);
    expect(engine.endTurn(h).state.national).toEqual(engine.endTurn(base).state.national); // même coh0, même BLOC
    const og = engine.pouvoir(engine.nominate(demission(h), 'ouverture_gauche').state).relations;
    for (const id of ['epr', 'dem', 'hor']) expect(og[id]).toBeCloseTo(REL0.majorite - C.parlement_relation_fidelite, 9);
    expect(og.soc).toBeCloseTo(REL0.majorite, 9);
  });
});
