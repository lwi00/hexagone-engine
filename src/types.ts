// Contrat du moteur : partagé par le moteur, le Parlement, les LLM et l'interface.
// Conventions détaillées : ENGINE.md. Ne pas modifier sans mettre à jour ENGINE.md.
import { z } from 'zod';
import { EffectTarget, Magnitude, REGION_CODES, SOCIAL_GROUPS } from './schemas.ts';

export type RegionCode = (typeof REGION_CODES)[number];
export type SocialGroup = (typeof SOCIAL_GROUPS)[number];

export type YearMonth = { year: number; month: number }; // month 1..12
// democratie = mode « Réaliste » (votes, défaites, un dépôt par mois) ; decret = tout est adopté ; bac_a_sable = votes mais
// ni défaite ni limite de dépôts. L'id « democratie » est gardé pour les sauvegardes existantes.
export type GameMode = 'democratie' | 'decret' | 'bac_a_sable';
export const votesSimules = (mode: GameMode) => mode !== 'decret';

// ---------- Institutions (ENGINE.md §11) ----------
export type Rapport = 'majorite' | 'soutien_conditionnel' | 'opposition';
export type ProfilPM = 'camp_presidentiel' | 'ouverture_gauche' | 'ouverture_droite' | 'technicien' | 'cohabitation';
export type Sieges = { groupId: string; sieges: number }[];
export type IssueLegislatives = 'majorite' | 'cohabitation' | 'sans_majorite';
export type Gouvernement = {
  premierMinistre?: string; // nom réel (gouvernement initial seulement) ; sinon l'interface affiche le libellé du profil
  profil: ProfilPM;
  coalition?: string; // cohabitation : id de politics.institutions.coalitions_opposition
  depuis: YearMonth;
  demissionnaire: boolean; // censure adoptée ou législatives : dépôt et 49.3 impossibles jusqu'à nominate
};
export type Institutions = {
  gouvernement: Gouvernement;
  legislatives: YearMonth; // dernier scrutin législatif (juillet 2024 au départ) : pas de dissolution dans les 12 mois (art. 12)
  dissolution?: YearMonth; // dissolution prononcée ce mois-ci : législatives (deux tours) au tick de ce mois
};
export type Pouvoir = Institutions & {
  cohabitation: boolean;
  assise: Record<Rapport, number>; // sièges de l'Assemblée selon leur rapport au gouvernement
  peutDissoudre: boolean;
  dissolutionPossible: YearMonth; // premier mois où l'article 12 permet une dissolution
};
export type PresidentielleForecast = {
  premierTour: { partyId: string; pct: number }[]; // moyennes
  qualification: number; victoire: number; // probabilités pour le candidat du joueur
  adversaires: { partyId: string; frequence: number }[]; // adversaire au second tour (fréquence parmi toutes les simulations)
};
export type LegislativesForecast = {
  blocs: { id: string; nom: string; sieges: number; bas: number; haut: number }[]; // moyenne, 10e et 90e centiles
  issues: Record<IssueLegislatives, number>; // fréquences, somme 1
};

// ---------- Projet de loi (produit par le LLM rédacteur, validé par zod) ----------
export const BillSpec = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  articles: z.array(z.string()).min(1),
  // Écart demandé par rapport à la valeur courante du levier (unité du levier). Ex. TVA +2 points → { id: 'tva.taux_normal', delta: 2 }.
  levers: z.array(z.object({ id: z.string(), delta: z.number() })),
  // Mesures hors catalogue : effet borné, converti par les coefficients bareme.*.
  qualitative: z.array(z.object({
    cible: EffectTarget, // jamais un indicateur dérivé (vérifié par validateBill)
    direction: z.union([z.literal(1), z.literal(-1)]),
    intensite: Magnitude,
    justification: z.string(),
  })),
  tags: z.array(z.string()).min(1), // ids de gamedata/tags.json
  prepMonths: z.number().int().min(0).max(24),
  rampMonths: z.number().int().min(0).max(60), // montée en charge des effets qualitatifs uniquement
  estimatedCost: z.number(), // Md€/an, estimation du LLM (affichée, non utilisée par le moteur)
  // Accord sur le fond de chaque groupe parlementaire (clé « assemblee_<id> » ou « senat_<id> », de −1 à 1), donné par un
  // modèle de décision (Jev) ; remplace le produit scalaire des axes dans le score de vote (ENGINE.md §4b).
  positions: z.record(z.string(), z.number().min(-1).max(1)).optional(),
  loiDeFinances: z.number().int().optional(), // projet de loi de finances pour cette année (calendrier budgétaire, ENGINE.md §5d)
});
export type BillSpec = z.infer<typeof BillSpec>;

