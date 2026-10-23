// Institutions (ENGINE.md §11) : gouvernement, dissolution, législatives anticipées, cohabitation.
import type { Bill, GameState, Gouvernement, IssueLegislatives, LegislativesForecast, Pouvoir, ProfilPM, Rapport, Sieges, TurnEvent, YearMonth } from './types.ts';
import { monthIndex, votesSimules } from './types.ts';
import { C, INIT, REL0, campAutre, campBloc, dansBande, inst, politics, relKey, relation, seuil } from './init.ts';
import { FORECAST_N, billAxes, fond, gauss, senatGroupes, voteBill, voteCongres } from './parliament.ts';
import { qualitativeEffect } from './levers.ts';
import { regles } from './reformes.ts';
import { joueur, positionDe, positionPresident } from './presidentielle.ts';

const D = politics.institutions;
const PROFILS = new Map(D.profils.map((p) => [p.id as string, p]));
const BLOCS = D.blocs;
const COALITIONS = new Map(D.coalitions_opposition.map((c) => [c.id, c]));
const BLOC_DE = new Map(BLOCS.flatMap((b) => b.groupes.map((g) => [g, b.id])));
const S0 = new Map(politics.assemblee.groupes.map((g) => [g.id, g.sieges]));
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
export const addMonths = (d: YearMonth, n: number): YearMonth => {
  const m = monthIndex(d) + n;
  return { year: 2026 + Math.floor(m / 12), month: (((m % 12) + 12) % 12) + 1 };
};

// Plus forts restes : répartit total (entier) au prorata des poids.
function repartir(total: number, poids: number[]): number[] {
  const tot = sum(poids);
  const q = poids.map((w) => (tot > 0 ? (total * w) / tot : 0));
  const n = q.map(Math.floor);
  const ordre = q.map((x, i) => i).sort((i, j) => q[j] - n[j] - (q[i] - n[i]));
  const reste = total - sum(n);
  for (let k = 0; k < reste; k++) n[ordre[k]]++;
  return n;
}
// Prime majoritaire (§14) : round(prime % × N) sièges au bloc en tête, le reste à la proportionnelle (plus forts restes).
function primeMajoritaire(N: number, w: number[], prime: number): number[] {
  const bonus = Math.round((prime / 100) * N), i = w.indexOf(Math.max(...w)), n = repartir(N - bonus, w);
  n[i] += bonus;
  return n;
}

// Sièges par bloc, dans l'ordre des données, puis les groupes hors blocs (interface, LLM, banc).
export function parBloc(sieges: Sieges): { id: string; nom: string; sieges: number }[] {
  const de = (ids: string[]) => sum(sieges.filter((g) => ids.includes(g.groupId)).map((g) => g.sieges));
  return [...BLOCS.map((b) => ({ id: b.id, nom: b.nom, sieges: de(b.groupes) })), { id: 'autres', nom: 'Autres (LIOT, non-inscrits)', sieges: de(D.hors_blocs) }];
}

