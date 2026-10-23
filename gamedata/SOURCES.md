# Sources des données initiales — Hexagone

État de la France au **1er janvier 2026**, collecté le 2026-10-20 (`accessed` de toutes les sources).
Format imposé par `src/schemas.ts` (schéma v2), validé par `npm run validate` (fichiers + cohérences croisées).

## Conventions communes (schéma v2)

- **Valeur sourcée** (`Sourced`) : `value`, `unit`, `date`, `source {url, title, accessed}`, `estimate`, `note`.
- **Dates** : le schéma accepte `YYYY-MM` ou `YYYY-MM-DD`. Pour une grandeur annuelle, `YYYY-12` signifie « année YYYY » (ex. `2025-12` = moyenne ou total 2025). Une date `2026-01-01` est un stock au 1er janvier.
- **`estimate: true`** : la valeur n'existe pas telle quelle dans la source. Elle est calculée ou approchée, et `note` donne la méthode.
- **`hypothese: true`** (leviers, coefficients) : coefficient posé faute de source, justifié dans `justification`.
- **Aucune clé hors schéma** : le validateur refuse toute clé inconnue (zod la supprimerait en silence). Les précisions vont dans les champs `note`.
- **Scores** : satisfaction, popularité, tension et stabilité sont TOUS sur l'échelle 0..1 (`unit: "score 0-1"`). Un effet sur un score s'exprime en points de score 0-1 (−0,03 = −3 points de pourcentage).
- **Effets budgétaires** : cible `kind: "budget"`, id `recettes.<poste>` ou `depenses.<poste>` (listes `RECETTES` / `DEPENSES` de `schemas.ts`), en Md€/an, périmètre APU, signe positif = la ligne augmente (une hausse d'impôt est donc positive sur la recette). Jamais d'effet direct sur les indicateurs dérivés (`DERIVED_INDICATORS` : déficit, dette, taux, spread, PIB nominal, PO, dépense publique, population) : une prime de risque passe par `kind: "prime_risque"` (pb), une action d'agence par `kind: "notation"` (crans, +1 = dégradation).
- **Croissance** : un effet `indicator:croissance_pib` porte sur le **niveau** du PIB en volume (en %) et ne décrit que l'effet d'offre ou structurel. L'effet de demande est calculé par le moteur via les multiplicateurs appliqués à l'impulsion discrétionnaire des lignes budgétaires.
- **Inflation** : un effet `indicator:inflation` porte sur le **niveau** de l'indice des prix (en %), visible 12 mois dans le glissement annuel. Chômage et pauvreté : décalages additifs du taux, en points.
- **Temps** : `forme: "niveau"` (durable tant que la cause est active) ou `"choc"` (retiré après `duree_mois`) ; leviers : `delai_mois`, `rampe_mois` (montée linéaire), `duree_mois` requis pour un choc.
- **Barème qualitatif** (événements, `groupes_touches` des leviers) : `faible | moyenne | forte`, converti par les coefficients `bareme.<kind>.<magnitude>` (voir coefficients.json). `bareme.notation.*` (1/2/3 crans) est un coefficient supplémentaire : `notation` n'est pas dans `BAREME_KINDS`.
- **Calage à t0** : toutes les équations d'opinion (satisfaction, popularité, vote, tension, stabilité) sont écrites en écart à l'état initial ou avec une constante de calage : sans action du joueur ni événement, l'état du 1er janvier 2026 est un point fixe.
- **Bases comptables** : les comptes 2025 de l'Insee (mai 2026) sont en base 2020. Le RESF du PLF 2026 (octobre 2025) et la ventilation COFOG 2024 sont en base 2014. Les niveaux ne sont donc pas strictement comparables (voir `budget.mapping_notes`).
- **Réformes** (`reformes.json`, ENGINE.md §14) : les élasticités des effets sont exprimées **par Md€ 2026 de recette en plus** (d > 0 ; une suppression d'impôt a d < 0 et inverse les effets), et les `groupes_touches` sont donnés **dans le sens d > 0** (multipliés par le signe de d par le moteur). Aucun effet `budget` : les montants passent par le moteur (`montantsReformes`).
- **Sources secondaires** : utilisées seulement quand la source primaire était inaccessible (erreur 403, PDF illisible, quota de recherche épuisé). Elles sont signalées dans les notes.

## Grandeurs partagées entre fichiers (vérifiées identiques)

| Grandeur | Valeur | Où |
|---|---|---|
| Population au 01/01/2026 | 69,066 M (69 066 941) | `macro.population` = somme de `regions[].population`. `groups` part de 69 081 996 (estimation de janvier, avant le recensement de Mayotte) ; l'écart, inférieur à 0,02 %, est documenté dans les notes. |
| Déficit public 2025 | 5,1 % du PIB (152,5 Md€) | `macro`, `budget.context`/`mapping_notes`, `coefficients.spread_constante` |
| Dette publique fin 2025 | 115,7 % du PIB, 3 460,5 Md€ | `macro`, `budget.context`, `coefficients.spread_constante`, `coefficients.taux_apparent_dette` |
| Dépense publique 2025 | 57,3 % du PIB (1 714,2 Md€) | `macro`, `budget.mapping_notes` |
| Charge d'intérêts 2025 | 64,7 Md€ | `macro.deficit_public.note`, `budget.depenses.interets_dette.note`, `coefficients.taux_apparent_dette` |
| TEC 10 / écart OAT-Bund au 31/12/2025 | 3,56 % / 70 pb (Bund ≈ 2,86 %) | `macro`, `coefficients.spread_constante`, `coefficients.taux_reference_bund_initial` |
| Chômage BIT | 7,9 % (T4 2025) | `macro`, `coefficients.chomage_structurel`. `groups` utilise la moyenne annuelle 2025 (7,7 %), un concept différent. |
| Smic au 01/01/2026 | 12,02 €/h, 1 823,03 € brut/mois | `levers.travail.smic` (seule occurrence ; revalorisation automatique du 01/06/2026 à 12,31 €/h appliquée par la règle `smic_seuil_revalorisation_inflation`, pas par un événement) |
| PIB de référence 2026 | 3 066,3 Md€ | `budget.pib_reference_md` = PIB 2025 de `macro` × 1,010 × 1,015 (RESF) |
| Charge d'intérêts 2026 | 73,6 Md€ (2,4 % du PIB) | `budget.depenses.interets_dette` ; `coefficients.taux_apparent_dette` (2,01 %) est calé pour que la simulation de 2026 la reproduise |
| Popularité du Président | 0,18 (score 0-1) | `politics.president.popularite` = moyenne de `groups[].satisfaction_initiale` pondérée par `part_population_adulte` |
| Stabilité / tension nationale | 0,38 / 0,45 (scores 0-1) | `macro` ; moyenne des `regions[].tension_initiale` pondérée par la population ≈ 0,454 (constante de calage k ≈ −0,004) |
| Âge légal / durée | 62 ans 9 mois / 170 trimestres (suspension de la réforme, LFSS 2026) | `levers.retraite.*`, `budget.context` |

**Budget et macro.** `budget.total_depenses` (57,1 % du PIB 2026) se compare à `macro.depense_publique` (57,3 % en 2025). `budget.total_recettes` (52,3 %) correspond aux **recettes publiques totales** (52,2 % en 2025), pas au taux de prélèvements obligatoires (43,6 %). La différence vient des cotisations imputées, des crédits d'impôt bruts et des recettes non fiscales. Les ratios du RESF sont appliqués à `pib_reference_md` (3 066,3 Md€, projection du PIB 2025 de `macro` à la croissance et au déflateur du RESF) et non plus au PIB du RESF (3 061 Md€, base 2014). Déficit 2026 implicite : 151,0 Md€, soit 4,92 % du PIB.

---

## macro.json — 13 indicateurs nationaux

- **Contenu** : PIB, croissance, chômage BIT, inflation, déficit, dette (en % et en Md€), taux OAT 10 ans, écart OAT-Bund, population, pauvreté, prélèvements obligatoires, dépense publique.
- **Sources principales** :
  - Insee : Insee Première n° 2105 et n° 2106 (comptes 2025, 29/05/2026), « Finances publiques en 2025 » (8988841), Informations rapides chômage T4 2025 et IPC de décembre 2025, estimations de population au 01/01/2026 (8687895, 24/09/2026), série du taux de pauvreté (2408282).
  - Banque de France : indices obligataires au 31/12/2025 (TEC 10).
  - BNP Paribas EcoWeek n° 26.03 (source secondaire) pour le Bund.
- **Périmètres** : chômage France hors Mayotte (CVS) ; population France entière, Mayotte comprise (recensement 2026) ; pauvreté France métropolitaine, ERFS 2024 ; prélèvements obligatoires hors cotisations imputées et nets des crédits d'impôt.
- **Dates** : les grandeurs annuelles 2025 sont datées `2025-12`, la pauvreté `2024-12`, les stocks `2025-12-31` ou `2026-01-01`.
- **Estimations** : `spread_oat_bund` (TEC 10 Banque de France moins un Bund reconstitué à partir de BNP Paribas, ±1 pb).
- **v2** : `stabilite` = 0,38 (moyenne de 5 composantes : marge parlementaire, rotation gouvernementale, absence de LFI, popularité, continuité institutionnelle ; scrutin n° 3058) et `tension_nationale` = 0,45 (4 composantes, minorée faute de mouvement social en cours au 01/01/2026), scores 0-1 `estimate: true`, incertitude ±0,1. `notations` : S&P A+ stable (4 crans), Moody's Aa3 négative (3), Fitch A+ stable (4), DBRS AA stable (2), Scope AA- négative (3), sources de presse vérifiées (aucun communiqué d'agence lu en entier).
- **Réserve** : la notification Eurostat du 21/10/2026 peut réviser le déficit et la dette 2025.

## budget.json — budget 2026 des APU consolidées

- **Contenu** : contexte budgétaire au 01/01/2026 (pas de LFI : loi spéciale n° 2025-1316 ; LFSS 2026 n° 2025-1403 adoptée ; la LFI n° 2026-103 du 19/02/2026 n'est décrite qu'à titre informatif, c'est au joueur de la faire voter), `pib_reference_md`, totaux, **10 postes de recettes** (tva, ir, is, csg, cotisations_sociales, ticpe, impots_locaux, droits_mutation, impots_patrimoine, autres) et **11 postes de dépenses**, en Md€, `mapping_notes`.
- **Sources principales** : RESF annexé au PLF/PLFSS 2026 (DG Trésor, octobre 2025, onglet « Annexe macro » tableaux 1-2 et « Annexe finances publiques » tableaux 17 et 19) ; Insee, impôts APU 2025 (xlsx, 28/08/2026) ; OFGL, rapport 2026 (DMTO des collectivités) ; Insee, COFOG 2024 (T_3301, T_3307) ; Insee Première n° 2106 ; OFCE (contenu de la LFI 2026) ; dossiers législatifs de l'Assemblée ; décision du Conseil constitutionnel 2025-899 DC (ONDAM).
- **Conventions** : `year` = 2026. Recettes 52,3 % et dépenses 57,1 % du PIB (+3,9 Md€ d'ONDAM voté) appliqués à `pib_reference_md`. Nouveaux postes de recettes (montants 2025 × 1,0331) : `impots_locaux` = taxe foncière + CFE + CVAE + TH résiduelle (60,9) ; `droits_mutation` = DMTG + DMTO des collectivités (39,0) ; `impots_patrimoine` = IFI + TTF (5,4). La CDHR est un impôt D.51 compris dans `ir`. L'IS (67,8) inclut la reconduction de moitié de la contribution exceptionnelle prévue au PLF (≈ 4 Md€, non acquise au 1er janvier). Intérêts 73,6 Md€ (2,4 % du PIB, RESF).
- **Estimations** : toutes les valeurs (prévision appliquée à une ventilation antérieure). CDHR (≈ 0,4 Md€) et TTF (≈ 2,5 Md€) reposent sur des sources secondaires.
- **Limites** : prévision du PLF initial, sans les votes parlementaires. Coût de la suspension de la réforme des retraites (0,1 à 0,4 Md€ en 2026) non ajouté. Bases comptables mélangées (RESF base 2014, Insee base 2020). COFOG 2025 non publiée avant décembre 2026.

## regions.json — 18 régions (13 de métropole et 5 DROM)

- **Contenu** : population, PIB, PIB par habitant, chômage, part des 65 ans et plus, taux de pauvreté, **`tension_initiale`** (score 0-1) et **`composition_sociale`** (parts des 8 groupes, somme 1).
- **Sources principales** (toutes Insee) : estimations de population au 01/01/2026 (13/01/2026) et recensement de Mayotte (07/07/2026, page 9022279) ; PIB régional TCR_062 (12/05/2026) ; taux de chômage localisés du T4 2025 (Informations rapides n° 65) ; Filosofi 2023 ; France, portrait social 2020 (4797606) ; Insee Flash Mayotte n° 199 et n° 215.
- **Conventions** : PIB 2024 provisoire, sauf Mayotte (2023). Le PIB de la Guadeloupe inclut Saint-Martin. Pauvreté au seuil de 60 % de la médiane : Filosofi 2023 pour la métropole et La Réunion ; Filosofi 2021 pour la Martinique ; Budget de famille 2017 (seuil métropolitain) pour la Guadeloupe, la Guyane et Mayotte, des valeurs non comparables entre elles. La moyenne métropolitaine Filosofi (15,9 %) diffère de l'ERFS de `macro` (15,4 %).
- **Estimations** : `part_65_plus` des 18 régions (somme des tranches quinquennales Insee ; pour Mayotte, sur l'estimation antérieure au recensement) ; `chomage` de Mayotte (BIT moyen 2025, et non taux localisé du T4).
- **`composition_sociale`** (v2, `estimate: true`) : part nationale de `groups.json` × (indicateur régional / indicateur France), indicateurs des dossiers complets Insee RP2023 (POP T7, FOR T1, EMP T8) ; chômeurs/inactifs = reste ; fonctionnaires approchés par l'emploi administration-enseignement-santé-action sociale × 0,6644. La moyenne pondérée retombe sur `groups.json` à 0,002 près. Mayotte : estimation directe (Insee Flash Mayotte n° 214 et 215, CSSM), répartition de l'emploi privé supposée.
- **`tension_initiale`** (v2, `estimate: true`) : 0,45 + 0,008 × (chômage − 7,9) + 0,002 × (pauvreté − 15,4) + majoration pour un mouvement social ou une crise en cours au 01/01/2026 (Martinique +0,05, Mayotte +0,05 pour la crise de l'eau), bornée à 0,58 sans mouvement en cours. Résultats : métropole 0,43-0,47, Guadeloupe et Martinique 0,56, Guyane 0,58, La Réunion 0,56, Mayotte 0,76 (seule région au-dessus de `seuil_tension_greves` = 0,6, choix délibéré). Coefficients de la formule = jugements, pas des estimations économétriques.

## groups.json — 8 groupes sociaux disjoints

- **Contenu** : part de la population adulte (18 ans et plus), participation électorale, **`satisfaction_initiale`** (score 0-1), **`vote`** (sociologie du vote par parti), description de la méthode.
- **Sources principales** : Insee, pyramide des âges au 01/01/2026 (POP3, 18 ans et plus = 55,229 M) ; enquête Emploi 2025 (IP2096, Insee Première n° 2096) ; agents publics fin 2024 (IP2094) ; DREES, retraités fin 2024 ; SIES, effectifs étudiants 2025-26 (data.enseignementsup-recherche.gouv.fr) ; Insee, participation électorale 2022 (IP1928).
- **Conventions** : le dénominateur compte tous les résidents adultes, étrangers compris, ce qui surestime le poids électoral des ouvriers et employés et des chômeurs et inactifs. `chomeurs_inactifs` est un reste. La participation est la moyenne par tour sur les 4 tours de 2022 (« systématique + ½ intermittent », recalée par ×1,041 sur 62,5 %). Le champ `date` vaut `2026-01`, et la date de référence réelle figure en tête de chaque note.
- **Estimations** : **les 16 valeurs** (parts et participations des 8 groupes). Elles sont construites, aucune n'est publiée telle quelle. Les plus fragiles sont les 1,5 M de cadres publics (fourchette de 1,3 à 1,8 M), les 628 500 apprentis du supérieur (non vérifiés) et la participation des étudiants, des fonctionnaires et des retraités.
- **`satisfaction_initiale`** (v2, `estimate: true`) : part de « satisfaits » d'Emmanuel Macron par catégorie dans le baromètre Ifop-JDD (septembre vague 2, octobre et novembre 2025, pondérées par l'échantillon ; pas de vague en décembre), recalée × 1,096 pour que la moyenne pondérée par `part_population_adulte` égale la popularité de `politics.json` (0,18). Agriculteurs : valeur des indépendants × 0,7 (décote non mesurée, Mercosur et dermatose nodulaire).
- **`vote`** (v2, `estimate: true`) : sondage Ipsos jour du vote des européennes du 09/06/2024 ; agriculteurs : note Cevipof de mai 2024. Liste PS-PP répartie 50/50, liste Renaissance-MoDem-Horizons au prorata des sièges à l'AN. Structure relative seulement : à t0 les intentions nationales viennent de `politics.intentions_vote` (calage multiplicatif, voir `coefficients.vote_inertie`).

## politics.json — paysage politique au 01/01/2026

- **Contenu** : Président (popularité 0,18, score 0-1), gouvernement Lecornu II (depuis le 10/10/2025), 17 partis positionnés sur 3 axes, Assemblée (12 groupes, 2 sièges vacants), Sénat (9 groupes), intentions de vote pour le 1er tour de 2027.
- **Sources principales** : Légifrance (décret de nomination) ; Conseil constitutionnel (2017-171 PDR) ; Assemblée nationale (effectifs dans une capture Wayback du 01/01/2026, scrutins n° 3058 et 3059) ; senat.fr (groupes au 06/12/2025, capture Wayback) ; Ipsos bva / La Tribune Dimanche (popularité, décembre 2025) ; Odoxa et Verian (sondages des 18-20/11/2025, notices de la Commission des sondages) ; Chapel Hill Expert Survey 2024 (CSV, github) ; datan.fr (cohésion des groupes) ; Wikipédia (sources secondaires signalées).
- **Conventions** : popularité = fraction d'opinions favorables (score 0-1). Axes CHES convertis : économie = (lrecon−5)/5, sociétal = (galtan−5)/5, Europe = (eu_position−4)/3 ; `positionnement_estime` indique les 8 partis absents du CHES. Discipline à l'Assemblée = taux de cohésion datan.fr lu sur des captures Wayback antérieures au 01/01/2026 (DR : capture du 19/02/2025). Les anciennes clés hors schéma (`contexte`, `sources_complementaires`, etc.) sont reversées dans les `note` (motions de censure, présidents des assemblées, popularité du Premier ministre 0,29).
- **Estimations** : `intentions_vote` (moyenne Odoxa/Verian, `estimate: true`) ; positionnement de PP, UDR, LIOT, UDI, Radicaux, LO et DLF (absents du CHES) ; `rapport_gouvernement` de chaque groupe ; discipline des groupes du Sénat ; non-inscrits du Sénat (pondération 3/4 RN, 1/4 Reconquête).

## events-2026.json — 53 événements réels de 2026

- **Contenu** : 35 événements **exogènes** (avec effets) et 18 **échéances** (sans effet : rendez-vous dont l'issue dépend du joueur, y compris les décisions présidentielles réelles puisque le joueur est le Président), du 01/01 au 17/12/2026.
- **Président générique (phase 1.1)** : `titre` et `description` sont lus par le joueur. Ils ne nomment pas le Président réel et ne contiennent aucune note de conception. Les décisions réelles du Président ou du gouvernement (doctrine de dissuasion, réponse militaire à la guerre contre l'Iran, budget 2026, soutien carburant, PLF 2027, Corse, loi agricole…) sont des échéances formulées comme des décisions attendues. Ce qui s'est réellement passé, et les résultats réels des scrutins simulés par le moteur (municipales, sénatoriales), sont dans `note` (« Réel : … », « Conception : … »). L'id `macron_charles_de_gaulle` devient `reponse_militaire_iran`. Les titres des sources gardent leur libellé d'origine.
- **Sources principales** : Insee, BCE, Assemblée nationale, senat.fr, Élysée, LCP, Public Sénat, franceinfo, France 24, Euronews, Börsen-Zeitung (Scope, DBRS), France Épargne (spread record), info.gouv.fr (Smic), Wikipédia « 2026 en France ». Agences de notation citées via la presse (Selectra, Bourse Direct).
- **Conventions v2** : direction +1 = la cible augmente ; pour `region`, la cible est la **tension** de la région (+1 = plus de tension, sens inversé par rapport à la v1). Plus aucun effet sur le déficit, la dette, les taux ou le spread : prime de risque exogène seulement pour l'aversion au risque internationale (guerre en Iran, perspective DBRS) ; Scope = `kind: "notation"`, id `Scope`, +1 cran, forme niveau 60 mois. Pas d'effet de popularité quand l'événement passe déjà par la satisfaction d'un groupe. Les publications statistiques ne sont plus des événements : leurs valeurs (chômage T2 8,3 %, PIB T2 0,0 %, IPC août 2,4 %, septembre 3,1 %, spread 124 pb le 30/09) servent de points de contrôle.
- **Calage phase 0.5** (simulation à sec) : inflation de `guerre_iran_debut` prolongée de 9 à 12 mois et `reprise_guerre_iran` passée de moyenne à forte (Brent au-dessus de 100 $ jusqu'en octobre ; +50 à +70 $ × 0,33 % par 10 € ≈ +1,5 à +2 % sur le niveau des prix) ; tension directe de `pic_petrole_mars` ramenée à faible (double compte avec la satisfaction des groupes, franchissement du seuil de grèves en mars sans mouvement documenté).
- **Estimations / hypothèses** : **toutes les magnitudes et durées d'effets** sont des choix de calibrage (le schéma n'a pas de drapeau `hypothese` pour les effets d'événements). Plusieurs faits reposent sur une seule source secondaire (S&P du 29 mai, vote sur la Corse, loi agricole, DBRS). Issues inconnues au 20/10/2026 (Moody's 23/10, S&P 27/11, BCE d'octobre et décembre) : effets vides, à mettre à jour.

## levers.json — 48 leviers de politique publique (136 effets)

- **Contenu** : fiscalité (TVA ×4, IR, IS, CSG, PFU, cotisations patronales et salariales, IFI, CDHR, contribution exceptionnelle IS, TTF, droits de succession, taxe foncière, heures supplémentaires), énergie (accises gazole et électricité, TRVE), social (RSA, allocations familiales, APL, ASPA, prime d'activité), retraites (âge, durée, taux plein, indexation), travail (Smic, durée légale, indemnisation chômage), fonction publique (effectifs, point d'indice), dépenses (9 leviers `depenses.<poste>` + `depenses.recherche`), régulation (taux du livret A).
- **Sources principales** : Légifrance (décret Smic 2025-1228, CIBS L312-35, décret RSA 2025-293, LFSS 2025-1403, LFI 2026-103, arrêté livret A) ; DG Trésor (Mésange 2017, Trésor-Éco n° 371, rendements TVA) ; Cour des comptes / Sénat (r24-901 : cotisations, indexation, retraites) ; annexe Voies et moyens du PLF 2026 ; Insee (impôts APU 2025) ; Cnaf (prime d'activité) ; service-public.fr ; CRE ; Unédic.
- **Conventions v2** :
  - Effets budgétaires sur la ligne concernée (`recettes.*` / `depenses.*`), en Md€/an APU, positif = hausse de la ligne. Rendements recalés sur `budget.json` : IR 1,0 Md€ par % d'impôt, IS 1,9 Md€ par point (2,55 mécanique − taux réduit − 20 % de réponse de l'assiette), TVA taux normal 7,5 Md€ par point (rendement net DG Trésor), CSG activité 12 Md€ par point, TTF 6,45 Md€ par point, IFI 0,028 Md€ par %, taxe foncière 0,46 Md€ par %.
  - Croissance : effets d'offre sur le niveau du PIB seulement (IS, cotisations patronales, âge légal, durée de cotisation, durée légale, recherche) ; effets de demande supprimés.
  - Inflation : forme niveau sur l'indice des prix (TVA, accises, cotisations, Smic, TRVE).
  - Groupes : effet `group` = `satisfaction_poids_pouvoir_achat` (0,015) × variation du revenu disponible du groupe en %, seulement pour les leviers qui ne passent pas déjà par les indices de revenu du moteur (pas sur Smic, pensions, point d'indice).
  - Popularité et tension à l'annonce : chocs de 6 mois (12 pour retraites, durée légale, accise gazole).
- **Contrôle croisé (phase 0.5)** : Σ rendements par point des 4 taux de TVA × taux ≈ 178 Md€ pour 215,7 Md€ de TVA APU (≈ 82 %, cohérent avec un rendement net de la TVA payée par les APU) ; CSG activité 12 × 9,2 ≈ 110 Md€ + capital 10,6 Md€ pour 161,8 Md€ (reste ≈ revenus de remplacement) ; IFI + TTF = 5,38 ≈ `impots_patrimoine` 5,4 ; accise gazole 0,31 × 60,75 ≈ 18,8 Md€ sur 31,5 Md€ de TICPE. Écart non résolu : cotisations patronales 6,2 Md€ par point contre 7,6 pour les salariales (sources différentes de la Cour des comptes, la première probablement nette des retours) ; indexation des pensions 2,9 Md€ par point = régimes de base seulement.
- **Hypothèses (107 effets `hypothese: true`)** : répartition du coût du Smic, clé fonction publique par versant (44/35/21 %), effets de popularité et de tension, effets group, élasticités linéaires (surestimées pour de grands écarts sur TTF, successions, taux marginal, IFI).

## coefficients.json — 94 paramètres du moteur

- **Contenu** : croissance potentielle et déflateur, Okun et chômage structurel, multiplicateurs budgétaires, inflation (inertie, Phillips, pétrole), élasticités des recettes et solde conjoncturel, spread OAT-Bund, dette (taux apparent, refinancement), indexations (Smic, pensions), satisfaction, popularité, vote, tension, grèves, stabilité, et le **barème** `bareme.<kind>.<faible|moyenne|forte>` pour croissance, chômage, inflation, pauvreté, satisfaction, popularité, tension, stabilité, budget, prime de risque et notation. Chaque description donne l'équation mensuelle exacte attendue du moteur.
- **Sources principales** : DG Trésor (document de travail 2025/2, PSMT d'octobre 2024, tableau 7) ; Insee/DG Trésor (Mésange, DT Insee 2024-07) ; OFCE (avril 2026) ; BCE (30/06/2025) ; Banque de France (WP 494, billets n° 331 et 465, pétrole 15/10/2026) ; AFT (bulletin n° 434, lu par extraits) ; Sénat (rapport PLF 2026, Engagements financiers) ; Insee (définition du Smic) ; Cnav (circulaire 2024-39).
- **Valeurs calées** : `taux_apparent_dette` = 2,01 % (12 mois simulés → 73,6 Md€ d'intérêts en 2026) ; `part_dette_refinancee_mois` = 0,0054 (175,8 Md€ d'amortissements / 2 737 Md€ de dette négociable / 12) ; `spread_constante` = 70 pb ; `vitesse_transmission_taux` supprimé.
- **Ajouts phase 0.5** : `bareme.notation.*` = 1/2/3 crans ; `spread_poids_agence_secondaire` = 0,5 (DBRS, Scope) ; seuil de grèves régional `max(0,6 ; T0_r + 0,15)` (au lieu de + 0,05, plus faible que `bareme.tension.moyenne`) ; initialisation de l'historique de ḡ (Okun) à la croissance potentielle et de la moyenne glissante du déficit (spread) au déficit 2025.
- **Barème** (hypothèses de jeu, effet présent chaque mois où il est actif) : croissance 0,1/0,25/0,5 % du niveau du PIB ; chômage 0,05/0,15/0,3 pt ; inflation 0,1/0,3/0,8 % du niveau des prix ; pauvreté 0,1/0,3/0,6 pt ; satisfaction 0,02/0,05/0,10 ; popularité 0,01/0,03/0,06 ; tension 0,03/0,07/0,15 ; stabilité 0,02/0,05/0,10 ; budget 1/5/15 Md€/an ; prime de risque 5/15/40 pb ; notation 1/2/3 crans. Échelle cohérente avec les leviers (ex. âge légal +1 an : popularité −0,03 = moyenne, tension +0,06 ≈ moyenne ; 1 point de CSG : satisfaction −0,016 ≈ faible ; 1 point de TVA : 7,5 Md€ entre moyenne et forte).
- **Réformes (ENGINE.md §14)** : `reforme_satisfaction_max` (0,15) et 7 coefficients `referendum_*` (poids de popularité 4, pivot 0,35, poids des consignes 1, incertitude 0,3, campagne 2 mois, chocs 6 mois, relation −0,1), tous `hypothese: true`, recoupés dans le banc (1969, 1992, 2000, 2005).
- **Coefficients `hypothese: true`** : 66 sur 94 (poids d'opinion, inerties, barème, Okun, Phillips, seuils, durée de vie de la dette tant que le PDF AFT n'est pas lu directement…).

### Simulation papier (phase 0.5)

Script reproductible dans le scratchpad de la session (`papersim.cjs`), équations des descriptions de `coefficients.json`, sans action du joueur :
- **Sans événement, 3 mois** : croissance annualisée 0,7 % (1,2 % potentielle − rampe de `impact_politique_budgetaire_2026`), chômage 7,90 → 7,90 %, inflation 0,87 → 0,89 %, dette 115,98 → 116,49 % du PIB, taux apparent 2,02 → 2,05 %, spread 70,5 → 71,4 pb. Opinion au point fixe (popularité = Σ satisfaction pondérée = 0,180 ; cohésion 0,737 ; aucune région au-dessus de son seuil de grèves). **Stable.**
- **Sans événement, 12 mois** : intérêts 2026 ≈ 73,6 Md€, dette ≈ 117,9 % du PIB, spread ≈ 74 pb, inflation 1,26 % (π sous-jacente 1,50 %), chômage 7,98 %. Dérives lentes et voulues (dette, convergence de l'inflation vers la cible).
- **Avec les événements exogènes** (calage phase 0.5) : IPC août ≈ 2,6 % (Insee 2,4), septembre ≈ 2,5 % (Insee 3,1 : pas d'effets de second tour) ; chômage juin ≈ 8,0 % (Insee T2 8,3) ; spread fin septembre ≈ 89 pb (124 pb observés : la composante politique dépend de la stabilité, que les événements n'abaissent que faiblement). Ces écarts sont des limites connues, pas des erreurs de données.

## tags.json — 16 catégories de politiques publiques

- **Contenu** : `fiscalite_hausse`, `fiscalite_baisse`, `redistribution`, `austerite_depenses`, `relance_depenses`, `retraites_durcissement`, `retraites_assouplissement`, `travail_flexibilite`, `securite_justice`, `immigration_restriction`, `ecologie_climat`, `europe_integration`, `services_publics`, `entreprises_competitivite`, `agriculture_soutien`, `institutions_democratie_directe` ; chacun a des axes (direction d'une loi sur les 3 axes de `politics`), des réactions des groupes et une justification chiffrée.
- **Sources** : Ipsos bva, Fractures françaises 2025 (rapport complet) ; Cevipof, Baromètre de la confiance politique vague 16 (février 2025), avec numéros de page ; lois Duplomb et narcotrafic (scrutins).
- **Conventions** : direction fixe par tag (deux tags pour un sujet à double sens). Intensité des réactions = jugement de modélisation.
- **Couverture des catégories de leviers** : fiscalité (hausse, baisse, redistribution, compétitivité), social et dépenses (austérité, relance, services publics), retraites (durcissement, assouplissement), travail (flexibilité), fonction publique (austérité, relance, services publics), énergie (écologie, fiscalité). Non couverts : régulation (livret A), défense (passe par relance/austérité), logement.
- **Limite** : avec les positions CHES, le RN n'apparaît que faiblement opposé à `retraites_durcissement` ; correction par parti à prévoir dans le moteur.

## regions.geojson — contours des 18 régions

- **Contenu** : FeatureCollection WGS84, propriétés `{code, nom}` (codes Insee de `REGION_CODES`). Les DROM sont à leurs coordonnées réelles. Taille d'environ 0,41 Mo.
- **Source** : https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/regions-avec-outre-mer.geojson, consultée le 2026-10-20. Contours IGN Admin Express COG (édition 2018), codes et noms Insee COG (millésime 2018). Les limites régionales sont inchangées depuis 2016.
- **Traitement** : mapshaper 0.6 (`-simplify 25% keep-shapes -clean`, précision 0,0001°). Les îlots de moins d'environ 1 km² ont été supprimés et les surfaces restent à ±1 % de la source.
- **Licence** : **Licence Ouverte Etalab 2.0** (IGN / INSEE). Attribution obligatoire, avec la date de mise à jour : « Contours : IGN – Admin Express COG, édition 2018 ; codes et noms : INSEE – COG, millésime 2018 ; via github.com/gregoiredavid/france-geojson ; simplifié avec mapshaper. » Le dépôt intermédiaire n'a pas de licence propre. L'attribution figure aussi dans le membre `attribution` du fichier et doit apparaître dans l'interface de la carte.

## reformes.json — catalogue des réformes de structure

- **Contenu** : 5 modèles (`creer_impot`, `supprimer_impot`, `proportionnelle`, `suppression_493`, `capitalisation`) avec leurs voies (circuit de l'art. 89 pour la proportionnelle et le 49.3), 4 assiettes d'impôt nouveau (taux min/max/défaut, rendement par unité k, érosion η : R(τ) = k·τ·e^(−ητ)), 7 impôts supprimables (ligne, recette 2026, leviers liés), cotisations retraite effectives 2026 (capitalisation). Chaque entrée porte ses effets (format de `levers.json`), groupes touchés, positions des groupes parlementaires (`assemblee_<id>`, `senat_<id>`) et tags requis.
- **Sources** :
  - ISF financier : France Stratégie, comité d'évaluation des réformes de la fiscalité du capital (rapport d'octobre 2023) pour la base ISF 2017 (≈ 1 028 Md€, DGFiP) ; érosion d'après Seim (2017) et Jakobsen et al. (2020).
  - Très hauts patrimoines : Institut de l'entreprise (note de juin 2026, rendement divisé par quatre une fois l'IS imputé) et Public Sénat (arguments pour et contre la taxe Zucman, rejetée le 31 octobre 2025) ; patrimoine ≈ 1 000 Md€ (classement Challenges).
  - Carbone : I4CE (contribution climat-énergie : revenus 2017 de 5,4 Md€ à 30,5 €/t, exonérations de 6,3 Md€ en 2018) ; CPO 2019.
  - Rachats d'actions : La Lettre Vernimmen via FranceTransactions (CAC 40 : 25,5 Md€ en 2024, 30,1 Md€ en 2023 ; 34,8 Md€ en 2025).
  - Impôts supprimables : montants Insee 2025 des notes de `budget.json` × 1,0331 (IFI 2,80 ; TTF 2,58 ; taxe foncière 45,64 ; CVAE 3,87 ; droits de succession 21,75 Md€), IS et IR = lignes de `budget.json`. Effets = élasticités des leviers liés ÷ leur élasticité budgétaire.
  - Capitalisation : COR, rapport annuel de juin 2025 (méthodologie, ressources du système).
- **Conventions** : voir « Réformes » dans les conventions communes (élasticités par Md€ 2026 de recette en plus, `groupes_touches` dans le sens d > 0).
- **Estimations** (`estimate: true` partout) : base de l'ISF financier (≈ 900 Md€ = 1 028 × 0,65 × 1,4) ; assiette carbone nette ≈ 150 MtCO2 (**ordre de grandeur, à sourcer** : non trouvée telle quelle) ; rachats ≈ 30 Md€/an (moyenne 2023-2025) ; cotisations retraite effectives ≈ 250 Md€ (**à sourcer** dans les ressources par nature du COR, fourchette 230-300) ; positions des groupes estimées d'après les programmes 2022-2024 et les débats de 2025 (**à sourcer**). Érosions η : hypothèses (`hypothese: true`).
- **Limites** : rendement statique indexé sur le compte central (pas d'élasticité conjoncturelle propre) ; érosion × taux max ≤ 2 (1,75 pour les très hauts patrimoines à 5 %, au-delà du maximum de Laffer à 2,9 %) ; la proportionnelle est classée constitutionnelle par choix de jeu (`"voies": []` pour revenir à la loi ordinaire, art. 34).

---

## Licences des données tierces

| Producteur | Licence / conditions | Usage dans le projet |
|---|---|---|
| Insee, DG Trésor, DREES, SIES, Banque de France, AFT, Légifrance, service-public.fr, Assemblée nationale, Sénat, vie-publique | Licence Ouverte Etalab 2.0 (informations publiques), réutilisation libre avec mention de la source et de la date | Valeurs chiffrées et faits, sources citées pour chaque valeur |
| IGN Admin Express / Insee COG (GeoJSON) | Licence Ouverte Etalab 2.0, attribution et date obligatoires | `regions.geojson`, attribution à afficher dans l'interface |
| Chapel Hill Expert Survey 2024 | Données diffusées librement par le CHES, citation demandée (conditions exactes non vérifiées) | Positions de 10 partis, après transformation |
| Wikipédia | CC BY-SA 4.0 | Seuls des faits sont repris, aucun texte n'est reproduit |
| datan.fr | Licence non vérifiée | Seuls des taux de cohésion agrégés sont repris |
| Instituts de sondage (Odoxa, Verian, Ipsos bva), presse, BNP Paribas, CRE, sites commerciaux | Droits réservés | Seuls des chiffres et des faits sont repris, avec citation de la source et sans reproduction de texte |
| BCE, Eurostat | Réutilisation autorisée avec mention de la source | Taux directeurs, cible d'inflation |
