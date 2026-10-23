// Score et bilan de fin de mandat (ENGINE.md §16). Pur : aucun tirage, aucune écriture. Lit l'état final (ou courant :
// bilan provisoire), l'historique mensuel et deux compteurs d'internals (n:dissolutions, pres:reelu).
import type { Bilan, DefeatCause, GameState, YearMonth } from './types.ts';
import { monthIndex } from './types.ts';
import { C, groups, inst, newGame } from './init.ts';
import { describeReforme } from './reformes.ts';

export const isOver = (s: GameState) => monthIndex(s.date) >= 60 || !!s.defaite;

// Référence : le national de janvier 2026 ne dépend ni de la graine ni du camp (calculé une fois).
let N0: GameState['national'] | undefined;
const depart = () => (N0 ??= newGame({ seed: 1, mode: 'democratie' }).national);
const moyenne = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const SAT0 = moyenne(groups.map((g) => g.satisfaction_initiale.value));
const clamp = (x: number) => Math.max(0, Math.min(100, x));

// Format français, sans dépendre de l'interface.
const n = (x: number, k = 1) => x.toFixed(k).replace('.', ',').replace('-', '−');
const d = (x: number, k = 1) => (Number(x.toFixed(k)) === 0 ? '(=)' : `(${x > 0 ? '+' : ''}${n(x, k)})`);
const pl = (k: number, mot: string) => `${k} ${mot}${k > 1 ? 's' : ''}`;
const egal = (a: YearMonth, b: YearMonth) => a.year === b.year && a.month === b.month;

const MENTION_DEFAITE: Record<DefeatCause, string> = { dette: 'Banqueroute', regime: 'Crise de régime', soulevement: 'Le pays dans la rue', presidentielle: 'Mandat sans lendemain' };
const TITRE_DEFAITE: Record<DefeatCause, string> = { dette: 'Crise de la dette', regime: 'Crise de régime', soulevement: 'Soulèvement', presidentielle: 'Battu à la présidentielle' };

// Réélu en mai 2027 (§12) : posé au second tour ; absent (sauvegarde antérieure) = déduit de la date et de l'absence de défaite.
export const reelu = (s: GameState) => (s.internals['pres:reelu'] ?? (monthIndex(s.date) >= 17 && !s.defaite && s.mode !== 'bac_a_sable' ? 1 : 0)) === 1;