// Législatives : sièges par bloc (formule de legislatives_exposant), puis par groupe au prorata des sièges initiaux. Pur.
export function scrutin(s: GameState, rng: number): { assemblee: GameState['parliament']['assemblee']; rng: number } {
  const cur = new Map(s.parliament.assemblee.map((g) => [g.groupId, g]));
  const sortants = (ids: string[]) => sum(ids.map((id) => cur.get(id)?.sieges ?? 0));
  // Camp du Président : prime (ou malus) de popularité, que les intentions de présidentielle ne reflètent qu'à peine.
  const prime = Math.exp(C.legislatives_prime_popularite * (s.national.popularite - INIT.popularite));
  const pr = regles(s).proportionnelle;
  const w = BLOCS.map((b) => {
    let z: number;
    [z, rng] = gauss(rng);
    const v = sum(b.parties.map((p) => s.intentions[p] ?? 0));
    // Proportionnelle (§14) : voix des partis au-dessus du seuil ; même incertitude relative et même prime de popularité que le
    // scrutin majoritaire, ramenées à l'échelle des voix (÷ exposant) ; ni barrage ni ancrage local.
    if (pr) return sum(b.parties.map((p) => ((s.intentions[p] ?? 0) >= pr.seuil ? s.intentions[p] ?? 0 : 0)))
      * Math.exp((C.legislatives_incertitude * z) / C.legislatives_exposant) * (b.id === campBloc(s) ? prime ** (1 / C.legislatives_exposant) : 1);
    return (v * (b.barrage ? C.legislatives_barrage : 1)) ** C.legislatives_exposant * Math.exp(C.legislatives_incertitude * z)
      * (b.id === campBloc(s) ? prime : 1);
  });
  const S = BLOCS.map((b) => sortants(b.groupes));
  const sw = sum(w), sS = sum(S), l = C.legislatives_ancrage_local;
  // Les hors blocs gardent leurs sièges ; le scrutin pourvoit aussi les sièges vacants (total 577).
  const nb = pr ? primeMajoritaire(577 - sortants(D.hors_blocs), w, pr.prime)
    : repartir(577 - sortants(D.hors_blocs), BLOCS.map((_, i) => l * S[i] / sS + (1 - l) * w[i] / sw));
  const out = new Map<string, number>();
  BLOCS.forEach((b, i) => repartir(nb[i], b.groupes.map((g) => S0.get(g) ?? 0)).forEach((n, j) => out.set(b.groupes[j], n)));
  const assemblee = politics.assemblee.groupes.map((g) => ({
    groupId: g.id, sieges: out.get(g.id) ?? cur.get(g.id)?.sieges ?? 0, rapport: cur.get(g.id)?.rapport ?? (g.rapport_gouvernement as Rapport),
  }));
  return { assemblee, rng };
}

// Majorité présidentielle (§13) : camp choisi hors du centre = son bloc et les autres blocs de la première coalition qui le
// contient ; sinon celle des données.
const majPres = (s?: GameState): string[] => {
  if (!s || !campAutre(s)) return D.majorite_presidentielle;
  const b = campBloc(s);
  return [b, ...(D.coalitions_opposition.find((c) => c.blocs.includes(b))?.blocs.filter((x) => x !== b) ?? [])];
};

// Issue : majorité présidentielle, sinon première coalition d'opposition (sans le bloc du camp) à la majorité absolue, sinon
// aucune majorité. Sans état : camp réel.
export function issue(a: Sieges, s?: GameState): { issue: IssueLegislatives; coalition?: string } {
  const m = new Map(parBloc(a).map((b) => [b.id, b.sieges]));
  const tot = (ids: string[]) => sum(ids.map((id) => m.get(id) ?? 0));
  if (tot(majPres(s)) >= C.censure_seuil) return { issue: 'majorite' };
  const cb = s ? campBloc(s) : D.majorite_presidentielle[0];
  const c = D.coalitions_opposition.find((x) => !x.blocs.includes(cb) && tot(x.blocs) >= C.censure_seuil);
  return c ? { issue: 'cohabitation', coalition: c.id } : { issue: 'sans_majorite' };
}

