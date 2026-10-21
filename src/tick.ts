// Tick mensuel (ENGINE.md §1). Formules : descriptions de gamedata/coefficients.json ; normalisations : scripts/papersim.cjs.
import type { Danger, DefeatCause, GameState, RegionCode, SocialGroup, TurnEvent, TurnReport } from './types.ts';
import { monthIndex } from './types.ts';
import type { z } from 'zod';
import type { RandomEvents } from './schemas.ts';
import { C, CENTRAGE, INIT, LEVERS, budget, centralFactor, events, groups, inst, load, politics, randomEvents, regions, save } from './init.ts';
import type { Core, Fin } from './init.ts';
import { billGroups, promulgate, qualitativeEffect, sumEffects } from './levers.ts';
import { rand, voteBill } from './parliament.ts';
import { elections } from './institutions.ts';

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const ym = (d: { year: number; month: number }) => `${d.year}-${String(d.month).padStart(2, '0')}`;
const nextMonth = (d: { year: number; month: number }) => (d.month === 12 ? { year: d.year + 1, month: 1 } : { year: d.year, month: d.month + 1 });

// Élasticités conjoncturelles des recettes (semi_elasticite_solde_public : élasticités détaillées).
const EPS: Record<string, number> = { ir: C.elasticite_ir_csg, csg: C.elasticite_ir_csg, is: C.elasticite_is, cotisations_sociales: C.elasticite_cotisations };

// Constantes d'opinion
const OMEGA = (() => {
  const w = groups.map((g) => g.part_population_adulte.value * g.participation_electorale.value);
  const tot = w.reduce((a, b) => a + b, 0);
  return Object.fromEntries(groups.map((g, i) => [g.id, w[i] / tot])) as Record<SocialGroup, number>;
})();
const S0 = Object.fromEntries(groups.map((g) => [g.id, g.satisfaction_initiale.value])) as Record<SocialGroup, number>;
const POP_TOT = regions.reduce((a, r) => a + r.population.value, 0);
const PIB_TOT = regions.reduce((a, r) => a + r.pib_md.value, 0);
const TENSION_K = INIT.tension - regions.reduce((a, r) => a + r.population.value * r.tension_initiale.value, 0) / POP_TOT;
const seuilRegion = (t0: number) => Math.max(C.seuil_tension_greves, t0 + (C.seuil_tension_greves - INIT.tension));
const DISCIPLINE = new Map(politics.assemblee.groupes.map((g) => [g.id, g.discipline]));
const cohesion = (s: GameState) => Math.min(1, s.parliament.assemblee.reduce((a, g) =>
  a + g.sieges * (DISCIPLINE.get(g.groupId) ?? 0) * (g.rapport === 'majorite' ? 1 : g.rapport === 'soutien_conditionnel' ? 0.5 : 0), 0) / 289);
const COH0 = Math.min(1, politics.assemblee.groupes.reduce((a, g) =>
  a + g.sieges * g.discipline * (g.rapport_gouvernement === 'majorite' ? 1 : g.rapport_gouvernement === 'soutien_conditionnel' ? 0.5 : 0), 0) / 289);

// Vote : correspondance des partis de groups.json vers ceux du sondage, bloc gouvernemental.
const PARTI: Record<string, string> = { renaissance: 'horizons', modem: 'horizons', ps: 'pp' };
const BLOC = new Set([...politics.assemblee.groupes.filter((g) => g.rapport_gouvernement === 'majorite').flatMap((g) => g.parties), politics.president.party_id]
  .map((p) => PARTI[p] ?? p));
const VOTE_G = groups.map((g) => {
  const v: Record<string, number> = {};
  for (const r of g.vote.resultats) v[PARTI[r.party_id] ?? r.party_id] = (v[PARTI[r.party_id] ?? r.party_id] ?? 0) + r.pct;
  return { id: g.id as SocialGroup, v };
});
const V0 = Object.fromEntries(politics.intentions_vote.resultats.map((r) => [r.party_id, r.pct]));

