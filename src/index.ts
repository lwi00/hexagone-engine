// Moteur Hexagone : assemble l'API Engine (types.ts). Toutes les fonctions sont pures (copie de l'état).
import { BillSpec, monthIndex, votesSimules } from './types.ts';
import type { Engine, GameState, Indicators, PreviewResult, RegionCode, SocialGroup, TurnEvent, YearMonth } from './types.ts';
import { BUDGET_LINES, DERIVED_INDICATORS, INDICATORS, REGION_CODES, SOCIAL_GROUPS } from './schemas.ts';
import { C, LEVERS, TAGS, inst, newGame } from './init.ts';
import { choisirCamp, dissolve, forecastCircuit, forecastLegislatives, nominate, pouvoir } from './institutions.ts';
import { MAX_QUALITATIVE, promulgate } from './levers.ts';
import { applyChoice, dangers, endTurn } from './tick.ts';
import { CANDIDATS, forecastPresidentielle } from './presidentielle.ts';
import { can493, forecastVote, isBudget, voteCensure } from './parliament.ts';
import { ASSIETTE, IMPOT, MODELE, cle, constitutionnel, defReforme, obstacleReforme, regles } from './reformes.ts';
import { poser, risqueConseil } from './conseil.ts';
import { bilan, isOver } from './bilan.ts';

function validateBill(state: GameState, spec: BillSpec, billId?: string): string[] {
  const parsed = BillSpec.safeParse(spec);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join('.')} : ${i.message}`);
  const errors: string[] = [];
  const supprimes = regles(state).supprimes.map((i) => IMPOT.get(i)!);
  for (const { id, delta } of spec.levers) {
    const def = LEVERS.get(id);
    if (!def) { errors.push(`levier inconnu : ${id}`); continue; }
    const sup = supprimes.find((i) => i.leviers.includes(id));
    if (sup) errors.push(`${id} : l'impôt ${sup.id} a été supprimé par la loi`);
    const v = state.levers[id].reference + state.levers[id].delta + delta;
    if (v < def.min || v > def.max) errors.push(`${id} : ${v} hors bornes [${def.min}, ${def.max}]`);
  }
  for (const tag of spec.tags) if (!TAGS.has(tag)) errors.push(`tag inconnu : ${tag}`);
  if (spec.qualitative.length > MAX_QUALITATIVE) errors.push(`au plus ${MAX_QUALITATIVE} effets qualitatifs`);
  const vues = new Set<string>();
  for (const { cible } of spec.qualitative) {
    // popularite, stabilite, tension : cibles nationales, id ignoré
    const id = ['popularite', 'stabilite', 'tension'].includes(cible.kind) ? '' : cible.id ?? '';
    const ok = cible.kind === 'indicator' ? (INDICATORS as readonly string[]).includes(id) && !(DERIVED_INDICATORS as readonly string[]).includes(id)
      : cible.kind === 'group' ? (SOCIAL_GROUPS as readonly string[]).includes(id)
      : cible.kind === 'region' ? (REGION_CODES as readonly string[]).includes(id)
      : cible.kind === 'budget' ? BUDGET_LINES.includes(id) && id !== 'depenses.interets_dette' // intérêts : calculés par le moteur
      : ['popularite', 'stabilite', 'tension'].includes(cible.kind); // lever : via spec.levers ; notation, prime_risque : réservés aux événements
    if (!ok) errors.push(`cible qualitative invalide : ${cible.kind}${id ? `:${id}` : ''}`);
    const key = `${cible.kind}:${id}`;
    if (vues.has(key)) errors.push(`cible qualitative en double : ${key}`);
    vues.add(key);
  }
  const r = spec.reforme; // réforme de structure (ENGINE.md §14)
  if (r) {
    if (r.modele === 'creer_impot') {
      const a = ASSIETTE.get(r.assiette)!;
      if (r.taux < a.taux_min || r.taux > a.taux_max) errors.push(`reforme.taux : ${r.taux} hors bornes [${a.taux_min}, ${a.taux_max}] pour ${r.assiette} (${a.unite})`);
    }
    const tags = defReforme(r).tags_requis;
    if (tags.length && !tags.some((t) => spec.tags.includes(t))) errors.push(`reforme ${cle(r)} : ajoute l'un des tags ${tags.join(', ')}`);
    if (constitutionnel(spec) && (spec.levers.length || spec.qualitative.length || spec.loiDeFinances !== undefined))
      errors.push('une révision constitutionnelle ne contient ni levier, ni effet qualitatif, ni loi de finances');
    if (r.modele === 'supprimer_impot') for (const { id } of spec.levers)
      if (IMPOT.get(r.impot)!.leviers.includes(id)) errors.push(`levier ${id} incompatible avec la suppression de ${r.impot}`);
    const o = obstacleReforme(state, spec, billId); // billId : projet amendé, pas son propre doublon
    if (o) errors.push(o);
  }
  return errors;
}

