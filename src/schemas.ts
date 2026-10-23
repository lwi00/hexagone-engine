// Schémas des données initiales (état au 1er janvier 2026).
// Règles :
// - toute valeur factuelle porte une source ; une valeur non trouvée telle quelle est marquée
//   `estimate: true` avec la méthode dans `note` ;
// - les scores (satisfaction, popularité, tension, stabilité) sont TOUS sur l'échelle 0..1 ;
// - les effets budgétaires ciblent une ligne du budget (kind "budget"), jamais le déficit ou la dette,
//   qui sont dérivés par le moteur (voir DERIVED_INDICATORS) ;
// - aucune clé hors schéma (le validateur la refuse) : mettre les précisions dans `note`.
import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, 'YYYY-MM ou YYYY-MM-DD');
const fraction = z.number().min(0).max(1);

export const Source = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  accessed: isoDate,
});

export const Sourced = z.object({
  value: z.number(),
  unit: z.string().min(1),
  date: isoDate, // date de référence (grandeur annuelle N : "N-12" par convention)
  source: Source,
  estimate: z.boolean().default(false),
  note: z.string().optional(),
});
// Score 0..1 (satisfaction, popularité, tension, stabilité).
export const SourcedScore = Sourced.extend({ value: fraction, unit: z.literal('score 0-1') });

export const REGION_CODES = [
  '11', '24', '27', '28', '32', '44', '52', '53', '75', '76', '84', '93', '94', // métropole
  '01', '02', '03', '04', '06', // Guadeloupe, Martinique, Guyane, La Réunion, Mayotte
] as const;
export const RegionCode = z.enum(REGION_CODES);

// Groupes sociaux disjoints (la somme des parts de population adulte ≈ 1).
export const SOCIAL_GROUPS = [
  'retraites',
  'ouvriers_employes', // salariés du privé non cadres
  'cadres', // cadres et professions intellectuelles supérieures du privé
  'fonctionnaires',
  'independants', // artisans, commerçants, chefs d'entreprise, professions libérales
  'agriculteurs',
  'etudiants_jeunes',
  'chomeurs_inactifs',
] as const;
export const SocialGroup = z.enum(SOCIAL_GROUPS);

export const INDICATORS = [
  'pib_nominal', // Md€, annuel
  'croissance_pib', // %, annuelle
  'chomage_bit', // %
  'inflation', // %, glissement annuel IPC
  'deficit_public', // % du PIB
  'dette_publique', // % du PIB
  'dette_publique_md', // Md€
  'taux_oat_10', // %
  'spread_oat_bund', // points de base
  'population', // millions
  'taux_pauvrete', // %
  'prelevements_obligatoires', // % du PIB
  'depense_publique', // % du PIB
] as const;
export const IndicatorId = z.enum(INDICATORS);
// Calculés par le moteur à partir du budget et des taux : jamais ciblés directement par un effet.
export const DERIVED_INDICATORS = [
  'pib_nominal', 'deficit_public', 'dette_publique', 'dette_publique_md', 'taux_oat_10', 'spread_oat_bund',
  'prelevements_obligatoires', 'depense_publique', 'population',
] as const;

export const Notation = z.object({
  agence: z.enum(['S&P', 'Moody\'s', 'Fitch', 'DBRS', 'Scope']),
  note: z.string(), // ex. "A+", "Aa3"
  crans_sous_aaa: z.number().int().nonnegative(), // AAA/Aaa = 0, AA+/Aa1 = 1, …
  perspective: z.enum(['positive', 'stable', 'negative', 'surveillance_negative']),
  date: isoDate, // date de la dernière action avant le 1er janvier 2026
  source: Source,
});

export const Macro = z.object({
  indicators: z.record(IndicatorId, Sourced).refine((r) => INDICATORS.every((k) => k in r), 'tous les indicateurs sont requis'),
  stabilite: SourcedScore, // stabilité politique et institutionnelle au 1er janvier 2026
  tension_nationale: SourcedScore,
  notations: z.array(Notation).min(3),
});