// Profils génériques d'un camp choisi hors du centre (§13), sur les sièges initiaux (résultat stable, mis en cache par camp et
// profil, par bloc). Majorité : bloc du camp (et le bloc voisin pour une ouverture) ; technicien : profil des données, bloc du camp au moins
// en soutien. Soutien conditionnel : blocs adjacents à la majorité et hors blocs. Plancher : tant que l'opposition compte moins de
// sièges qu'au départ réel (OPP0), le groupe en soutien le plus éloigné du parti de tête du bloc du camp passe dans l'opposition
// (même départ pour tous les partis d'un bloc).
// ponytail: profils approximatifs (voisinage de blocs), à remplacer par des profils d'ouverture sourcés par camp.
const ORDRE_BLOCS = BLOCS.map((b) => b.id); // droite → gauche : rn, droite, centre, gauche, lfi
const OPP0 = sum(politics.assemblee.groupes.filter((g) => g.rapport_gouvernement === 'opposition').map((g) => g.sieges));
const GPOS = new Map(politics.assemblee.groupes.map((g) => [g.id, g.positionnement]));
const PROFILS_CAMP = new Map<string, Map<string, Rapport>>();
export function profilCamp(s: GameState, profil: Exclude<ProfilPM, 'cohabitation'>): (id: string) => Rapport {
  const cle = `${campBloc(s)}:${profil}`;
  let r = PROFILS_CAMP.get(cle);
  if (!r) {
    const i = ORDRE_BLOCS.indexOf(campBloc(s)), cb = campBloc(s);
    r = new Map<string, Rapport>();
    if (profil === 'technicien') {
      const data: Record<string, string | undefined> = PROFILS.get('technicien')?.rapports ?? {};
      for (const g of politics.assemblee.groupes)
        r.set(g.id, BLOC_DE.get(g.id) === cb ? 'soutien_conditionnel' : (data[g.id] as Rapport | undefined) ?? 'opposition');
    } else {
      const M = (profil === 'ouverture_gauche' ? [i, i + 1] : profil === 'ouverture_droite' ? [i - 1, i] : [i]).filter((k) => k >= 0 && k < ORDRE_BLOCS.length);
      const adj = [Math.min(...M) - 1, Math.max(...M) + 1].map((k) => ORDRE_BLOCS[k]);
      for (const g of politics.assemblee.groupes) {
        const b = BLOC_DE.get(g.id);
        r.set(g.id, b && M.some((k) => ORDRE_BLOCS[k] === b) ? 'majorite' : !b || adj.includes(b) ? 'soutien_conditionnel' : 'opposition');
      }
    }
    const p = positionDe(BLOCS[i].parties[0]), dist = (id: string) => {
      const x = GPOS.get(id)!;
      return Math.hypot(x.economie - p.economie, x.societal - p.societal, x.europe - p.europe);
    };
    const opp = () => sum([...S0].filter(([id]) => r!.get(id) === 'opposition').map(([, n]) => n));
    while (opp() < OPP0) {
      const soutiens = [...S0.keys()].filter((id) => r!.get(id) === 'soutien_conditionnel');
      if (!soutiens.length) break;
      r.set(soutiens.reduce((a, b) => (dist(b) > dist(a) ? b : a)), 'opposition');
    }
    PROFILS_CAMP.set(cle, r);
  }
  const m = r;
  return (id) => m.get(id) ?? 'opposition';
}

// Rapport de chaque groupe au gouvernement : celui du profil (générique pour un camp hors du centre), ou en cohabitation
// coalition → majorité, bloc du camp → soutien conditionnel.
export function rapportDe(s: GameState, g: Gouvernement): (groupId: string) => Rapport {
  if (g.profil !== 'cohabitation') {
    if (campAutre(s)) return profilCamp(s, g.profil);
    const r: Record<string, string | undefined> = PROFILS.get(g.profil)?.rapports ?? {};
    return (id) => (r[id] as Rapport | undefined) ?? 'opposition';
  }
  const coal = new Set(COALITIONS.get(g.coalition ?? '')?.blocs), cb = campBloc(s);
  return (id) => {
    const b = BLOC_DE.get(id);
    return b && coal.has(b) ? 'majorite' : b === cb ? 'soutien_conditionnel' : 'opposition';
  };
}

// Relations de tous les groupes (Assemblée, puis Sénat sous senat_<id>) : stockées, sinon centre de bande du rapport (§13).
const toutesRelations = (s: GameState): Record<string, number> => Object.fromEntries([
  ...s.parliament.assemblee.map((g) => [g.groupId, relation(s, g)]),
  ...senatGroupes(s).map((g) => [relKey('senat', g.groupId), relation(s, g, 'senat')]),
]);

const RANG: Record<Rapport, number> = { opposition: 0, soutien_conditionnel: 1, majorite: 2 };
// Nomination (choix = true) ou cohabitation issue des urnes (false). Rapports = ceux du profil (jamais filtrés par les seuils).
// Relation = centre de la nouvelle bande + moitié de l'écart d'avant (mémoire des griefs) − coût de rupture par cran perdu
// − fidélité (camp choisi : le bloc du camp punit l'entrée d'un autre groupe en majorité), ramenée dans la bande (pas de rebascule).
function appliquer(s: GameState, g: Gouvernement, choix: boolean) {
  const nouveau = rapportDe(s, g), rel = toutesRelations(s), cb = campBloc(s);
  const ouvre = choix && !!s.camp && s.parliament.assemblee.some((x) =>
    nouveau(x.groupId) === 'majorite' && x.rapport !== 'majorite' && BLOC_DE.get(x.groupId) !== cb);
  for (const x of s.parliament.assemblee) {
    const r = nouveau(x.groupId);
    let v = REL0[r] + C.parlement_relation_memoire * (relation(s, x) - REL0[x.rapport]);
    if (choix) v -= C.parlement_relation_cout_rupture * Math.max(0, RANG[x.rapport] - RANG[r]);
    if (ouvre && BLOC_DE.get(x.groupId) === cb) v -= C.parlement_relation_fidelite;
    rel[x.groupId] = dansBande(v, r);
    x.rapport = r;
  }
  s.relations = rel; // les clés senat_* sont gardées telles quelles
}