const SMIC0 = LEVERS.get('travail.smic')!.valeur_initiale.value;
const POINT0 = LEVERS.get('fonction_publique.point_indice')!.valeur_initiale.value;
// Md€ 2026 par point de revalorisation : appliqué à l'écart cumulé de l'indice Pen sur le fil de l'eau (économie pérenne).
const PEN_MD = LEVERS.get('retraite.indexation_pensions')!.effets.find((f) => f.cible.kind === 'budget')!.elasticite;

// Indexation automatique du SMIC (smic_seuil_revalorisation_inflation) : facteur appliqué à l'indice S.
function indexSmic(c: Core, t: number, janvier: boolean): number {
  if (t === 0) return 1; // la revalorisation du 1er janvier 2026 est un fait (valeur initiale)
  const lnP2 = c.pH[10]; // indice du mois t-2, publié en t-1, effet au 1er du mois t
  const hausse = lnP2 - c.lnPsmic;
  if ((janvier && hausse > 0) || hausse >= Math.log(1 + C.smic_seuil_revalorisation_inflation / 100)) {
    c.S *= Math.exp(hausse);
    c.lnPsmic = lnP2;
    return Math.exp(hausse);
  }
  return 1;
}

// Événements aléatoires (ENGINE.md §5b) : probabilité du mois, 0 hors période, hors saison ou pendant le délai entre deux tirages.
// Typé par le schéma : les champs facultatifs (choix) ne figurent pas forcément dans le JSON.
const TEMPLATES = randomEvents as unknown as z.infer<typeof RandomEvents>;
type RandomEvent = (typeof TEMPLATES)[number];
function randomProba(s: GameState, e: RandomEvent, t: number): number {
  const [y, mo] = e.depuis.split('-').map(Number);
  const last = s.internals[`ev:${e.id}`];
  if (t < monthIndex({ year: y, month: mo }) || (e.mois && !e.mois.includes(s.date.month)) || (last !== undefined && t - last < e.delai_min_mois)) return 0;
  let p = e.proba_mensuelle;
  for (const c of e.conditions) {
    const v = c.variable.startsWith('groupe:') ? s.groups[c.variable.slice(7) as SocialGroup].satisfaction : s.national[c.variable as keyof GameState['national']];
    if (c.op === '>' ? v > c.seuil : v < c.seuil) p *= c.multiplicateur;
  }
  return Math.min(0.5, p);
}

// Fin de partie anticipée (ENGINE.md §10) : valeur observée, seuil, sens du franchissement.
const DEFAITES: { cause: DefeatCause; valeur: (s: GameState) => number; seuil: number; auDessus: boolean }[] = [
  { cause: 'dette', valeur: (s) => s.national.spread_oat_bund, seuil: C.defaite_spread_seuil, auDessus: true },
  { cause: 'regime', valeur: (s) => s.national.stabilite, seuil: C.defaite_stabilite_seuil, auDessus: false },
  { cause: 'soulevement', valeur: (s) => s.national.tension, seuil: C.defaite_tension_seuil, auDessus: true },
];
export const dangers = (s: GameState): Danger[] => DEFAITES.filter((d) => (s.internals[`def:${d.cause}`] ?? 0) > 0)
  .map((d) => ({ cause: d.cause, mois: s.internals[`def:${d.cause}`], limite: C.defaite_mois_consecutifs, valeur: d.valeur(s), seuil: d.seuil }));