export const RECETTES = [
  'tva', 'ir', 'is', 'csg', 'cotisations_sociales', 'ticpe', 'impots_locaux', 'droits_mutation', 'impots_patrimoine', 'autres',
] as const;
export const DEPENSES = [
  'retraites', 'sante', 'education', 'defense', 'interets_dette', 'securite', 'justice',
  'ecologie', 'collectivites', 'aides_sociales', 'autres',
] as const;
export const BUDGET_LINES = [...RECETTES.map((r) => `recettes.${r}`), ...DEPENSES.map((d) => `depenses.${d}`)];

export const Budget = z.object({
  scope: z.literal('APU'), // administrations publiques consolidées
  year: z.number().int(),
  context: z.string().min(1), // situation budgétaire réelle au 1er janvier 2026
  pib_reference_md: z.number(), // PIB nominal utilisé pour les ratios (cohérent avec macro.json)
  total_recettes: Sourced,
  total_depenses: Sourced,
  recettes: z.record(z.enum(RECETTES), Sourced),
  depenses: z.record(z.enum(DEPENSES), Sourced),
  mapping_notes: z.string(),
});

export const Region = z.object({
  code: RegionCode,
  name: z.string(),
  population: Sourced,
  pib_md: Sourced,
  pib_par_habitant: Sourced,
  chomage: Sourced,
  part_65_plus: Sourced,
  taux_pauvrete: Sourced,
  tension_initiale: SourcedScore,
  composition_sociale: z.object({
    parts: z.record(SocialGroup, fraction).refine((r) => SOCIAL_GROUPS.every((k) => k in r), 'tous les groupes sont requis'),
    source: Source,
    estimate: z.boolean(),
    note: z.string().optional(),
  }),
});
export const Regions = z.array(Region).length(18);

export const Group = z.object({
  id: SocialGroup,
  label: z.string(),
  part_population_adulte: Sourced, // fraction 0..1
  participation_electorale: Sourced, // fraction 0..1
  satisfaction_initiale: SourcedScore,
  vote: z.object({ // répartition du vote du groupe par parti (sociologie du vote)
    scrutin: z.string(),
    resultats: z.array(z.object({ party_id: z.string(), pct: z.number() })),
    source: Source,
    estimate: z.boolean(),
    note: z.string().optional(),
  }),
  description: z.string(),
});
export const Groups = z.array(Group).length(SOCIAL_GROUPS.length);

const Axis = z.number().min(-1).max(1);
export const Positionnement = z.object({
  economie: Axis, // -1 très à gauche (étatiste), +1 très libéral
  societal: Axis, // -1 progressiste, +1 conservateur
  europe: Axis, // -1 eurosceptique, +1 fédéraliste
});

const Rapport = z.enum(['majorite', 'soutien_conditionnel', 'opposition']);
export const ParliamentGroup = z.object({
  id: z.string(),
  nom: z.string(),
  sigle: z.string(),
  sieges: z.number().int().nonnegative(),
  parties: z.array(z.string()),
  positionnement: Positionnement,
  rapport_gouvernement: Rapport,
  discipline: fraction,
  note: z.string().optional(),
});