// Étape 7b du tick (ENGINE.md §13) : lois promulguées ce mois (tick, 49.3, previewBill), popularité, retour au centre de bande,
// puis un cran de rapport au plus. Assemblée gelée en cohabitation (§11.7). Sénat jamais gelé. Sans tirage. Modifie s.
export function majRelations(s: GameState, t: number, popularite: number): TurnEvent[] {
  const lois = s.bills.filter((b) => b.status === 'adoptee' && b.promulgueLe && monthIndex(b.promulgueLe) === t);
  const axes = lois.map((b) => billAxes(b));
  const gel = inst(s).gouvernement.profil === 'cohabitation';
  const rel: Record<string, number> = {}, out: TurnEvent[] = [];
  const pas = (g: { groupId: string; rapport: Rapport }, chambre: 'assemblee' | 'senat') => {
    let x = relation(s, g, chambre);
    x += C.parlement_relation_retour * (REL0[g.rapport] - x)
      + C.parlement_relation_poids_popularite * (popularite - INIT.popularite); // centré : aucune dérive au départ
    lois.forEach((b, i) => {
      const f = Math.max(-1, Math.min(1, fond(b, chambre, g.groupId, axes[i])));
      x += C.parlement_relation_par_loi * f
        - (chambre === 'assemblee' && b.usage493 && g.rapport !== 'majorite' && f < 0 ? C.parlement_relation_493 : 0);
    });
    rel[relKey(chambre, g.groupId)] = x = Math.max(-1, Math.min(1, x));
    return x;
  };
  for (const g of s.parliament.assemblee) {
    const r = seuil(pas(g, 'assemblee'), g.rapport);
    if (!gel && r !== g.rapport) { out.push({ kind: 'rapport', chambre: 'assemblee', groupId: g.groupId, avant: g.rapport, apres: r }); g.rapport = r; }
  }
  for (const g of senatGroupes(s)) {
    const r = seuil(pas(g, 'senat'), g.rapport);
    if (r !== g.rapport) { out.push({ kind: 'rapport', chambre: 'senat', groupId: g.groupId, avant: g.rapport, apres: r }); (s.senat ??= {})[g.groupId] = r; }
  }
  s.relations = rel;
  return out;
}

// Choix du camp à la création (§13 ; decret et bac à sable). Hors du centre : coalition minoritaire menée par un PM fictif du
// camp (jamais une cohabitation). Camp 'horizons' : départ réel (Lecornu), seule la fidélité de parti s'ajoute. Modifie s.
export function choisirCamp(s: GameState, camp: string): GameState {
  s.camp = camp;
  if (!campAutre(s)) return s;
  const gouvernement: Gouvernement = { profil: 'camp_presidentiel', depuis: { year: 2026, month: 1 }, demissionnaire: false }; // PM fictif
  s.institutions = { ...inst(s), gouvernement };
  const r = rapportDe(s, gouvernement);
  s.parliament.assemblee.forEach((x) => (x.rapport = r(x.groupId))); // relations absentes : REL0
  return s;
}

export function pouvoir(s: GameState): Pouvoir {
  const i = inst(s), t = monthIndex(s.date);
  const dissolutionPossible = addMonths(i.legislatives, C.dissolution_delai_mois);
  const assise: Record<Rapport, number> = { majorite: 0, soutien_conditionnel: 0, opposition: 0 };
  for (const g of s.parliament.assemblee) assise[g.rapport] += g.sieges;
  return {
    ...i, cohabitation: i.gouvernement.profil === 'cohabitation', assise, dissolutionPossible,
    peutDissoudre: votesSimules(s.mode) && !i.dissolution && !s.defaite && t < 60 && t >= monthIndex(dissolutionPossible),
    joueur: joueur(s), relations: toutesRelations(s), senat: senatGroupes(s),
    positionnement: positionPresident(s), positionnementInitial: positionDe(joueur(s)), campAutre: campAutre(s), regles: regles(s),
  };
}