export function bilan(s: GameState): Bilan {
  const D = depart(), F = s.national, h = s.history;
  const moyH = (k: keyof GameState['national']) => (h.length ? moyenne(h.map((x) => x.national[k])) : F[k]);
  const sat = moyenne(Object.values(s.groups).map((g) => g.satisfaction));
  const lois = s.bills.filter((b) => b.status === 'adoptee' && b.spec.loiDeFinances === undefined);
  const reformes = s.bills.filter((b) => b.status === 'adoptee' && b.spec.reforme);
  const censures = s.bills.filter((b) => b.status === 'censuree');
  const totales = s.bills.filter((b) => b.saisine?.issue === 'totale'), partielles = s.bills.filter((b) => b.saisine?.issue === 'partielle');
  const dissolutions = s.internals['n:dissolutions'] ?? 0, r = reelu(s);
  const infl = moyH('inflation'), croiss = moyH('croissance_pib');

  const rubriques: Bilan['rubriques'] = [
    { id: 'finances', label: 'Finances publiques',
      note: 50 - C.bilan_k_dette * (F.dette_publique - D.dette_publique) - C.bilan_k_deficit * (F.deficit_public - D.deficit_public),
      detail: `Dette ${n(F.dette_publique)} % du PIB ${d(F.dette_publique - D.dette_publique)}, déficit ${n(F.deficit_public)} % ${d(F.deficit_public - D.deficit_public)}` },
    { id: 'emploi', label: 'Emploi et croissance',
      note: 50 - C.bilan_k_chomage * (F.chomage_bit - D.chomage_bit) + C.bilan_k_croissance * (croiss - C.croissance_potentielle_long_terme),
      detail: `Chômage ${n(F.chomage_bit)} % ${d(F.chomage_bit - D.chomage_bit)}, croissance moyenne ${n(croiss)} %` },
    { id: 'pouvoir_achat', label: "Pouvoir d'achat",
      note: 50 + C.bilan_k_satisfaction * (sat - SAT0) - C.bilan_k_inflation * Math.max(0, infl - C.cible_inflation_bce) - C.bilan_k_pauvrete * (F.taux_pauvrete - D.taux_pauvrete),
      detail: `Satisfaction moyenne ${n(100 * sat, 0)} % ${d(100 * (sat - SAT0), 0)}, inflation moyenne ${n(infl)} %, pauvreté ${n(F.taux_pauvrete)} % ${d(F.taux_pauvrete - D.taux_pauvrete)}` },
    { id: 'cohesion', label: 'Cohésion',
      note: 50 - C.bilan_k_tension * (F.tension - D.tension) + C.bilan_k_stabilite * (F.stabilite - D.stabilite),
      detail: `Tension ${n(100 * F.tension, 0)} % ${d(100 * (F.tension - D.tension), 0)}, stabilité ${n(100 * F.stabilite, 0)} % ${d(100 * (F.stabilite - D.stabilite), 0)}` },
    { id: 'popularite', label: 'Popularité',
      note: 50 + C.bilan_k_popularite * (F.popularite - D.popularite),
      detail: `Popularité ${n(100 * F.popularite, 0)} % ${d(100 * (F.popularite - D.popularite), 0)}` },
    { id: 'institutions', label: 'Parcours institutionnel',
      note: C.bilan_institutions_base + C.bilan_pts_loi * Math.min(C.bilan_lois_max, lois.length) + C.bilan_pts_reelection * (r ? 1 : 0)
        - C.bilan_pts_censure * censures.length - C.bilan_pts_conseil_totale * totales.length - C.bilan_pts_conseil_partielle * partielles.length
        - C.bilan_pts_dissolution * dissolutions,
      detail: [pl(lois.length, 'loi') + (lois.length > 1 ? ' adoptées' : ' adoptée'), r && 'réélu en 2027',
        censures.length && pl(censures.length, 'gouvernement') + (censures.length > 1 ? ' renversés' : ' renversé'),
        totales.length + partielles.length && pl(totales.length + partielles.length, 'censure') + ' du Conseil constitutionnel',
        dissolutions && pl(dissolutions, 'dissolution')].filter(Boolean).join(', ') },
  ];
  for (const x of rubriques) x.note = h.length ? Math.round(clamp(x.note)) : 50;
  const poids: Record<string, number> = { finances: C.bilan_poids_finances, emploi: C.bilan_poids_emploi, pouvoir_achat: C.bilan_poids_pouvoir_achat,
    cohesion: C.bilan_poids_cohesion, popularite: C.bilan_poids_popularite, institutions: C.bilan_poids_institutions };
  const plafond = s.defaite && (s.defaite.cause === 'presidentielle' ? C.bilan_plafond_presidentielle : C.bilan_plafond_defaite);
  let score = Math.round(rubriques.reduce((a, x) => a + poids[x.id] * x.note, 0));
  if (plafond) score = Math.min(score, plafond);

  // Mention : première règle vérifiée (seuils de libellé, pas de dynamique).
  const note = (id: string) => rubriques.find((x) => x.id === id)!.note;
  const mention = s.defaite ? MENTION_DEFAITE[s.defaite.cause]
    : score >= 75 ? 'Quinquennat historique'
    : score >= 62 && (lois.length >= 3 || reformes.length > 0) ? 'Quinquennat réformateur'
    : note('finances') >= 65 && note('popularite') < 40 ? 'Rigueur impopulaire'
    : note('emploi') >= 65 && note('finances') < 35 ? 'Relance à crédit'
    : note('cohesion') < 30 ? 'Mandat de crise'
    : lois.length <= 1 ? "Mandat d'attente"
    : score >= 50 ? 'Mandat de gestion'
    : 'Mandat contrasté';

  // Faits marquants : les 3 de plus fort poids, puis par date.
  const faits: { poids: number; date: YearMonth; texte: string }[] = [];
  const titre = (id: string) => s.bills.find((b) => b.id === id)?.spec.title ?? id;
  if (h.length) {
    const fin = h.at(-1)!.date;
    if (s.defaite) faits.push({ poids: 100, date: s.defaite.date, texte: TITRE_DEFAITE[s.defaite.cause] });
    if (r) faits.push({ poids: 90, date: { year: 2027, month: 5 }, texte: 'Réélu à la présidentielle' });
    for (const b of censures) {
      const v = b.votes.find((x) => x.chambre === 'censure' && x.adopte);
      if (v) faits.push({ poids: 75, date: v.date, texte: `Gouvernement renversé sur « ${b.spec.title} »` });
    }
    for (const b of reformes) if (b.promulgueLe) faits.push({ poids: 70, date: b.promulgueLe, texte: `Réforme adoptée : ${describeReforme(b.spec.reforme!)}` });
    for (const b of s.bills) if (b.referendum)
      faits.push({ poids: 70, date: b.referendum.date, texte: `Référendum ${b.referendum.adopte ? 'gagné' : 'perdu'} sur « ${b.spec.title} » (${n(b.referendum.oui)} % de oui)` });
    const leg = inst(s).legislatives, coh = inst(s).gouvernement.profil === 'cohabitation' ? ' : cohabitation' : '';
    if (dissolutions > 0) faits.push({ poids: 65, date: leg, texte: `Législatives anticipées${coh}` });
    else if (egal(leg, { year: 2029, month: 6 })) faits.push({ poids: 65, date: leg, texte: `Législatives de juin 2029${coh}` });
    for (const b of totales) faits.push({ poids: 60, date: b.saisine!.decisionLe, texte: `« ${titre(b.id)} » censurée par le Conseil constitutionnel` });
    const greve = h.find((x) => x.national.tension >= C.seuil_tension_greve_generale);
    if (greve) faits.push({ poids: 55, date: greve.date, texte: 'Première grève générale' });
    if (F.chomage_bit - D.chomage_bit <= -1) faits.push({ poids: 50, date: fin, texte: `Chômage ramené à ${n(F.chomage_bit)} %` });
    if (F.dette_publique - D.dette_publique >= 10) faits.push({ poids: 50, date: fin, texte: `Dette à ${n(F.dette_publique)} % du PIB` });
    for (const b of partielles) faits.push({ poids: 30, date: b.saisine!.decisionLe, texte: `« ${titre(b.id)} » partiellement censurée par le Conseil constitutionnel` });
  }
  const retenus = faits.map((x, i) => ({ ...x, i })).sort((a, b) => b.poids - a.poids || a.i - b.i).slice(0, 3)
    .sort((a, b) => monthIndex(a.date) - monthIndex(b.date) || a.i - b.i).map(({ date, texte }) => ({ date, texte }));

  return { score: h.length ? score : 50, provisoire: !isOver(s), mention, ...(plafond && { plafond }), rubriques, faits: retenus };
}
