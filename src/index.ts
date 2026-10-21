// Moteur Hexagone : assemble l'API Engine (types.ts). Toutes les fonctions sont pures (copie de l'état).
import { BillSpec, monthIndex } from './types.ts';
import type { Engine, GameState, Indicators, PreviewResult, RegionCode, SocialGroup, TurnEvent, YearMonth } from './types.ts';
import { BUDGET_LINES, DERIVED_INDICATORS, INDICATORS, REGION_CODES, SOCIAL_GROUPS } from './schemas.ts';
import { C, LEVERS, TAGS, inst, newGame } from './init.ts';
import { dissolve, forecastLegislatives, nominate, pouvoir } from './institutions.ts';
import { MAX_QUALITATIVE, promulgate } from './levers.ts';
import { applyChoice, dangers, endTurn } from './tick.ts';
import { can493, forecastVote, isBudget, voteCensure } from './parliament.ts';

function validateBill(state: GameState, spec: BillSpec): string[] {
  const parsed = BillSpec.safeParse(spec);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join('.')} : ${i.message}`);
  const errors: string[] = [];
  for (const { id, delta } of spec.levers) {
    const def = LEVERS.get(id);
    if (!def) { errors.push(`levier inconnu : ${id}`); continue; }
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
  return errors;
}

function addDraft(state: GameState, spec: BillSpec): GameState {
  const s = structuredClone(state);
  // max + 1 plutôt que length + 1 : id unique même si une loi a été retirée de la liste (ex. prévisualisation).
  const n = Math.max(0, ...s.bills.map((b) => Number(/^loi-(\d+)$/.exec(b.id)?.[1] ?? 0)));
  s.bills.push({ id: `loi-${n + 1}`, spec: structuredClone(spec), status: 'brouillon', votes: [] });
  return s;
}

function deposit(state: GameState, billId: string): GameState {
  const s = structuredClone(state);
  const b = s.bills.find((x) => x.id === billId);
  if (!b || b.status !== 'brouillon' || inst(s).gouvernement.demissionnaire) return state; // gouvernement démissionnaire : ENGINE.md §11
  const m = monthIndex(s.date) + b.spec.prepMonths;
  b.status = 'preparation';
  b.deposeLe = { ...s.date };
  b.voteLe = { year: 2026 + Math.floor(m / 12), month: (m % 12) + 1 };
  return s;
}

function withdraw(state: GameState, billId: string): GameState {
  const s = structuredClone(state);
  const b = s.bills.find((x) => x.id === billId);
  if (!b || (b.status !== 'brouillon' && b.status !== 'preparation')) return state;
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
  } else {
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
  const n = Math.max(0, Math.min(60 - t0, spec.prepMonths + Math.max(6, Math.min(60, Math.round(months)))));
  const tVote = t0 + spec.prepMonths;
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
    for (const k of Object.keys(sans.budget[cote])) {
      const e = avec.budget[cote][k] - sans.budget[cote][k];
      if (Math.abs(e) > 1e-9) budget.push({ ligne: `${cote}.${k}`, ecart: e });
    }
  }
  budget.sort((x, y) => Math.abs(y.ecart) - Math.abs(x.ecart));
  const bill = { id, spec, status: 'preparation' as const, votes: [] };
  return {
    months: n, dates, sans: trajSans, avec: trajAvec, ecart, budget,
    groupes: Object.keys(sans.groups).map((g) => ({ group: g as SocialGroup, ecart: avec.groups[g as SocialGroup].satisfaction - sans.groups[g as SocialGroup].satisfaction })),
    regions: Object.keys(sans.regions).map((r) => {
      const c = r as RegionCode;
      return { region: c, tension: avec.regions[c].tension - sans.regions[c].tension, chomage: avec.regions[c].chomage - sans.regions[c].chomage };
    }),
    intentions: Object.keys(sans.intentions).map((p) => ({ partyId: p, ecart: avec.intentions[p] - sans.intentions[p] })),
    // Assemblée dissoute : le texte sera voté par l'Assemblée élue à la fin du mois, aucune prévision.
    vote: state.mode === 'decret' || inst(state).dissolution ? [] : [forecastVote(state, bill, 'assemblee'), forecastVote(state, bill, 'senat')],
  };
}

function choose(state: GameState, choixId: string): { state: GameState; events: TurnEvent[] } {
  const s = structuredClone(state);
  const events = applyChoice(s, choixId, monthIndex(s.date));
  return events.length ? { state: s, events } : { state, events: [] };
}

export const engine: Engine = {
  newGame, choose, validateBill, addDraft, deposit, withdraw, use493, previewBill, dangers, pouvoir, dissolve, nominate, forecastLegislatives,
  endTurn: (state) => endTurn(state),
  isOver: (state) => monthIndex(state.date) >= 60 || !!state.defaite,
};