function addDraft(state: GameState, spec: BillSpec): GameState {
  const s = structuredClone(state);
  // Dernier numéro attribué gardé dans internals : les projets retirés sont supprimés en fin de mois, un id n'est jamais réutilisé.
  const n = Math.max(s.internals['loi:dernier'] ?? 0, ...s.bills.map((b) => Number(/^loi-(\d+)$/.exec(b.id)?.[1] ?? 0)));
  s.internals['loi:dernier'] = n + 1;
  s.bills.push({ id: `loi-${n + 1}`, spec: structuredClone(spec), status: 'brouillon', votes: [] });
  return s;
}

// Un dépôt par mois (ENGINE.md §1) ; les lois de finances n'entrent pas dans ce compte (calendrier budgétaire, §5d).
const sameMonth = (a: YearMonth | undefined, b: YearMonth) => !!a && a.year === b.year && a.month === b.month;
// Une réforme compte comme le dépôt du mois ; son doublon est refusé dans tous les modes (§14).
function canDeposit(state: GameState, spec: BillSpec): boolean {
  return !obstacleReforme(state, spec) && (state.mode === 'bac_a_sable' || spec.loiDeFinances !== undefined
    || !state.bills.some((x) => x.spec.loiDeFinances === undefined && sameMonth(x.deposeLe, state.date)));
}

function deposit(state: GameState, billId: string, voie?: 'congres' | 'referendum'): GameState {
  const s = structuredClone(state);
  const b = s.bills.find((x) => x.id === billId);
  if (!b || b.status !== 'brouillon' || inst(s).gouvernement.demissionnaire) return state; // gouvernement démissionnaire : ENGINE.md §11
  if (!canDeposit(s, b.spec)) return state;
  const m = monthIndex(s.date) + b.spec.prepMonths;
  b.status = 'preparation';
  b.deposeLe = { ...s.date };
  b.voteLe = { year: 2026 + Math.floor(m / 12), month: (m % 12) + 1 };
  // Révision constitutionnelle hors décret (§14) : voie choisie parmi celles du modèle, la première par défaut.
  const voies = b.spec.reforme ? MODELE.get(b.spec.reforme.modele)!.voies : [];
  if (voies.length && votesSimules(s.mode)) b.voie = voie && voies.includes(voie) ? voie : voies[0];
  return s;
}

// Amendement : nouveau texte pour un projet en brouillon ou en préparation. Un projet déposé garde sa date de vote.
function amend(state: GameState, billId: string, spec: BillSpec): GameState {
  const s = structuredClone(state);
  const b = s.bills.find((x) => x.id === billId);
  if (!b || (b.status !== 'brouillon' && b.status !== 'preparation')) return state;
  if (b.saisine && !b.saisine.issue) return state; // texte voté, devant le Conseil constitutionnel (§15)
  // Réforme déposée (§14) : ni changement de modèle ou de circuit en cours de route, ni amendement après le premier vote.
  if (b.status === 'preparation' && (b.spec.reforme || spec.reforme)
    && (b.votes.length > 0 || (b.spec.reforme && cle(b.spec.reforme)) !== (spec.reforme && cle(spec.reforme)))) return state;
  b.spec = spec;
  return s;
}