type MacroIn = { O: number; Ol: number; L: number; imp: number; strike: number; ush: number; Ein: number };
// Un mois de macro (croissance, Okun, inflation, PIB nominal). O = offre totale (leviers, lois, événements), Ol = part des leviers, L = LFI 2026. Modifie c.
function stepMacro(c: Core, t: number, inp: MacroIn) {
  // Potentiel : transition linéaire de mi-2028 à mi-2029 (moyennes annuelles ≈ 1,2 % en 2028 et 1,0 % en 2029, PSMT).
  const g = C.croissance_potentielle + (C.croissance_potentielle_long_terme - C.croissance_potentielle) * clamp((t - 30) / 12);
  const Dd = c.Dd + C.multiplicateur_vitesse_ajustement * (inp.imp - c.Dd);
  // Grèves : perte du mois, rattrapée le mois suivant (en totalité au 1er mois d'un épisode).
  const perte = ((3 * Math.abs(C.greves_effet_croissance)) / 100) * inp.strike;
  const Gr = -perte - c.perm;
  c.perm += (1 - (c.sPrev > 0 ? C.greves_rattrapage_prolonge : C.greves_rattrapage)) * perte;
  c.sPrev = inp.strike;
  const dO = inp.O - c.O;
  const dlnY = g / 1200 + (Dd - c.Dd) + dO + (inp.L - c.L) + (Gr - c.Gr);
  Object.assign(c, { Dd, Gr, O: inp.O, L: inp.L });
  c.lnY += dlnY;
  c.lnYt += g / 1200;
  // Okun sur la croissance HORS effets d'offre des leviers (ENGINE.md §1) : les chocs des événements et des lois qualitatives
  // y passent, comme l'effet de la LFI 2026 (L, comme dans papersim).
  const dOl = c.Ol === undefined ? 0 : inp.Ol - c.Ol; // partie sauvegardée avant l'ajout de Ol : pas de correction ce mois-là
  c.Ol = inp.Ol;
  c.gH.push(1200 * (dlnY - dOl)); c.gH.shift();
  c.u += (-C.okun_coefficient * (mean(c.gH) - g)) / 12 + C.chomage_rappel_structurel * (C.chomage_structurel - c.u);
  const u = c.u + inp.ush;
  const ancre = C.cible_inflation_bce + C.pente_phillips * (C.chomage_structurel - u);
  c.lnP += c.pis / 1200 + (inp.Ein - c.Ein);
  c.Ein = inp.Ein;
  c.pis = ancre + C.inertie_inflation * (c.pis - ancre);
  const infl = 100 * (Math.exp(c.lnP - c.pH[0]) - 1);
  c.pH.push(c.lnP); c.pH.shift();
  c.yH.push(infl); c.yH.shift();
  c.lnW += mean(c.yH) / 1200;
  c.lnPd += (C.deflateur_pib_tendance + (infl - INIT.inflation)) / 1200;
  const croissance = 100 * (Math.exp(c.lnY - c.lnYH[0]) - 1);
  c.lnYH.push(c.lnY); c.lnYH.shift();
  const pibM = (budget.pib_reference_md / 12) * Math.exp(c.lnY + c.lnPd - CENTRAGE);
  c.pibH.push(pibM); c.pibH.shift();
  return {
    u, infl, croissance, pibM, pibA: c.pibH.reduce((a, b) => a + b, 0),
    central: Math.exp(c.lnYt + c.lnPd - CENTRAGE), gap: 100 * (Math.exp(c.lnY - c.lnYt) - 1),
  };
}

// Premier mardi d'octobre (LOLF, art. 39 : date limite de dépôt du PLF). Jour de la semaine par la méthode de Sakamoto.
export function premierMardiOctobre(y: number): number {
  const dow = (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + 6 + 1) % 7; // 1er octobre, 0 = dimanche
  return 1 + ((2 - dow + 7) % 7);
}

// Réponse à un dilemme (ENGINE.md §5c) : effets du choix à partir du mois t, dilemme levé. Modifie s.
export function applyChoice(s: GameState, choixId: string, t: number, parDefaut = false): TurnEvent[] {
  const d = s.dilemme;
  const c = d && TEMPLATES.find((e) => e.id === d.id)?.choix?.find((x) => x.id === choixId);
  if (!d || !c) return [];
  for (const f of c.effets) {
    const cible = f.cible.kind === 'region' && !f.cible.id ? { kind: 'region' as const, id: d.region } : f.cible;
    s.effects.push(qualitativeEffect(s, { kind: 'event', id: `${d.id}:${c.id}` }, cible as never, f.direction, f.magnitude as never, f.forme as 'niveau' | 'choc', t, 0, f.duree_mois));
  }
  delete s.dilemme;
  return [{ kind: 'choix', eventId: d.id, titre: d.titre, label: c.label, parDefaut }];
}