// Dissolution (art. 12) : législatives au tick de ce mois, choc de stabilité de campagne, choc de relation pour les groupes hors
// opposition dont les sièges sont remis en jeu (§13 ; Sénat non touché).
export function dissolve(state: GameState): { state: GameState; events: TurnEvent[] } {
  if (!pouvoir(state).peutDissoudre) return { state, events: [] };
  const s = structuredClone(state);
  s.relations = Object.fromEntries(Object.entries(toutesRelations(state)).map(([k, v]) => {
    const g = s.parliament.assemblee.find((x) => x.groupId === k);
    return [k, g && g.rapport !== 'opposition' ? Math.max(-1, v - C.parlement_relation_dissolution) : v];
  }));
  s.institutions = { ...inst(s), dissolution: { ...s.date } };
  s.effects.push({ source: { kind: 'event', id: 'dissolution' }, cible: { kind: 'stabilite' }, amplitude: C.dissolution_choc_stabilite, forme: 'choc', debut: monthIndex(s.date), rampe: 0, duree: C.dissolution_duree_choc_mois });
  return { state: s, events: [{ kind: 'dissolution' }] };
}

// Nomination d'un Premier ministre : seulement si le gouvernement est démissionnaire (pas de remaniement volontaire).
export function nominate(state: GameState, profil: Exclude<ProfilPM, 'cohabitation'>): { state: GameState; events: TurnEvent[] } {
  if (!inst(state).gouvernement.demissionnaire || !PROFILS.has(profil)) return { state, events: [] };
  const s = structuredClone(state);
  const gouvernement: Gouvernement = { profil, depuis: { ...s.date }, demissionnaire: false };
  s.institutions = { ...inst(s), gouvernement };
  appliquer(s, gouvernement, true);
  return { state: s, events: [{ kind: 'nomination', profil }] };
}

// Étape 2b du tick : législatives anticipées. Modifie s (déjà copié par le tick).
export function elections(s: GameState, t: number): TurnEvent[] {
  const copie = (a: Sieges): Sieges => a.map(({ groupId, sieges }) => ({ groupId, sieges }));
  const avant = copie(s.parliament.assemblee);
  const r = scrutin(s, s.rng);
  s.rng = r.rng;
  s.parliament.assemblee = r.assemblee;
  const res = issue(r.assemblee, s), sortant = inst(s).gouvernement;
  // Hors cohabitation : démission, rapports inchangés jusqu'à la nomination ; une cohabitation qui prend fin laisse un
  // gouvernement d'affaires courantes au profil technicien (la coalition battue ne reste pas « majorité »).
  const gouvernement: Gouvernement = res.issue === 'cohabitation'
    ? { profil: 'cohabitation', coalition: res.coalition, depuis: { ...s.date }, demissionnaire: false }
    : sortant.profil === 'cohabitation' ? { profil: 'technicien', depuis: { ...s.date }, demissionnaire: true }
    : { ...sortant, demissionnaire: true };
  if (res.issue === 'cohabitation' || sortant.profil === 'cohabitation') appliquer(s, gouvernement, false);
  s.institutions = { gouvernement, legislatives: { ...s.date } };
  const apres = copie(r.assemblee);
  const camp = (a: Sieges) => parBloc(a).find((b) => b.id === campBloc(s))!.sieges;
  s.effects.push({ source: { kind: 'event', id: 'legislatives' }, cible: { kind: 'popularite' }, amplitude: (C.legislatives_effet_popularite * (camp(apres) - camp(avant))) / 577, forme: 'choc', debut: t, rampe: 0, duree: C.dissolution_duree_choc_mois });
  const events: TurnEvent[] = [{ kind: 'legislatives', avant, apres, ...res }];
  if (res.issue === 'cohabitation') events.push({ kind: 'nomination', profil: 'cohabitation', coalition: res.coalition });
  return events;
}