function withdraw(state: GameState, billId: string): GameState {
  const s = structuredClone(state);
  const b = s.bills.find((x) => x.id === billId);
  if (!b || (b.status !== 'brouillon' && b.status !== 'preparation')) return state;
  if (b.saisine && !b.saisine.issue) return state; // texte voté, devant le Conseil constitutionnel (§15)
  b.status = 'retiree';
  return s;
}

function use493(state: GameState, billId: string): { state: GameState; events: TurnEvent[] } {
  const s = structuredClone(state);
  const b = s.bills.find((x) => x.id === billId);
  if (!b || b.status !== 'rejetee' || !can493(s, b)) return { state, events: [] };
  const t = monthIndex(s.date);
  const { result, rng } = voteCensure(s, b);
  s.rng = rng;
  b.votes.push(result);
  b.usage493 = true;
  if (!isBudget(b)) s.parliament.usages493.push(s.date.year);
  const events: TurnEvent[] = [{ kind: 'vote', billId, result }, { kind: 'censure', billId, adoptee: result.adopte }];
  if (result.adopte) {
    b.status = 'censuree';
    s.institutions = { ...inst(s), gouvernement: { ...inst(s).gouvernement, demissionnaire: true } }; // nomination obligatoire (§11)
    s.effects.push({ source: { kind: 'bill', id: b.id }, cible: { kind: 'stabilite' }, amplitude: C.censure_choc_stabilite, forme: 'choc', debut: t, rampe: 0, duree: C.censure_duree_choc_mois });
  } else if (!poser(s, b, events)) { // saisine quasi systématique après un 49.3 (seuil 0, §15)
    promulgate(s, b, t);
    events.push({ kind: 'promulgation', billId });
  }
  return { state: s, events };
}