// opts.aleatoire = false : sans événement aléatoire (prévisualisation, ENGINE.md §8).
export function endTurn(prev: GameState, opts: { aleatoire?: boolean } = {}): { state: GameState; report: TurnReport } {
  const s = structuredClone(prev);
  const t = monthIndex(s.date);
  const out: TurnEvent[] = [];
  const avant = { ...s.national };
  const I = s.internals;

  // 0. Dilemme resté sans réponse : réponse par défaut (premier choix), avant tout nouveau tirage.
  if (s.dilemme) out.push(...applyChoice(s, s.dilemme.choix[0].id, t, true));

  // 1. Événements du mois
  for (const e of events) {
    if (e.date.slice(0, 7) !== ym(s.date) || s.firedEvents.includes(e.id)) continue;
    s.firedEvents.push(e.id);
    out.push({ kind: 'event', id: e.id, titre: e.titre, description: e.description, type: e.type as 'exogene' | 'echeance' });
    if (e.type !== 'exogene') continue;
    for (const f of e.effets) {
      s.effects.push(qualitativeEffect(s, { kind: 'event', id: e.id }, f.cible as never, f.direction, f.magnitude as never, f.forme as 'niveau' | 'choc', t, 0, f.duree_mois));
    }
  }

  // 1a. Calendrier budgétaire (ENGINE.md §5d) : rentrée budgétaire en septembre.
  if (s.date.month === 9 && s.date.year < 2030) {
    const y = s.date.year + 1;
    out.push({ kind: 'event', id: `rentree_budgetaire_${y}`, type: 'echeance', titre: `Le projet de loi de finances pour ${y} doit être déposé`,
      description: `Le PLF ${y} doit être déposé au Parlement au plus tard le mardi ${premierMardiOctobre(s.date.year)} octobre (LOLF, art. 39). `
        + `Le Parlement dispose ensuite de 70 jours pour l'adopter (Constitution, art. 47) : vote de l'Assemblée en novembre, adoption définitive en décembre. Sans loi de finances au 31 décembre, l'État fonctionne sous loi spéciale.` });
  }

  // 1b. Un événement aléatoire au plus : un tirage décide s'il y en a un et lequel (probabilités cumulées).
  if (opts.aleatoire !== false) {
    const cands = TEMPLATES.map((e) => ({ e, p: randomProba(s, e, t) })).filter((c) => c.p > 0);
    const tot = cands.reduce((a, c) => a + c.p, 0);
    let u: number;
    [u, s.rng] = rand(s.rng);
    u *= Math.max(1, tot); // au-delà de 1 : un événement chaque mois, proportionnellement aux probabilités
    const pick = cands.find((c) => (u -= c.p) < 0)?.e;
    if (pick) {
      I[`ev:${pick.id}`] = t;
      let code: RegionCode | undefined, titre = pick.titre;
      if (pick.region) {
        const w = regions.map((r) => (pick.region === 'population' ? r.population.value : s.regions[r.code as RegionCode].tension ** 2));
        let v: number;
        [v, s.rng] = rand(s.rng);
        v *= w.reduce((a, b) => a + b, 0);
        const r = regions[Math.max(0, w.findIndex((x) => (v -= x) < 0))];
        code = r.code as RegionCode;
        titre += ` (${r.name})`;
      }
      out.push({ kind: 'event', id: pick.id, titre, description: pick.description, type: 'aleatoire' });
      for (const f of pick.effets) {
        const cible = f.cible.kind === 'region' && !f.cible.id ? { kind: 'region' as const, id: code } : f.cible;
        s.effects.push(qualitativeEffect(s, { kind: 'event', id: pick.id }, cible as never, f.direction, f.magnitude as never, f.forme as 'niveau' | 'choc', t, 0, f.duree_mois));
      }
      if (pick.choix) {
        s.dilemme = { id: pick.id, titre, description: pick.description, region: code, choix: pick.choix.map(({ id, label, description }) => ({ id, label, description })) };
      }
    }
  }

  // 2. Lois arrivées au vote
  const dissoute = !!s.institutions?.dissolution;
  const elue = monthIndex(inst(s).legislatives); // seuls comptent les votes de l'Assemblée en place (textes caducs à la dissolution)
  for (const b of s.bills) {
    if (b.status !== 'preparation' || !b.voteLe || monthIndex(b.voteLe) !== t) continue;
    if (dissoute && s.mode === 'democratie') { b.voteLe = nextMonth(s.date); continue; } // Assemblée dissoute : examen reporté
    if (s.mode === 'democratie' && !b.votes.some((v) => v.chambre === 'assemblee' && v.adopte && monthIndex(v.date) >= elue)) {
      const an = voteBill(s, b, 'assemblee'); s.rng = an.rng;
      const se = voteBill(s, b, 'senat'); s.rng = se.rng;
      b.votes.push(an.result, se.result);
      out.push({ kind: 'vote', billId: b.id, result: an.result }, { kind: 'vote', billId: b.id, result: se.result });
      if (!an.result.adopte) { b.status = 'rejetee'; continue; }
      if (!se.result.adopte) { b.voteLe = nextMonth(s.date); continue; } // CMP simplifiée : dernier mot à l'Assemblée le mois suivant
    }
    promulgate(s, b, t);
    out.push({ kind: 'promulgation', billId: b.id });
  }
  if (dissoute) out.push(...elections(s, t)); // 2b. Législatives anticipées (ENGINE.md §11)

  // 2c. 31 décembre sans loi de finances pour l'année suivante : loi spéciale (ENGINE.md §5d).
  const lsId = `loi_speciale_${s.date.year + 1}`;
  if (s.date.month === 12 && s.date.year < 2030 && !s.firedEvents.includes(lsId)
    && !s.bills.some((b) => b.status === 'adoptee' && b.spec.loiDeFinances === s.date.year + 1)) {
    const y = s.date.year + 1, id = lsId;
    s.firedEvents.push(id);
    out.push({ kind: 'event', id, type: 'exogene', titre: `Pas de budget pour ${y} : l'État passe sous loi spéciale`,
      description: `Faute de loi de finances adoptée au 31 décembre, une loi spéciale autorise à lever l'impôt et à reconduire les crédits de ${y - 1}. Les marchés et les agences de notation s'inquiètent.` });
    for (const [cible, dir, duree] of [[{ kind: 'stabilite' }, -1, 6], [{ kind: 'prime_risque' }, 1, 6], [{ kind: 'popularite' }, -1, 3]] as const) {
      s.effects.push(qualitativeEffect(s, { kind: 'event', id }, cible as never, dir, 'faible', 'choc', t, 0, duree));
    }
  }

  // 3. Indexations automatiques (bougent reference, jamais delta)
  const x = load<Core>(I, 'x.'), rf = load<Core>(I, 'r.'), fin = load<Fin>(I, 'f.');
  const janvier = s.date.month === 1;
  const smic = s.levers['travail.smic'], pen = s.levers['retraite.indexation_pensions'];
  const fS = indexSmic(x, t, janvier);
  indexSmic(rf, t, janvier);
  if (fS !== 1) {
    const ancienne = smic.reference + smic.delta;
    smic.reference *= fS;
    out.push({ kind: 'indexation', leverId: 'travail.smic', ancienne, nouvelle: smic.reference + smic.delta });
  }
  if (janvier && t > 0) {
    // ponytail: moyenne des glissements des 12 derniers mois au lieu du ratio des moyennes d'indices (novembre)
    const auto = C.pensions_indexation_inflation * Math.max(0, mean(x.yH));
    const ancienne = pen.reference + pen.delta;
    pen.reference = auto;
    x.Pen *= 1 + (auto + pen.delta) / 100; // le joueur fixe l'écart à l'indexation automatique
    x.Prest *= 1 + auto / 100;
    const autoRef = C.pensions_indexation_inflation * Math.max(0, mean(rf.yH));
    rf.Pen *= 1 + autoRef / 100;
    rf.Prest *= 1 + autoRef / 100;
    out.push({ kind: 'indexation', leverId: 'retraite.indexation_pensions', ancienne, nouvelle: pen.reference + pen.delta });
  }

  // 4. Effets actifs
  s.effects = s.effects.filter((e) => e.duree === undefined || t < e.debut + e.duree);
  const scale = centralFactor(s);
  const E = sumEffects(s.effects, t, scale);
  const get = (k: string) => E[k] ?? 0;
  const pensions = PEN_MD * 100 * (x.Pen / rf.Pen - 1) * scale; // change au 1er janvier, avec l'indice
  const disc = (line: string) => get(`budget:${line}`) + (line === 'depenses.retraites' ? pensions : 0);

  // 5. Macro : impulsion discrétionnaire (multiplicateurs), offre O (dont LFI 2026), grèves du mois précédent.
  const pibPrev = x.pibH.reduce((a, b) => a + b, 0);
  let imp = 0;
  for (const k of Object.keys(budget.recettes)) imp -= C.multiplicateur_prelevements_court_terme * disc(`recettes.${k}`);
  for (const k of Object.keys(budget.depenses)) {
    if (k === 'interets_dette') continue;
    const m = k === 'aides_sociales' || k === 'defense' ? C.multiplicateur_depenses_ciblees : C.multiplicateur_depenses_court_terme;
    imp += m * disc(`depenses.${k}`);
  }
  const lfi = (C.impact_politique_budgetaire_2026 / 100) * Math.min(1, (t + 1) / 12);
  const Ol = (sumEffects(s.effects.filter((e) => e.source.kind === 'lever'), t, scale)['indicator:croissance_pib'] ?? 0) / 100;
  const m = stepMacro(x, t, { O: get('indicator:croissance_pib') / 100, Ol, L: lfi, imp: imp / pibPrev, strike: I.I, ush: get('indicator:chomage_bit'), Ein: get('indicator:inflation') / 100 });
  const mr = stepMacro(rf, t, { O: 0, Ol: 0, L: lfi, imp: 0, strike: 0, ush: 0, Ein: 0 });

  // 6. Finances publiques
  const rec: Record<string, number> = {}, dep: Record<string, number> = {};
  for (const [k, v] of Object.entries(budget.recettes)) rec[k] = v.value * m.central * (1 + ((EPS[k] ?? C.elasticite_tva_autres_po) * m.gap) / 100) + disc(`recettes.${k}`);
  for (const [k, v] of Object.entries(budget.depenses)) {
    if (k === 'interets_dette') continue;
    const eps = k === 'aides_sociales' ? C.part_chomage_aides_sociales * C.elasticite_depenses_chomage : 0;
    dep[k] = v.value * m.central * (1 + (eps * m.gap) / 100) + disc(`depenses.${k}`);
  }
  const iMarche = C.taux_reference_bund_initial + fin.spread / 100;
  const intM = (fin.r / 100) * fin.D / 12;
  dep.interets_dette = 12 * intM;
  const totRec = Object.values(rec).reduce((a, b) => a + b, 0), totDep = Object.values(dep).reduce((a, b) => a + b, 0);
  const dD = (totDep - totRec) / 12; // dette(t+1) = dette(t) - solde du mois
  const refi = C.part_dette_refinancee_mois * fin.D, Dn = fin.D + dD;
  fin.r = (fin.r * (fin.D - refi - Math.max(0, -dD)) + iMarche * (refi + Math.max(0, dD))) / Dn;
  fin.D = Dn;
  fin.defH.push((100 * dD * 12) / m.pibA); fin.defH.shift();
  const def12 = mean(fin.defH), dette = (100 * fin.D) / m.pibA;
  fin.spread = Math.max(0, C.spread_constante + C.spread_sensibilite_deficit * (def12 - INIT.deficit) + C.spread_sensibilite_dette * (dette - INIT.dette)
    + C.spread_sensibilite_stabilite * (INIT.stabilite - s.national.stabilite) + C.spread_non_lineaire_dette * Math.max(0, dette - 130) ** 2
    + C.spread_non_lineaire_deficit * Math.max(0, def12 - 6) ** 2
    + C.spread_degradation_note * get('notation') + get('prime_risque:'));
  s.budget = { recettes: rec, depenses: dep };

  // 7. Opinion : satisfaction (pouvoir d'achat relatif au fil de l'eau, emploi, effets group) → popularité → intentions
  const pt = s.levers['fonction_publique.point_indice'];
  const revenus = (c: Core, sIdx: number, point: number, pibA: number): Record<SocialGroup, number> => {
    const W = Math.exp(c.lnW);
    return {
      retraites: c.Pen, ouvriers_employes: 0.5 * sIdx + 0.5 * W, cadres: W, fonctionnaires: point, independants: pibA, agriculteurs: pibA,
      etudiants_jeunes: 0.5 * c.Prest + 0.5 * sIdx, chomeurs_inactifs: c.Prest,
    };
  };
  const rev = revenus(x, x.S + smic.delta / SMIC0, (pt.reference + pt.delta) / POINT0, m.pibA);
  const revRef = revenus(rf, rf.S, 1, mr.pibA);
  const prix = Math.exp(x.lnP - rf.lnP);
  // Lois impopulaires récentes (tension_lois_duree_mois) : mobilisation régionale (étape 8) et sanction dans la popularité.
  const recentes = s.bills.filter((b) => b.status === 'adoptee' && b.promulgueLe && t - monthIndex(b.promulgueLe) < C.tension_lois_duree_mois).map(billGroups);
  const contre = (parts: Record<string, number>) => {
    let l = 0;
    for (const bg of recentes) for (const e of bg) l += (parts[e.group] ?? 0) * Math.max(0, -e.direction) * C[`bareme.satisfaction.${e.intensite}`];
    return l;
  };
  let popCible = INIT.popularite - C.popularite_poids_lois_impopulaires * contre(OMEGA);
  for (const g of groups) {
    const id = g.id as SocialGroup;
    const pa = (100 * rev[id]) / revRef[id] / prix - 100;
    const cible = clamp(S0[id] + C.satisfaction_poids_pouvoir_achat * pa + C.satisfaction_poids_emploi * (mr.u - m.u) + get(`group:${id}:niveau`), 0.02, 0.98);
    I[`sl:${id}`] += C.satisfaction_amortissement * (cible - I[`sl:${id}`]);
    s.groups[id].satisfaction = clamp(I[`sl:${id}`] + get(`group:${id}:choc`));
    popCible += OMEGA[id] * (s.groups[id].satisfaction - S0[id]);
  }
  I.pl = C.popularite_inertie * I.pl + (1 - C.popularite_inertie) * popCible;
  const popularite = clamp(I.pl + get('popularite:'));

  const num: Record<string, number> = {}, den: Record<string, number> = {};
  for (const { id, v } of VOTE_G) {
    const d = s.groups[id].satisfaction - S0[id];
    let perdu = 0, autres = 0;
    for (const [p, x0] of Object.entries(v)) {
      if (BLOC.has(p)) perdu += x0 - x0 * Math.max(0, 1 + C.vote_sensibilite_satisfaction * d);
      else autres += x0;
    }
    for (const [p, x0] of Object.entries(v)) {
      const xs = BLOC.has(p) ? x0 * Math.max(0, 1 + C.vote_sensibilite_satisfaction * d) : x0 * (1 + perdu / autres);
      num[p] = (num[p] ?? 0) + OMEGA[id] * xs;
      den[p] = (den[p] ?? 0) + OMEGA[id] * x0;
    }
  }
  const cibleV = Object.fromEntries(Object.entries(V0).map(([p, v0]) => [p, v0 * (den[p] ? num[p] / den[p] : 1)]));
  const totV = Object.values(cibleV).reduce((a, b) => a + b, 0);
  for (const p of Object.keys(V0)) s.intentions[p] = C.vote_inertie * s.intentions[p] + (1 - C.vote_inertie) * (100 * cibleV[p]) / totV;

  // 8. Tension régionale (lois impopulaires sur tension_lois_duree_mois), grèves, stabilité
  const du = m.u - mr.u;
  let tNat = 0, intensite = 0;
  for (const r of regions) {
    const code = r.code as RegionCode, parts = r.composition_sociale.parts as Record<string, number>;
    let insat = 0;
    for (const g of groups) insat += parts[g.id] * (S0[g.id as SocialGroup] - s.groups[g.id as SocialGroup].satisfaction);
    const du_r = (du * r.chomage.value) / INIT.chomage; // l'écart de chômage se répartit au prorata du chômage régional
    const cible = r.tension_initiale.value + C.tension_poids_chomage * du_r + C.tension_poids_insatisfaction * insat + C.tension_poids_lois_impopulaires * contre(parts);
    I[`Tl:${code}`] = C.tension_inertie * I[`Tl:${code}`] + (1 - C.tension_inertie) * cible;
    const T = clamp(I[`Tl:${code}`] + get(`region:${code}`) + get('tension:'));
    const seuil = seuilRegion(r.tension_initiale.value);
    const greve = T >= seuil;
    if (greve && !s.regions[code].greve) out.push({ kind: 'greve', region: code, generale: false });
    s.regions[code] = { chomage: r.chomage.value + du_r, tension: T, greve };
    tNat += (r.population.value * T) / POP_TOT;
    intensite += (r.pib_md.value / PIB_TOT) * clamp((T - seuil) / (C.seuil_tension_greve_generale - C.seuil_tension_greves));
  }
  tNat = clamp(tNat + TENSION_K);
  const generale = tNat >= C.seuil_tension_greve_generale;
  if (generale && !I.gen) out.push({ kind: 'greve', region: String(C.greve_generale_region).padStart(2, '0') as RegionCode, generale: true });
  I.gen = generale ? 1 : 0;
  I.I = generale ? 1 : intensite;

  const sCible = INIT.stabilite - C.stabilite_poids_tension * (tNat - INIT.tension) + C.stabilite_poids_popularite * (popularite - INIT.popularite)
    - C.stabilite_poids_spread * (fin.spread - INIT.spread)
    + C.stabilite_poids_cohesion_majorite * clamp(cohesion(s) - COH0, -C.stabilite_cohesion_perte_max, C.stabilite_cohesion_gain_max);
  I.Sl = C.stabilite_inertie * I.Sl + (1 - C.stabilite_inertie) * sCible;
  const stabilite = clamp(I.Sl + get('stabilite:'));

  save(I, 'x.', x); save(I, 'r.', rf); save(I, 'f.', fin);
  const pibM12 = 12 * x.pibH[11];
  s.national = {
    croissance_pib: m.croissance, chomage_bit: m.u, inflation: m.infl, taux_pauvrete: INIT.pauvrete + get('indicator:taux_pauvrete'),
    pib_nominal: m.pibA, deficit_public: def12, dette_publique: dette, dette_publique_md: fin.D,
    taux_oat_10: C.taux_reference_bund_initial + fin.spread / 100, spread_oat_bund: fin.spread,
    prelevements_obligatoires: INIT.po + 100 * (totRec / pibM12 - INIT.recettes / budget.pib_reference_md),
    depense_publique: INIT.dp + 100 * (totDep / pibM12 - INIT.depenses / budget.pib_reference_md),
    population: s.national.population, popularite, tension: tNat, stabilite,
  };

  // 8b. Fin de partie anticipée : un seuil franchi defaite_mois_consecutifs mois de suite (alerte au premier mois).
  for (const d of DEFAITES) {
    const k = `def:${d.cause}`, v = d.valeur(s);
    I[k] = (d.auDessus ? v >= d.seuil : v <= d.seuil) ? (I[k] ?? 0) + 1 : 0;
    if (I[k] === 1) out.push({ kind: 'alerte', cause: d.cause, moisRestants: C.defaite_mois_consecutifs - 1 });
    if (I[k] >= C.defaite_mois_consecutifs && !s.defaite) {
      s.defaite = { cause: d.cause, date: { ...s.date } };
      out.push({ kind: 'defaite', cause: d.cause });
    }
  }

  // 9. Historique, mois suivant
  const date = { ...s.date };
  s.history.push({ date, national: { ...s.national }, intentions: { ...s.intentions } });
  s.date = nextMonth(s.date);
  return { state: s, report: { date, events: out, avant, apres: { ...s.national } } };
}