export type BillStatus = 'brouillon' | 'preparation' | 'rejetee' | 'adoptee' | 'retiree' | 'censuree';
export type VoteResult = {
  chambre: 'assemblee' | 'senat' | 'censure';
  date: YearMonth;
  pour: number; contre: number; abstention: number;
  adopte: boolean;
  parGroupe: { groupId: string; pour: number; contre: number; abstention: number }[];
};
export type Bill = {
  id: string;
  spec: BillSpec;
  status: BillStatus;
  deposeLe?: YearMonth; // dépôt → préparation pendant spec.prepMonths
  voteLe?: YearMonth; // mois du vote (= dépôt + prepMonths)
  promulgueLe?: YearMonth; // départ des effets
  usage493?: boolean;
  votes: VoteResult[];
};

// ---------- Effets actifs (leviers, lois qualitatives, événements) ----------
export type ActiveEffect = {
  source: { kind: 'lever' | 'bill' | 'event'; id: string };
  cible: z.infer<typeof EffectTarget>;
  amplitude: number; // valeur pleine dans l'unité de la cible (points de %, score 0-1, Md€/an, pb, crans)
  forme: 'niveau' | 'choc';
  debut: number; // index de mois absolu (voir monthIndex)
  rampe: number; // mois
  duree?: number; // mois ; requis pour choc et pour tout effet d'événement
};

// ---------- État ----------
export type Indicators = {
  croissance_pib: number; // % glissement annuel du PIB en volume
  chomage_bit: number; // %
  inflation: number; // % glissement annuel
  taux_pauvrete: number; // %
  pib_nominal: number; // Md€, somme glissante 12 mois
  deficit_public: number; // % du PIB
  dette_publique: number; // % du PIB
  dette_publique_md: number; // Md€
  taux_oat_10: number; // %
  spread_oat_bund: number; // pb
  prelevements_obligatoires: number; // % du PIB
  depense_publique: number; // % du PIB
  population: number; // millions
  popularite: number; // 0..1
  tension: number; // 0..1, nationale
  stabilite: number; // 0..1
};

export type GameState = {
  version: 1;
  seed: number;
  rng: number; // état courant du générateur (mulberry32)
  mode: GameMode;
  date: YearMonth;
  national: Indicators;
  budget: { recettes: Record<string, number>; depenses: Record<string, number> }; // Md€/an, postes de schemas.ts
  regions: Record<RegionCode, { chomage: number; tension: number; greve: boolean }>;
  groups: Record<SocialGroup, { satisfaction: number }>;
  intentions: Record<string, number>; // party_id → % (somme 100)
  parliament: { assemblee: { groupId: string; sieges: number; rapport: Rapport }[]; usages493: number[] /* années */ };
  levers: Record<string, { reference: number; delta: number }>; // valeur affichée = reference + delta ; l'indexation automatique bouge reference
  effects: ActiveEffect[];
  bills: Bill[];
  firedEvents: string[]; // ids d'événements déjà appliqués
  internals: Record<string, number>; // variables techniques du moteur (niveau des prix, PIB mensuel, etc.)
  history: { date: YearMonth; national: Indicators; intentions: Record<string, number> }[];
  defaite?: { cause: DefeatCause; date: YearMonth }; // fin de partie anticipée (ENGINE.md §10)
  institutions?: Institutions; // ENGINE.md §11 ; absent (sauvegarde antérieure) = INSTITUTIONS0
  dilemme?: Dilemme; // ENGINE.md §5c : en attente d'un choix du joueur
};
export type Dilemme = {
  id: string; // modèle de gamedata/events-random.json
  titre: string; description: string; // titre avec la région touchée, le cas échéant
  region?: RegionCode;
  choix: { id: string; label: string; description: string }[];
};

// Fin de partie anticipée : crise de la dette (spread), crise de régime (stabilité), soulèvement (tension).
export type DefeatCause = 'dette' | 'regime' | 'soulevement' | 'presidentielle'; // presidentielle : ENGINE.md §12
export type Danger = { cause: DefeatCause; mois: number; limite: number; valeur: number; seuil: number }; // mois consécutifs au-delà du seuil, défaite à limite

// Événement survenu pendant un tour, pour le narrateur et le fil d'actualités.
export type TurnEvent =
  | { kind: 'event'; id: string; titre: string; description: string; type: 'exogene' | 'echeance' | 'aleatoire' }
  | { kind: 'vote'; billId: string; result: VoteResult }
  | { kind: 'promulgation'; billId: string }
  | { kind: 'censure'; billId: string; adoptee: boolean }
  | { kind: 'indexation'; leverId: string; ancienne: number; nouvelle: number }
  | { kind: 'greve'; region: RegionCode; generale: boolean }
  | { kind: 'alerte'; cause: DefeatCause; moisRestants: number } // premier mois au-delà d'un seuil de défaite
  | { kind: 'defaite'; cause: DefeatCause }
  | { kind: 'dissolution' }
  | { kind: 'legislatives'; avant: Sieges; apres: Sieges; issue: IssueLegislatives; coalition?: string } // soirée électorale
  | { kind: 'nomination'; profil: ProfilPM; coalition?: string }
  | { kind: 'presidentielle'; tour: 1 | 2; resultats: { partyId: string; pct: number }[]; qualifies: [string, string]; joueur: string; elu?: string } // §12
  | { kind: 'choix'; eventId: string; titre: string; label: string; parDefaut: boolean }; // réponse à un dilemme (§5c)