// Prévisualisation (types.ts) : deux simulations depuis une copie de l'état, sans la loi et avec la loi adoptée sans vote
// au mois date + prepMonths (comme en mode décret). Les autres lois et les événements programmés suivent les mêmes règles
// des deux côtés : l'écart mesure l'effet de la loi (interactions comprises, ex. une loi qui change la popularité avant un vote).
function previewBill(state: GameState, spec: BillSpec, months: number): PreviewResult {
  const t0 = monthIndex(state.date);
  // Horizon compté depuis l'adoption (date + prepMonths), borné à la fin de la partie.
  // Révision constitutionnelle : adoption au mois du Congrès (un mois après les chambres) ; un référendum viendrait plus tard (§14).
  const delai = spec.prepMonths + (constitutionnel(spec) && votesSimules(state.mode) ? 1 : 0); // décret : pas de Congrès
  const n = Math.max(0, Math.min(60 - t0, delai + Math.max(6, Math.min(60, Math.round(months)))));
  const tVote = t0 + delai;
  // L'historique n'est pas lu par le tick : on le vide pour accélérer les copies.
  let sans: GameState = { ...state, history: [] };
  let avec = addDraft(sans, spec);
  const draft = avec.bills.length - 1; // par position : le brouillon ajouté reste le dernier
  const id = avec.bills[draft].id;
  const dates: YearMonth[] = [], trajSans: Indicators[] = [], trajAvec: Indicators[] = [];
  for (let i = 0; i < n; i++) {
    if (monthIndex(avec.date) === tVote) {
      avec = structuredClone(avec);
      promulgate(avec, avec.bills[draft], tVote);
    }
    const a = endTurn(avec, { aleatoire: false }), b = endTurn(sans, { aleatoire: false });
    avec = a.state; sans = b.state;
    dates.push(b.report.date); trajSans.push(sans.national); trajAvec.push(avec.national);
  }
  const ecart = Object.fromEntries(Object.keys(sans.national).map((k) =>
    [k, avec.national[k as keyof Indicators] - sans.national[k as keyof Indicators]]));
  const budget: PreviewResult['budget'] = [];
  for (const cote of ['recettes', 'depenses'] as const) {
    for (const k of new Set([...Object.keys(sans.budget[cote]), ...Object.keys(avec.budget[cote])])) { // + impôts créés (§14)
      const e = (avec.budget[cote][k] ?? 0) - (sans.budget[cote][k] ?? 0);
      if (Math.abs(e) > 1e-9) budget.push({ ligne: `${cote}.${k}`, ecart: e });
    }
  }
  budget.sort((x, y) => Math.abs(y.ecart) - Math.abs(x.ecart));
  const bill = { id, spec, status: 'preparation' as const, votes: [] };
  const votes = state.mode !== 'decret' && !inst(state).dissolution;
  const vote = votes ? [forecastVote(state, bill, 'assemblee'), forecastVote(state, bill, 'senat')] : [];
  // Conseil constitutionnel (§15) : saisine et censure probables, 49.3 supposé si l'Assemblée rejetterait probablement le texte.
  // La trajectoire « avec » reste celle d'une loi promulguée sans saisine au mois tVote.
  const rc = votes && !constitutionnel(spec) ? risqueConseil(state, { ...bill, usage493: vote[0].probabiliteAdoption < 0.5 && can493(state, bill) }) : null;
  let legislatives: PreviewResult['legislatives'];
  if (spec.reforme?.modele === 'proportionnelle') {
    const r = addDraft(state, spec);
    Object.assign(r.bills.at(-1)!, { status: 'adoptee', promulgueLe: state.date });
    legislatives = { sans: forecastLegislatives(state), avec: forecastLegislatives(r) };
  }
  return {
    months: n, dates, sans: trajSans, avec: trajAvec, ecart, budget,
    groupes: Object.keys(sans.groups).map((g) => ({ group: g as SocialGroup, ecart: avec.groups[g as SocialGroup].satisfaction - sans.groups[g as SocialGroup].satisfaction })),
    regions: Object.keys(sans.regions).map((r) => {
      const c = r as RegionCode;
      return { region: c, tension: avec.regions[c].tension - sans.regions[c].tension, chomage: avec.regions[c].chomage - sans.regions[c].chomage };
    }),
    intentions: Object.keys(sans.intentions).map((p) => ({ partyId: p, ecart: avec.intentions[p] - sans.intentions[p] })),
    // Assemblée dissoute : le texte sera voté par l'Assemblée élue à la fin du mois, aucune prévision.
    vote,
    ...(rc && { conseil: { ...rc, articles: rc.articles.map(({ label, motif, p }) => ({ label, motif, p })) } }),
    ...(votes && constitutionnel(spec) && { circuit: forecastCircuit(state, bill) }),
    ...(legislatives && { legislatives }),
  };
}

function choose(state: GameState, choixId: string): { state: GameState; events: TurnEvent[] } {
  const s = structuredClone(state);
  const events = applyChoice(s, choixId, monthIndex(s.date));
  return events.length ? { state: s, events } : { state, events: [] };
}

export const engine: Engine = {
  // Camp (ENGINE.md §13) : parti des intentions de vote, ignoré en Réaliste (ici plutôt que dans init.ts : pas de cycle init ↔ institutions).
  newGame: ({ seed, mode, camp }) => {
    const s = newGame({ seed, mode });
    return camp && mode !== 'democratie' && CANDIDATS.includes(camp) ? choisirCamp(s, camp) : s;
  },
  choose, canDeposit, amend, forecastPresidentielle, validateBill, addDraft, deposit, withdraw, use493, previewBill, dangers, pouvoir, dissolve, nominate, forecastLegislatives,
  endTurn: (state) => endTurn(state),
  isOver, bilan, // fin de partie et score de fin de mandat (§16)
};