export const Politics = z.object({
  date: isoDate,
  president: z.object({ nom: z.string(), party_id: z.string(), depuis: isoDate, popularite: SourcedScore }),
  gouvernement: z.object({ premier_ministre: z.string(), depuis: isoDate, source: Source, note: z.string().optional() }),
  parties: z.array(z.object({
    id: z.string(), nom: z.string(), sigle: z.string(), positionnement: Positionnement,
    positionnement_estime: z.boolean(), note: z.string().optional(),
  })),
  assemblee: z.object({ total: z.literal(577), vacants: z.number().int(), groupes: z.array(ParliamentGroup), source: Source, note: z.string().optional() }),
  senat: z.object({ total: z.literal(348), vacants: z.number().int(), groupes: z.array(ParliamentGroup), source: Source, note: z.string().optional() }),
  intentions_vote: z.object({
    scrutin: z.string(),
    resultats: z.array(z.object({ party_id: z.string(), pct: z.number(), candidat: z.string().optional() })),
    source: Source,
    date: isoDate,
    estimate: z.boolean(),
    note: z.string().optional(),
  }),
  // Institutions (ENGINE.md §11) : législatives anticipées par blocs, profils de Premier ministre.
  institutions: z.object({
    dernieres_legislatives: isoDate, // second tour du dernier scrutin
    hors_blocs: z.array(z.string()), // groupes AN sans parti au sondage : sièges conservés aux législatives (implantation locale)
    blocs: z.array(z.object({
      id: z.string(), nom: z.string(),
      parties: z.array(z.string()).min(1), // party_id de intentions_vote
      groupes: z.array(z.string()).min(1), // groupes AN ; sièges du bloc répartis au prorata de leurs sièges initiaux
      barrage: z.boolean(), // front républicain au second tour (legislatives_barrage)
    })),
    majorite_presidentielle: z.array(z.string()).min(1), // ids de blocs, le premier = camp du Président
    coalitions_opposition: z.array(z.object({ id: z.string(), nom: z.string(), blocs: z.array(z.string()).min(1) })),
    profils: z.array(z.object({
      id: z.enum(['camp_presidentiel', 'ouverture_gauche', 'ouverture_droite', 'technicien']),
      label: z.string(), description: z.string(),
      rapports: z.record(z.string(), Rapport), // groupe absent = opposition
    })).length(4),
    note: z.string(),
  }),
});

// Catégories de politiques publiques : servent au vote heuristique (SPEC 3.5) et aux réactions des groupes.
export const PolicyTag = z.object({
  id: z.string().regex(/^[a-z_]+$/),
  label: z.string(),
  description: z.string(),
  axes: Positionnement, // direction d'une loi portant ce tag sur chaque axe
  reactions_groupes: z.array(z.object({ group: SocialGroup, direction: z.union([z.literal(1), z.literal(-1)]), intensite: z.enum(['faible', 'moyenne', 'forte']) })),
  justification: z.string(),
});
export const Tags = z.array(PolicyTag).min(8);

export const Magnitude = z.enum(['faible', 'moyenne', 'forte']);
// indicator : un indicateur non dérivé ; group : satisfaction du groupe ; region : tension de la région ;
// budget : ligne "recettes.x" ou "depenses.x" (Md€/an) ; prime_risque : points de base ajoutés au spread ;
// notation : crans (+1 = dégradation d'un cran) ; popularite, tension (nationale), stabilite : scores 0..1.
export const EffectTarget = z.object({
  kind: z.enum(['indicator', 'lever', 'group', 'region', 'budget', 'prime_risque', 'notation', 'stabilite', 'popularite', 'tension']),
  id: z.string().optional(),
});
// niveau : effet durable tant que la cause est active ; choc : effet temporaire qui s'éteint après duree_mois.
const Forme = z.enum(['niveau', 'choc']);

export const GameEventSeed = z.object({
  id: z.string(),
  date: isoDate,
  titre: z.string(),
  description: z.string(),
  categorie: z.enum(['international', 'economie', 'politique', 'social', 'securite', 'climat', 'sport_culture', 'sante']),
  certitude: z.enum(['survenu', 'programme']),
  // exogene : s'impose au joueur (guerre, catastrophe, décision d'une agence) et a des effets mécaniques ;
  // echeance : rendez-vous dont l'issue dépend du joueur (budget, vote, réforme) → aucun effet, juste un rappel.
  type: z.enum(['exogene', 'echeance']),
  effets: z.array(z.object({
    cible: EffectTarget,
    direction: z.union([z.literal(1), z.literal(-1)]),
    magnitude: Magnitude, // convertie par les coefficients "bareme.*"
    forme: Forme,
    duree_mois: z.number().int().positive(),
    note: z.string().optional(),
  })),
  sources: z.array(Source).min(1),
  note: z.string().optional(),
});
export const Events = z.array(GameEventSeed);