// Prévision : Monte-Carlo de scrutin sur des graines fixes (comme forecastVote), même loi que le tick à l'état courant.
// ponytail: 1000 tirages, ≈ 5 ms ; plus si l'affichage doit être plus fin
const LEG_N = 1000;
export function forecastLegislatives(state: GameState): LegislativesForecast {
  const tirages = BLOCS.map(() => [] as number[]);
  const n: Record<IssueLegislatives, number> = { majorite: 0, cohabitation: 0, sans_majorite: 0 };
  for (let k = 0; k < LEG_N; k++) {
    const { assemblee } = scrutin(state, (k * 2654435761) >>> 0);
    parBloc(assemblee).slice(0, BLOCS.length).forEach((b, i) => tirages[i].push(b.sieges));
    n[issue(assemblee, state).issue]++;
  }
  return {
    blocs: BLOCS.map((b, i) => {
      const d = tirages[i].sort((x, y) => x - y);
      return { id: b.id, nom: b.nom, sieges: sum(d) / LEG_N, bas: d[100], haut: d[900] };
    }),
    issues: { majorite: n.majorite / LEG_N, cohabitation: n.cohabitation / LEG_N, sans_majorite: n.sans_majorite / LEG_N },
  };
}

// Référendum (§14) : vote sur le texte et plébiscite sur le Président. Consignes = moyenne, pondérée par les sièges de l'Assemblée,
// de clamp(fond + relation, −1, 1) ; oui (%) = 100 σ(poids_popularite × (popularité − pivot) + poids_consignes × consignes + incertitude × z).
export function referendumOui(s: GameState, bill: Bill, z: number): number {
  const a = s.parliament.assemblee, n = sum(a.map((g) => g.sieges));
  const c = sum(a.map((g) => g.sieges * Math.max(-1, Math.min(1, fond(bill, 'assemblee', g.groupId) + relation(s, g))))) / n;
  return 100 / (1 + Math.exp(-(C.referendum_poids_popularite * (s.national.popularite - C.referendum_pivot) + C.referendum_poids_consignes * c + C.referendum_incertitude * z)));
}

// Scrutin : un gauss seulement si alea (tick normal ; aleatoire:false → z = 0, s.rng intact). Écrit b.referendum. Échec (même en
// bac à sable : ce n'est pas une défaite) : chocs de popularité, stabilité et tension, relations − referendum_echec_relation
// (bornées à −1 ; les seuils §13 jouent à l'étape 7b). Succès : petit choc de popularité. Modifie s et b.
export function resoudreReferendum(s: GameState, b: Bill, t: number, alea: boolean): { oui: number; adopte: boolean } {
  let z = 0;
  if (alea) [z, s.rng] = gauss(s.rng);
  const oui = referendumOui(s, b, z), adopte = oui > 50;
  b.referendum = { date: { ...s.date }, oui, adopte };
  const choc = (kind: 'popularite' | 'stabilite' | 'tension', dir: number, mag: 'faible' | 'moyenne') =>
    s.effects.push(qualitativeEffect(s, { kind: 'event', id: `referendum:${b.id}` }, { kind }, dir, mag, 'choc', t, 0, C.referendum_duree_choc_mois));
  if (adopte) choc('popularite', 1, 'faible');
  else {
    choc('popularite', -1, 'moyenne'); choc('stabilite', -1, 'faible'); choc('tension', 1, 'faible');
    s.relations = Object.fromEntries(Object.entries(toutesRelations(s)).map(([k, v]) => [k, Math.max(-1, v - C.referendum_echec_relation)]));
  }
  return { oui, adopte };
}

// Prévision de bout en bout, FORECAST_N graines fixes (motif de forecastVote) : Assemblée puis Sénat, puis Congrès (rng suivant)
// et z du référendum (gauss sur le rng qui suit le Congrès). congres = P(AN ∧ Sénat ∧ 3/5) ; referendum = P(AN ∧ Sénat ∧ oui > 50) ;
// oui = moyenne. Pur, n'avance pas state.rng.
export function forecastCircuit(s: GameState, bill: Bill): { congres: number; referendum: number; oui: number } {
  let congres = 0, referendum = 0, oui = 0;
  for (let k = 0; k < FORECAST_N; k++) {
    const st = { ...s, rng: (k * 2654435761) >>> 0 };
    const an = voteBill(st, bill, 'assemblee'), se = voteBill({ ...st, rng: an.rng }, bill, 'senat');
    const deux = an.result.adopte && se.result.adopte;
    const c = voteCongres({ ...st, rng: se.rng }, bill);
    const o = referendumOui(s, bill, gauss(c.rng)[0]);
    oui += o / FORECAST_N;
    if (deux && c.result.adopte) congres++;
    if (deux && o > 50) referendum++;
  }
  return { congres: congres / FORECAST_N, referendum: referendum / FORECAST_N, oui };
}