export type TurnReport = { date: YearMonth; events: TurnEvent[]; avant: Indicators; apres: Indicators };

// ---------- Prévisualisation d'une loi ----------
// Deux simulations depuis l'état courant, sans LLM ni événements aléatoires : sans la loi et avec la loi supposée adoptée
// au mois prévu (date + prepMonths). Les événements programmés s'appliquent dans les deux, donc l'écart = effet de la loi.
export type VoteForecast = {
  chambre: 'assemblee' | 'senat';
  pour: number; contre: number; abstention: number; // voix attendues (espérance, sans tirage)
  probabiliteAdoption: number; // 0..1
  parGroupe: { groupId: string; pour: number; contre: number; abstention: number }[];
};
export type PreviewResult = {
  months: number;
  dates: YearMonth[]; // une entrée par mois simulé
  sans: Indicators[]; // trajectoire sans la loi
  avec: Indicators[]; // trajectoire avec la loi
  ecart: Partial<Record<keyof Indicators, number>>; // avec − sans au dernier mois
  budget: { ligne: string; ecart: number }[]; // Md€/an au dernier mois, lignes non nulles triées par |écart|
  groupes: { group: SocialGroup; ecart: number }[]; // satisfaction 0..1
  regions: { region: RegionCode; tension: number; chomage: number }[]; // écarts au dernier mois
  intentions: { partyId: string; ecart: number }[]; // points de %
  vote: VoteForecast[]; // vide en mode décret et pendant une dissolution
};

// ---------- API du moteur (implémentée dans src/index.ts) ----------
export interface Engine {
  newGame(opts: { seed: number; mode: GameMode }): GameState;
  // Vérifie un BillSpec contre le catalogue (leviers et tags connus, bornes min/max, pas de cible dérivée). Liste vide = valide.
  validateBill(state: GameState, spec: BillSpec): string[];
  // Ajoute un brouillon. Ne change rien d'autre.
  addDraft(state: GameState, spec: BillSpec): GameState;
  // Brouillon → préparation (vote au mois date + prepMonths ; en mode décret : adoption à ce mois-là, sans vote).
  deposit(state: GameState, billId: string): GameState;
  withdraw(state: GameState, billId: string): GameState;
  // Après un rejet à l'Assemblée : 49.3 → motion de censure votée immédiatement.
  use493(state: GameState, billId: string): { state: GameState; events: TurnEvent[] };
  // Avance d'un mois (ordre du tick : ENGINE.md).
  endTurn(state: GameState): { state: GameState; report: TurnReport };
  isOver(state: GameState): boolean; // après décembre 2030, ou défaite
  dangers(state: GameState): Danger[]; // conditions de défaite en cours (au moins un mois)
  // months : 6..60, borné à la fin de la partie. Pur, déterministe, ne modifie pas state.
  previewBill(state: GameState, spec: BillSpec, months: number): PreviewResult;
  // Institutions (ENGINE.md §11)
  pouvoir(state: GameState): Pouvoir;
  // Sans effet (events vide) si !pouvoir(state).peutDissoudre.
  dissolve(state: GameState): { state: GameState; events: TurnEvent[] };
  // Sans effet hors gouvernement démissionnaire ; 'cohabitation' n'est pas nommable.
  nominate(state: GameState, profil: Exclude<ProfilPM, 'cohabitation'>): { state: GameState; events: TurnEvent[] };
  // Monte-Carlo sur graines fixes : pur, déterministe, n'avance pas state.rng.
  forecastLegislatives(state: GameState): LegislativesForecast;
  // Présidentielle 2027 (§12) : Monte-Carlo sur graines fixes, pur.
  forecastPresidentielle(state: GameState): PresidentielleForecast;
  canDeposit(state: GameState, spec: BillSpec): boolean;
  amend(state: GameState, billId: string, spec: BillSpec): GameState; // brouillon ou en préparation // un dépôt par mois, hors lois de finances
  // Réponse au dilemme en attente (§5c) : ses effets partent ce mois-ci. Sans effet si aucun dilemme ou choix inconnu.
  choose(state: GameState, choixId: string): { state: GameState; events: TurnEvent[] };
}

export const monthIndex = (d: YearMonth) => (d.year - 2026) * 12 + (d.month - 1);