// Événements aléatoires (ENGINE.md §5b) : modèles tirés par le moteur, au plus un par mois.
// Probabilité du mois = proba_mensuelle × produit des multiplicateurs des conditions remplies.
export const RandomEventTemplate = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  titre: z.string(),
  description: z.string(),
  categorie: GameEventSeed.shape.categorie,
  depuis: isoDate, // premier mois possible
  proba_mensuelle: z.number().min(0).max(0.2),
  delai_min_mois: z.number().int().min(1), // délai avant un nouveau tirage du même modèle
  mois: z.array(z.number().int().min(1).max(12)).optional(), // saisonnalité
  // Variable : indicateur national (popularite, tension, stabilite, deficit_public, spread_oat_bund…) ou "groupe:<id>" (satisfaction).
  conditions: z.array(z.object({
    variable: z.string(),
    op: z.enum(['>', '<']),
    seuil: z.number(),
    multiplicateur: z.number().positive(),
  })),
  // Région touchée, tirée selon sa population ou sa tension : les effets de cible "region" sans id la visent.
  region: z.enum(['population', 'tension']).optional(),
  effets: GameEventSeed.shape.effets,
  // Dilemme (ENGINE.md §5c) : le joueur choisit une réponse, dont les effets s'ajoutent à ceux de l'événement. Le premier choix
  // est la réponse par défaut, appliquée si le mois s'achève sans décision.
  choix: z.array(z.object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    label: z.string(),
    description: z.string(),
    effets: GameEventSeed.shape.effets,
  })).min(2).max(3).optional(),
  justification: z.string(),
});
export const RandomEvents = z.array(RandomEventTemplate);

export const Lever = z.object({
  id: z.string().regex(/^[a-z0-9_.]+$/),
  label: z.string(),
  categorie: z.enum(['fiscalite', 'social', 'travail', 'retraites', 'depenses', 'energie', 'regulation', 'fonction_publique']),
  unit: z.string(),
  min: z.number(),
  max: z.number(),
  valeur_initiale: Sourced,
  description: z.string(),
  // Effet d'une variation d'une unité du levier par rapport à sa valeur initiale.
  // Les effets de demande (multiplicateur) sur la croissance sont calculés par le moteur à partir des lignes
  // budgétaires : un effet "indicator:croissance_pib" ne décrit que l'effet d'offre ou structurel.
  effets: z.array(z.object({
    cible: EffectTarget,
    elasticite: z.number(),
    unite_effet: z.string(),
    forme: Forme,
    delai_mois: z.number().int().nonnegative(), // avant le début de l'effet
    rampe_mois: z.number().int().nonnegative(), // montée linéaire jusqu'à l'effet plein (0 = immédiat)
    duree_mois: z.number().int().positive().optional(), // requis si forme = choc
    hypothese: z.boolean(),
    justification: z.string(),
    source: Source.optional(),
  })),
  groupes_touches: z.array(z.object({ group: SocialGroup, direction: z.union([z.literal(1), z.literal(-1)]), intensite: Magnitude })),
  note: z.string().optional(),
});
export const Levers = z.array(Lever).min(30);

export const Coefficient = z.object({
  id: z.string(),
  value: z.number(),
  unit: z.string(),
  description: z.string(),
  hypothese: z.boolean(),
  justification: z.string(),
  source: Source.optional(),
});
export const Coefficients = z.array(Coefficient);

const BAREME_KINDS = ['croissance', 'chomage', 'inflation', 'pauvrete', 'satisfaction', 'popularite', 'tension', 'stabilite', 'budget', 'prime_risque'];
// Coefficients dont le moteur de la phase 1 a besoin (SPEC 3.3–3.4). D'autres peuvent exister en plus.
export const REQUIRED_COEFFICIENTS = [
  // macro
  'croissance_potentielle', 'deflateur_pib_tendance', 'okun_coefficient', 'chomage_structurel', 'chomage_rappel_structurel',
  'multiplicateur_depenses_court_terme', 'multiplicateur_prelevements_court_terme', 'cible_inflation_bce', 'inertie_inflation',
  'elasticite_tva_autres_po', 'elasticite_ir_csg', 'elasticite_is', 'elasticite_cotisations',
  // dette et taux
  'taux_apparent_dette', 'duree_vie_moyenne_dette', 'part_dette_refinancee_mois', 'taux_reference_bund_initial',
  'spread_constante', 'spread_sensibilite_dette', 'spread_sensibilite_deficit', 'spread_sensibilite_stabilite', 'spread_degradation_note',
  // indexations automatiques
  'smic_seuil_revalorisation_inflation', 'pensions_indexation_inflation',
  // satisfaction des groupes (cible = combinaison pondérée, puis inertie)
  'satisfaction_amortissement', 'satisfaction_poids_pouvoir_achat', 'satisfaction_poids_emploi', 'satisfaction_poids_lois', 'satisfaction_poids_evenements',
  'popularite_inertie', 'popularite_poids_lois_impopulaires',
  // intentions de vote
  'vote_inertie', 'vote_sensibilite_satisfaction',
  // tension
  'tension_inertie', 'tension_poids_chomage', 'tension_poids_insatisfaction', 'tension_poids_lois_impopulaires',
  'seuil_tension_greves', 'seuil_tension_greve_generale', 'greves_effet_croissance',
  // stabilité
  'stabilite_inertie', 'stabilite_poids_tension', 'stabilite_poids_popularite', 'stabilite_poids_spread', 'stabilite_poids_cohesion_majorite', 'stabilite_cohesion_perte_max', 'stabilite_cohesion_gain_max',
  // parlement (ENGINE.md §4)
  'parlement_poids_axes', 'parlement_bonus_majorite', 'parlement_bonus_soutien_conditionnel', 'parlement_bonus_opposition',
  'parlement_poids_popularite', 'parlement_poids_accueil_populaire', 'parlement_pente', 'parlement_abstention_base', 'parlement_limite_493',
  'parlement_incertitude_groupe', 'parlement_incertitude_commune',
  'censure_seuil', 'censure_choc_stabilite', 'censure_malus_493',
  // relations et rapports (ENGINE.md §13)
  'parlement_relation_majorite', 'parlement_relation_soutien', 'parlement_relation_opposition', 'parlement_relation_seuil_soutien',
  'parlement_relation_seuil_majorite', 'parlement_relation_hysteresis', 'parlement_relation_retour', 'parlement_relation_par_loi',
  'parlement_relation_493', 'parlement_relation_poids_popularite', 'parlement_relation_memoire', 'parlement_relation_cout_rupture',
  'parlement_relation_fidelite', 'parlement_relation_dissolution',
  // fin de partie anticipée (ENGINE.md §10)
  'defaite_mois_consecutifs', 'defaite_spread_seuil', 'defaite_stabilite_seuil', 'defaite_tension_seuil', 'spread_non_lineaire_deficit',
  // institutions (ENGINE.md §11)
  'legislatives_exposant', 'legislatives_barrage', 'legislatives_ancrage_local', 'legislatives_incertitude', 'legislatives_effet_popularite',
  'legislatives_prime_popularite', 'dissolution_choc_stabilite', 'dissolution_duree_choc_mois', 'dissolution_delai_mois', 'parlement_malus_cohabitation',
  // barème qualitatif faible | moyenne | forte (SPEC 3.2), par type de cible
  ...BAREME_KINDS.flatMap((k) => ['faible', 'moyenne', 'forte'].map((m) => `bareme.${k}.${m}`)),
];
