# Moteur Hexagone : conventions (phase 1)

Contrat de types : `src/types.ts`. Données : `gamedata/*.json` (schémas `src/schemas.ts`, conventions `gamedata/SOURCES.md`).
Formules des dynamiques : champ `description` de chaque coefficient de `gamedata/coefficients.json`. Référence numérique : `scripts/papersim.cjs`.
Les règles ci-dessous tranchent les ambiguïtés relevées par la critique de la phase 0.5. En cas de conflit, ce fichier l'emporte.

## 1. Temps et ordre du tick

Un seul projet déposé par mois (`canDeposit`, `deposit` refuse le second) ; les lois de finances (`spec.loiDeFinances`) n'entrent pas dans ce compte. Les brouillons restent illimités. `amend` remplace le texte d'un projet en brouillon ou en préparation (un projet déposé garde sa date de vote). Un projet retiré disparaît à la fin du mois.

Un tick = un mois. `endTurn` applique, dans cet ordre, en utilisant les valeurs du mois précédent pour les boucles (spread ↔ stabilité, satisfaction ↔ chômage) :

1. **Événements** du mois (`events-2026.json`, date au mois près) : `exogene` → effets actifs ; `echeance` → simple `TurnEvent` (aucun effet).
1a. **Échéances** : rentrée budgétaire en septembre (§5d) ; trois mois avant l'échéance normale des législatives (mars 2029), annonce du scrutin de juin (§17), sans effet ni tirage.
1b. **Événement aléatoire** (§5b) : au plus un par mois.
2. **Lois** : celles dont `voteLe` = ce mois sont votées (§4) ; adoptées → `promulgueLe` = ce mois ; leurs leviers et effets qualitatifs démarrent. Assemblée dissoute ce mois-ci, ou législatives ordinaires ce mois-ci (§17) (mode démocratie) : votes du mois reportés d'un mois (`voteLe` = mois suivant, aucun vote). Seuls comptent les votes de l'Assemblée en place : un texte adopté par une Assemblée dissoute (puis rejeté au Sénat) est revoté par les deux chambres.
   Adoption définitive (hors décret et hors révision constitutionnelle) : si 60 députés ou sénateurs au moins y sont fortement opposés, **saisine du Conseil constitutionnel** (§15) au lieu de la promulgation : le texte reste `preparation` jusqu'à la décision (un mois plus tard, le même mois pour une loi de finances).
2a. **Décisions du Conseil constitutionnel** (§15) dues ce mois-ci : conforme ou censure partielle → promulgation (texte réduit) ; censure totale → `rejetee`. Pas de report pendant une dissolution ; une loi de finances votée ce mois est décidée dans ce tick.
2b. **Législatives** : anticipées (§11) si une dissolution a été prononcée ce mois-ci ; ordinaires (§17) au mois de l'échéance (juin 2029), hors défaite et hors prévisualisation.
3. **Indexations automatiques** : pensions au 1er janvier (`pensions_indexation_inflation`) ; SMIC au 1er janvier et en cours d'année si l'inflation cumulée depuis la dernière revalorisation dépasse `smic_seuil_revalorisation_inflation`. L'indexation bouge `levers[id].reference`, jamais `delta`.
4. **Effets actifs** → lignes budgétaires, terme d'offre O, inflation, satisfaction, scores.
5. **Macro** : croissance (tendance + multiplicateurs × impulsion budgétaire + O + chocs + grèves), chômage (Okun sur l'écart de croissance **hors effets d'offre des leviers** : voir §7a), inflation.
6. **Finances publiques** : recettes (élasticités au PIB), dépenses, intérêts (taux apparent × dette, refinancement de `part_dette_refinancee_mois` au taux de marché), solde, dette, spread (constante + dette + déficit + stabilité + notations + `prime_risque`).
7. **Opinion** : satisfaction des groupes → popularité (pondérée part × participation) → intentions de vote.
7b. **Relations et rapports** des groupes (§13) : lois promulguées ce mois, popularité du mois, retour au centre de bande, un cran de rapport au plus (Assemblée gelée en cohabitation). Sans tirage, aussi en prévisualisation.
8. **Tension** régionale puis nationale → grèves (seuils) ; **stabilité**.
8b. **Fin de partie anticipée** (§10) : compteurs de mois consécutifs au-delà des seuils.
9. **Historique** : snapshot. La partie s'arrête après décembre 2030, ou à la défaite.

Normalisations : PIB mensuel = PIB annuel / 12, PIB nominal = somme glissante sur 12 mois, déficit du mois = variation de dette. Voir papersim.

## 2. Leviers

- État : `levers[id] = { reference, delta }`. Valeur affichée = `reference + delta`. `reference` part de `valeur_initiale` et suit les indexations automatiques.
- Une loi applique `delta += spec.levers[i].delta` (borné par min/max du levier sur la valeur affichée).
- **Effet d'une variation** Δ (changement de `delta` à la promulgation) : pour chaque effet du levier, un `ActiveEffect` d'amplitude `elasticite × Δ`, démarrant à `promulgation + delai_mois`, avec `rampe_mois`. `niveau` = permanent ; `choc` = décroissance linéaire sur `duree_mois`.
- Revenir en arrière = nouvelle variation de signe opposé (les chocs de popularité se rejouent en sens inverse : assumé).
- Montants en Md€ : en euros 2026, multipliés par `PIB nominal(t) / PIB nominal initial` au moment de l'application.
- `BillSpec.rampMonths` ne s'applique qu'aux effets qualitatifs ; les leviers gardent leurs propres délais et rampes.

## 3. Satisfaction des groupes : une seule voie

- La satisfaction bouge **uniquement** par : le pouvoir d'achat (formule de `satisfaction_poids_pouvoir_achat`), l'emploi, les effets `kind: group` (leviers, lois qualitatives, événements).
- `groupes_touches` (leviers) et `tags.reactions_groupes` ne touchent **jamais** la satisfaction : ils servent au vote des groupes parlementaires (§4) et au terme « lois impopulaires » de la tension (`tension_poids_lois_impopulaires`) et de la popularité (`popularite_poids_lois_impopulaires`), pendant `tension_lois_duree_mois`. Les réactions d'une loi (leviers + tags) sont d'abord agrégées par groupe (`billGroups` : intensités signées additionnées, une entrée par groupe plafonnée à « forte »).
- Popularité = moyenne des satisfactions pondérée par part × participation, puis inertie.

## 4. Parlement (heuristique, `src/parliament.ts`)

Paramètres : coefficients `parlement_*` (à ajouter dans coefficients.json, `hypothese: true`).
- Axes de la loi = moyenne des `axes` de ses tags (`billAxes`). Accord sur le fond `fond(bill, chambre, groupe)` = position du modèle de décision (§4b) si elle existe, sinon `axes · positionnement` (non borné). Pour chaque groupe parlementaire : `s = parlement_poids_axes × fond + bonus(rapport) + parlement_poids_popularite × (popularité − 0.3)` avec bonus majorité / soutien conditionnel / opposition.
- `p_pour = σ(k·s)`, `p_contre = σ(−k·s)`, abstention = reste via `parlement_abstention_base`. Au vote, le score reçoit un choc gaussien commun à la chambre (`parlement_incertitude_commune`) et un choc par groupe (`parlement_incertitude_groupe`). Votes = sièges × probabilités, avec dissidence tirée (rng) selon `1 − discipline`.
- Adoption à l'Assemblée = pour > contre (majorité des exprimés). Le Sénat vote aussi (affiché ; rapports courants lus par `senatGroupes(state)`, dynamiques depuis le §13) ; en cas de désaccord, l'Assemblée a le dernier mot un mois plus tard (CMP simplifiée).
- **Prévision** (`forecastVote`, prévisualisation §8) : Monte-Carlo de 1000 votes (même fonction que `voteBill`) sur des graines fixes, donc déterministe et indépendant de `state.rng`. Voix = moyennes, probabilité d'adoption = fréquence.
- **49.3** après un rejet : budget (tag `fiscalite_*`/`austerite_depenses`/`relance_depenses` et coût ≠ 0) illimité, sinon une fois par année civile. Motion de censure votée immédiatement par les groupes hors majorité (opposition et soutien conditionnel : l'opposition seule n'atteint pas 289 sièges) selon `p_contre` ; adoptée si ≥ 289 voix → loi rejetée (`censuree`), choc de stabilité `censure_choc_stabilite` sur `censure_duree_choc_mois`, le gouvernement devient démissionnaire (§11). Censure rejetée : saisine du Conseil constitutionnel presque systématique (seuil de fond 0, §15), sinon promulgation immédiate ; `can493` est faux sur un texte déféré ou jugé par le Conseil.
- Le 49.3 est impossible en cohabitation (prérogative du PM), pour un gouvernement démissionnaire et pendant une dissolution (§11), sur une révision constitutionnelle et après une suppression du 49.3 par réforme (`can493`, §14). Un impôt créé ou supprimé, tagué `fiscalite_*`, compte comme texte budgétaire (§14).
- **Malus de cohabitation** : en cohabitation, à l'Assemblée seulement, le score des groupes `majorite` perd `parlement_malus_cohabitation` sur chaque texte du Président (vote et prévision ; le Sénat n'est pas concerné).
- Mode `decret` : adoption automatique au mois prévu, pas de vote.
- Mode `bac_a_sable` : votes comme en `democratie` (mode « Réaliste »), mais aucune défaite (§10, §12) et dépôts illimités (§1).

## 4b. Positions d'un modèle de décision (`spec.positions`)

- Optionnel : `spec.positions["assemblee_<groupe>"]` ou `["senat_<groupe>"]`, de −1 (rejet sur le fond) à 1 (soutien), remplace pour ce groupe le produit scalaire axes · positionnement dans le score s (même poids `parlement_poids_axes`). Bonus de rapport au gouvernement, popularité, accueil populaire, cohabitation, dissidence et aléa restent ceux du §4. La censure lit les positions de l'Assemblée.
- Fournies hors du moteur, à la rédaction du projet (Jev via l'API Decisions d'OpenRouter, côté application) : le moteur reste pur et déterministe à spec donnée. Sans positions (pas de modèle, échec de l'appel), l'heuristique s'applique.

## 5. Événements

- Appliqués au tick de leur mois. Tout effet d'événement dure `duree_mois` : `niveau` = constant puis arrêt ; `choc` = décroissance linéaire. Amplitude = barème `bareme.<kind>.<magnitude>` × direction.
- Correspondance cible → barème : indicator croissance_pib → croissance, chomage_bit → chomage, inflation → inflation, taux_pauvrete → pauvrete ; group → satisfaction ; region / tension → tension ; popularite, stabilite, budget, prime_risque : homonymes ; notation : crans directement (amplitude = direction).
- Les événements réels s'arrêtent fin 2026 ; les événements aléatoires (§5b) prennent le relais.

## 5b. Événements aléatoires (`gamedata/events-random.json`)

- Modèles : probabilité mensuelle de base × multiplicateur de chaque condition remplie (indicateur national ou `groupe:<id>` comparé à un seuil, valeurs du mois précédent), plafonnée à 0,5. Nuls avant `depuis`, hors des `mois` de saison et pendant `delai_min_mois` après le dernier tirage du modèle (`internals['ev:<id>']`).
- Chaque mois, **un** tirage `rand(state.rng)` : si `u < Σp`, le modèle retenu est celui où la somme cumulée dépasse `u` (au-delà de Σp = 1, `u` est mis à l'échelle). Le générateur avance donc d'un cran chaque mois, même sans événement.
- `region` : la région touchée est tirée (second tirage) selon la population ou le carré de la tension ; les effets `region` sans id la visent et son nom s'ajoute au titre.
- Effets : mêmes règles que §5. `TurnEvent.type = 'aleatoire'`.
- Jamais en prévisualisation (§8) : `endTurn(state, { aleatoire: false })`.
- Fréquence (npm run balance) : ≈ 3,3 événements par an sans action ; davantage de crises quand la situation se dégrade (conditions).

## 5c. Dilemmes

- Un modèle d'événement aléatoire peut proposer 2 ou 3 `choix` (libellé, description, effets au format §5). Tiré au §5b, il applique d'abord ses propres `effets`, puis pose `state.dilemme` (titre avec la région, choix sans leurs effets).
- `choose(state, choixId)` applique les effets du choix à partir du mois courant (les effets `region` sans id visent la région tirée), lève le dilemme et renvoie un `TurnEvent` `choix`.
- Sans décision, le tick suivant applique le **premier** choix (réponse par défaut, `parDefaut: true`) avant tout nouveau tirage : au plus un dilemme en attente.
- Prévisualisation (§8) : un dilemme en attente reçoit la réponse par défaut des deux côtés.

## 5d. Calendrier budgétaire

- Chaque septembre (2026 à 2029), une échéance rappelle que le PLF de l'année suivante doit être déposé au plus tard le premier mardi d'octobre (LOLF, art. 39) et que le Parlement a 70 jours pour l'adopter (Constitution, art. 47).
- Un projet porte `spec.loiDeFinances = année` (écran budgétaire de l'interface). Déposé entre septembre et novembre, il est voté par l'Assemblée en novembre (vote solennel réel : mi-novembre), ce qui laisse décembre pour la navette ou le 49.3.
- Une loi de finances déférée au Conseil constitutionnel (§15) est décidée le mois de son adoption (étape 2a, avant le test de la loi spéciale) ; une censure totale en décembre mène donc à la loi spéciale (précédent : 79-110 DC, loi de finances pour 1980).
- Au tick de décembre, après les votes : sans loi de finances **adoptée** pour l'année suivante, l'État passe sous **loi spéciale** (cas réels : 2025, 2026) : chocs faibles de stabilité (6 mois), de prime de risque (6 mois) et de popularité (3 mois).

## 6. Déterminisme

`mulberry32` initialisé par `seed`, état dans `state.rng`. Aucun `Math.random` ni `Date` dans `src/`. Même état + mêmes actions ⇒ même résultat. Le moteur est pur : chaque fonction renvoie un nouvel état.

Deux mécaniques tirent sur une graine dérivée `graine(s, …)` (rand de parliament.ts) au lieu de state.rng : la décision du Conseil (§15) et le scrutin de juin 2029 (§17). Ces tirages sont fonction de (seed, mois, loi). Ils ne décalent aucun tirage de state.rng et sont identiques en prévisualisation. C'est le seul assouplissement de la règle « aléa = state.rng ».

## 7. Corrections de la phase 1.1

a. **Okun** : seuls les effets d'offre des **leviers** (`source.kind = 'lever'`, cible `croissance_pib`) sont retirés de la croissance qui alimente Okun. Les chocs de croissance des événements (guerre en Iran, tempêtes…) et les effets qualitatifs des lois sur la croissance passent par Okun et font donc bouger le chômage (avec le retard du lissage sur 6 mois). Raison : un levier d'offre (ex. réforme structurelle) a son propre effet chômage dans le catalogue, alors qu'un choc d'activité exogène détruit des emplois.
b. **Indexation des pensions** : déjà cumulative depuis la phase 1. Le delta de `retraite.indexation_pensions` s'ajoute à chaque revalorisation du 1er janvier sur l'indice Pen (`Pen ×= 1 + (auto + delta)/100`) ; l'effet budgétaire est `elasticite × 100 × (Pen / Pen_fil_de_l'eau − 1)`, recalculé chaque mois. −1 point ⇒ ≈ 2,9 / 6,0 / 9,3 Md€ courants d'économie en 2027 / 2028 / 2029 (test sur 3 ans). L'effet budgétaire générique du levier n'est pas créé à la promulgation (pas de double compte).
c. **Croissance potentielle** : interpolation linéaire de `croissance_potentielle` (1,2 %) à `croissance_potentielle_long_terme` (1,0 %) entre juillet 2028 et juillet 2029 (mois 30 à 42), au lieu d'un palier en janvier 2029 ; les moyennes annuelles restent proches du PSMT (≈ 1,2 % en 2028, 1,0 % en 2029).
d. **SMIC** : la règle compare bien l'IPC simulé (approximation de l'IPC hors tabac des 20 % de ménages les plus modestes) du mois t−2 (publié en t−1, effet au 1er du mois t) à l'indice de la dernière revalorisation (novembre 2025 au départ), seuil 2 %. **Écart de calibrage** : dans la réalité, le seuil a été franchi au printemps 2026 et le SMIC revalorisé au 1er juin 2026 ; dans la simulation (sans action), la hausse de l'indice depuis novembre 2025 culmine à ≈ 1,3 % au printemps et ≈ 1,8 % en octobre, et ne franchit jamais 2 % en 2026 : seule la revalorisation de janvier 2027 (+1,55 %) a lieu. Rien n'est forcé : l'écart vient de l'inflation simulée (choc pétrolier de 2026 sous-estimé par le barème des événements et IPC national au lieu de celui du 1er quintile, plus sensible à l'énergie).
e. **Choix chiffrés devenus coefficients** (`hypothese: true`) : `censure_duree_choc_mois` (6, durée du choc de stabilité après censure), `part_chomage_aides_sociales` (0,27, part de `aides_sociales` élastique à la conjoncture), `greve_generale_region` (11, région de rattachement de l'événement « grève générale », convention d'affichage).

## 8. Prévisualisation d'une loi (`previewBill`)

- Horizon : `months` arrondi et borné à [6, 60], compté **après l'adoption** : on simule `prepMonths + months` mois, borné au nombre de mois restant avant la fin de la partie (0 si elle est finie). Si la partie finit avant l'adoption (`result.months <= prepMonths`), la loi n'est jamais appliquée dans la fenêtre : écarts nuls, l'interface le signale.
- Deux simulations par `endTurn` (sans événement aléatoire) depuis une copie de l'état (historique vidé : non lu par le tick) : **sans** la loi, et **avec** la loi ajoutée en brouillon puis promulguée sans vote au mois `date + prepMonths`, juste avant le tick de ce mois (comme en mode décret). Événements programmés, autres lois et générateur aléatoire suivent les mêmes règles des deux côtés ; l'écart inclut les interactions (ex. popularité modifiée avant le vote d'une autre loi).
- Les tags comptent : une loi sans levier mais dont les tags ont des réactions négatives fait monter la tension (§3), donc l'écart n'est nul que pour une loi sans levier, sans effet qualitatif et sans tag impopulaire.
- Écarts au dernier mois simulé : tous les indicateurs, lignes budgétaires non nulles (`recettes.x` / `depenses.x`, triées par |écart|), satisfaction de chaque groupe, tension et chômage de chaque région, intentions de vote.
- `vote` : prévision Assemblée puis Sénat (§4) à l'état courant ; vide en mode décret.
- `conseil` (§15, hors décret, dissolution et révision) : saisine probable (49.3 supposé si P(adoption à l'Assemblée) < 0,5 et 49.3 possible), probabilités de censure partielle et totale, articles exposés. Limite : la trajectoire « avec » suppose la loi adoptée au mois prévu, sans délai ni censure ; les lois déjà déférées sont décidées de la même façon des deux côtés (graine dérivée).
- Réformes (§14) : `circuit` (révision constitutionnelle hors décret et hors dissolution : probabilités Congrès et référendum de bout en bout, oui moyen) ; `legislatives` (proportionnelle : prévision des législatives sans et avec la règle) ; adoption d'une révision au mois du Congrès (`prepMonths + 1`) ; lignes budgétaires des impôts créés comprises.
- Pas de législatives de juin 2029 en prévisualisation (§17) : comme la présidentielle, le scrutin ordinaire n'a lieu que dans un tick normal (sinon une cohabitation pourrait n'apparaître que d'un côté). Les votes du mois de l'échéance ne sont pas reportés non plus.
- Coût : ≈ 20 ms pour 60 mois (test < 100 ms).


## 10. Fin de partie anticipée (défaites)

- Trois causes, chacune avec un seuil (coefficients `defaite_*`) : **dette** (spread ≥ `defaite_spread_seuil`, l'État perd l'accès aux marchés), **régime** (stabilité ≤ `defaite_stabilite_seuil`, le Président démissionne), **soulèvement** (tension nationale ≥ `defaite_tension_seuil`).
- Compteur `internals['def:<cause>']` : +1 par mois au-delà du seuil, remis à 0 dès qu'il repasse. Premier mois : `TurnEvent` `alerte` ; au mois `defaite_mois_consecutifs` : `state.defaite = { cause, date }`, `TurnEvent` `defaite`, et `isOver` devient vrai. Seule la première défaite compte.
- `engine.dangers(state)` liste les compteurs en cours (bandeau d'alerte de l'interface, contexte du conseiller LLM).
- Fin de partie (`isOver`, dans `src/bilan.ts` : mois 60 atteint ou défaite) : l'interface ouvre la fenêtre de fin de mandat avec le bilan et le score (§16), plafonné après une défaite.
- Le spread reçoit un terme non linéaire en déficit (`spread_non_lineaire_deficit`, actif au-delà de 6 %), sans quoi aucune dérive budgétaire ne menait à la crise de la dette.
- Calage (50 graines, `npm run balance`) : aucune défaite sans action ni pour une réforme isolée (retraites, austérité de 20 Md€) ; quelques-unes pour un dérapage de +90 Md€ ou une austérité brutale ; environ deux tiers des parties en cumulant deux réformes brutales ; toujours pour une dérive budgétaire extrême.

## 11. Institutions : gouvernement, censure, dissolution, cohabitation

Code : `src/institutions.ts`. Données : `politics.institutions` (blocs, coalitions, profils). Coefficients `legislatives_*`, `dissolution_*`, `parlement_malus_cohabitation`.

**Règles**
1. **Gouvernement** : `state.institutions?.gouvernement` (profil, PM, date, démission). Les rapports des groupes restent dans `parliament.assemblee[].rapport` (lus par le vote, la censure et la cohésion qui alimente la stabilité) : nommer un PM réécrit les rapports et les relations (§13). Entre deux nominations, les rapports suivent les relations (§13). La discipline des groupes ne change pas.
2. **Censure adoptée** : le gouvernement devient **démissionnaire**. `deposit` est refusé et le 49.3 impossible ; l'interface désactive « Fin du mois » tant qu'aucun PM n'est nommé. Le moteur ne bloque pas `endTurn` (scripts et prévisualisation restent totaux) : les textes déjà en préparation sont votés avec les rapports en place.
3. **Nomination** (`nominate`) : seulement si le gouvernement est démissionnaire, pas de remaniement volontaire. Quatre profils nommables (`camp_presidentiel`, `ouverture_gauche`, `ouverture_droite`, `technicien`), rapports donnés par `profils[].rapports` (groupe absent = opposition). `cohabitation` n'est jamais nommable : seul le tick le pose après des législatives.
4. **Dissolution** (`dissolve`, art. 12) : mode démocratie, partie en cours, aucune dissolution en cours, au moins `dissolution_delai_mois` (12) écoulés depuis le dernier scrutin législatif (juillet 2024 au départ : possible dès janvier 2026). Prononcée au mois t, elle entraîne les deux tours au tick de t (étape 2b). Choc de stabilité `dissolution_choc_stabilite` sur `dissolution_duree_choc_mois` ; votes du mois t reportés d'un mois. Compteur `internals['n:dissolutions']` (+1, lu par le bilan, §16). Sans dissolution, l'Assemblée va au bout de son mandat : **législatives ordinaires** de juin 2029 (§17) ; `pouvoir().prochainesLegislatives` donne l'échéance (dérivée de la date du dernier scrutin).
5. **Sièges** (`scrutin`, pur) : par blocs, à partir de `state.intentions` (formule ci-dessous).
6. **Issue** (`issue(a, s?)`), dans cet ordre : (a) blocs de `majPres(s)` ≥ 289 (`censure_seuil`) → `majorite` (camp réel : `majorite_presidentielle` ; camp choisi hors du centre : §13) ; (b) sinon première coalition de `coalitions_opposition` sans le bloc du camp ≥ 289 → `cohabitation`, PM automatique ; (c) sinon `sans_majorite`. En (a) et (c), le gouvernement devient démissionnaire (rapports inchangés jusqu'à la nomination) ; si c'était un gouvernement de cohabitation, il passe au profil `technicien` (affaires courantes, rapports de ce profil) : la cohabitation prend fin.
7. **Cohabitation** : groupes des blocs de la coalition → `majorite`, groupes du bloc du camp (`campBloc(s)`, par défaut `majorite_presidentielle[0]`) → `soutien_conditionnel`, autres → `opposition`. Les rapports de l'Assemblée ne suivent plus les relations jusqu'à la fin de la cohabitation (§13). À l'Assemblée, malus `parlement_malus_cohabitation` sur les groupes `majorite` (bonus net +0,1, comme un soutien conditionnel : la coalition vote selon les axes) ; 49.3 impossible. Jamais de défaite par cohabitation ; seule une nouvelle dissolution y met fin.
8. **Effets** : campagne → choc de stabilité (règle 4) ; résultat → choc de popularité `legislatives_effet_popularite × Δsièges du camp présidentiel / 577` (forme choc, `dissolution_duree_choc_mois`) ; la stabilité suit ensuite la nouvelle assise via le terme de cohésion (§1, étape 8), dont l'écart à la cohésion initiale est borné dans [−`stabilite_cohesion_perte_max`, `stabilite_cohesion_gain_max`] : une Assemblée sans majorité coûte l'équivalent de la perte d'un groupe (pas de défaite mécanique), une nomination ne rend pas le pays plus stable qu'avant la censure. Le bloc gouvernemental du modèle d'intentions (`bloc(s)` de `tick.ts`) reste celui du Président : `BLOC` = bloc du camp (§13 ; camp réel ou `horizons` : {horizons}). La prime de popularité aux législatives et l'effet de popularité du résultat portent sur le bloc du camp.

**Sièges** : voix `v_b` = Σ intentions des partis du bloc ; score `w_b = (v_b × (barrage ? legislatives_barrage : 1))^legislatives_exposant × exp(legislatives_incertitude × z_b)`, `z_b` gaussien tiré de `state.rng` dans l'ordre des blocs, et pour le camp présidentiel (`majorite_presidentielle[0]`) × `exp(legislatives_prime_popularite × (popularité − popularité initiale))` (popularité du mois précédent) ; part `λ × S_b / ΣS + (1 − λ) × w_b / Σw` (S = sièges sortants du bloc, λ = `legislatives_ancrage_local`) ; sièges du bloc = plus forts restes de `N × part`, N = 577 − sièges des `hors_blocs` (LIOT, NI : inchangés ; les sièges vacants sont pourvus, total 577) ; sièges d'un groupe = plus forts restes au prorata de ses sièges dans `politics.json`. Rapports des groupes inchangés par le scrutin.

**Tick** : étape 2b, après les lois et avant les indexations. Les effets de popularité jouent dès l'étape 4, la stabilité de l'étape 8 lit la nouvelle cohésion. Les intentions utilisées sont celles du mois précédent (l'étape 7 vient après) : la prévision, faite à l'état courant, suit exactement la même loi. Le générateur n'avance en plus qu'au mois du scrutin (déterminisme conservé) ; `previewBill` n'a rien de particulier (même tirage des deux côtés).

Pendant une dissolution, `previewBill` ne donne pas de prévision de vote (`vote` vide) : le texte sera voté par l'Assemblée élue.

**Prévision** (`forecastLegislatives`) : Monte-Carlo de 1000 scrutins sur graines fixes (comme `forecastVote`) : moyenne, 10e et 90e centiles des sièges par bloc, fréquence des issues. Pure, n'avance pas `state.rng`.

**Sauvegardes** : `institutions` est optionnel, comme `camp`, `relations` et `senat` (§13) ; absent (sauvegarde antérieure), `inst()` renvoie `INSTITUTIONS0` (gouvernement Lecornu, `camp_presidentiel`, législatives de juillet 2024). Rien n'est ajouté à `internals`. Les rapports initiaux restent ceux de `rapport_gouvernement` (SOC en soutien conditionnel), pas ceux du profil.

**Calage** (`npm run balance`, dissolution au 13e mois, 50 graines × 4 scénarios) : au départ (popularité ≈ 0,18, `horizons` ≈ 17 %), RN et alliés ≈ 250 sièges, centre ≈ 100, gauche ≈ 100, gauche radicale ≈ 70, droite ≈ 25 ; union des droites ≈ 25 à 30 %, aucune majorité ≈ 70 %, majorité présidentielle ≈ 0. À intentions égales, la popularité déplace le centre : ≈ 75 sièges à 0,10, ≈ 160 (les sortants) à 0,30, majorité présidentielle ≈ 40 % à 0,44 (`legislatives_prime_popularite`). Sièges prévus et obtenus du centre : écart ≈ 1 siège. Après un scrutin qui laisse le gouvernement démissionnaire, chacun des quatre profils joué 12 mois : ≈ 3 % de défaites, stabilité finale 0,28 à 0,34 (ouverture à droite en tête).

**Limites** : pas de remaniement volontaire ; discipline inchangée ; entre deux seuils, la relation n'agit pas sur le vote (bonus discret par rapport, §13) ; une seule coalition d'opposition, testée dans l'ordre des données (pas de majorité négociée après le scrutin) ; intentions de présidentielle utilisées comme vote législatif (voix centristes sous `horizons`) ; la cohabitation n'est qu'un malus de vote et la perte du 49.3.

## 12. Présidentielle 2027 (`src/presidentielle.ts`)

- Dates retenues (Conseil des ministres du 1er juillet 2026) : premier tour le 18 avril 2027, second tour le 2 mai 2027 ; fin du mandat le 14 mai. Annonce (échéance) au tick de janvier 2027, premier tour au tick d'avril, second tour au tick de mai, après l'opinion du mois (étape 8a). Jamais en prévisualisation.
- Candidats : les partis des intentions de vote (`politics.intentions_vote`) ; le joueur est `joueur(s)` : le parti du camp choisi (§13), sinon le candidat du camp présidentiel (`JOUEUR`, premier parti du bloc `majorite_presidentielle[0]` présent dans les intentions).
- Positionnement du joueur mobile (§13) : déplacé par ses lois adoptées ; au premier tour, des électeurs le suivent (transfert à somme conservée), au second tour les reports se calculent depuis sa position courante.
- Premier tour : score = intention × prime de popularité du sortant (`presidentielle_prime_popularite`, seulement pour le joueur) × exp(`presidentielle_incertitude` × z), z tiré par candidat ; normalisé à 100. Les deux premiers sont qualifiés ; scores gardés dans `internals['pres:<parti>']`.
- Second tour : chaque finaliste garde ses voix ; `presidentielle_report_part` des voix de chaque éliminé se reporte, partagée selon exp(−`presidentielle_report_distance` × distance des positionnements), le poids vers un finaliste « barrage » étant multiplié par `presidentielle_barrage` (sauf pour les électeurs de son bloc) ; choc commun de `presidentielle_incertitude_t2` points.
- `internals['pres:reelu']` : 0 si le joueur est éliminé ou battu, 1 s'il est élu, bac à sable compris (bilan, §16 ; sans tirage).
- Joueur éliminé ou battu : défaite `presidentielle` (fin de partie, §10). Réélu : état de grâce (chocs de popularité moyen et de stabilité faible sur 6 mois). L'Assemblée n'est pas renouvelée : la dissolution reste possible (§11).
- `forecastPresidentielle` : 1 000 tirages sur graines fixes à l'état courant (intentions et popularité figées) : premier tour moyen, probabilités de qualification et de victoire, adversaire probable.

## 13. Relations, positionnement du Président et camp

Code : `src/init.ts` (aides), `src/institutions.ts` (`majRelations`, `appliquer`, `choisirCamp`, `profilCamp`, `majPres`), `src/parliament.ts` (`fond`, `senatGroupes`), `src/presidentielle.ts` (`positionPresident`, électeurs qui suivent). Coefficients `parlement_relation_*` (requis) et `presidentielle_deplacement_par_loi`, `presidentielle_electeurs_suivent` (facultatifs), tous `hypothese: true`.

**Relation et rapport.** Chaque groupe (Assemblée : clé `groupId` ; Sénat : `senat_<groupId>`) a une relation continue avec l'exécutif, de −1 à 1, dans `state.relations`. Le rapport reste stocké (`parliament.assemblee[].rapport`, `state.senat` pour le Sénat) et lu comme avant (bonus de vote, malus de cohabitation, censure, assise, cohésion, interface, LLM). Relation absente = centre de bande `REL0[rapport]` (`parlement_relation_majorite` 0,6, `_soutien` 0,1, `_opposition` −0,5) : un état sans relations redonne exactement les rapports actuels. Le rapport se déduit de la relation par des seuils avec hystérésis (`seuil`), un cran par mois au plus : frontières `parlement_relation_seuil_soutien` (−0,2) et `_seuil_majorite` (0,4) ± `parlement_relation_hysteresis` (0,1), soit opposition → soutien à −0,1, soutien → opposition à −0,3, soutien → majorité à 0,5, majorité → soutien à 0,3.

**Mise à jour mensuelle** (étape 7b, après les votes et l'opinion, avant la stabilité ; `majRelations`, sans tirage, aussi avec `aleatoire: false`) :
```
x += retour × (REL0[rapport] − x) + poids_popularite × (popularité − popularité initiale)
   + Σ lois promulguées ce mois [ par_loi × clamp(fond, −1, 1) − (Assemblée, 49.3, groupe hors majorité, fond < 0 ? relation_493 : 0) ]
x = clamp(x, −1, 1) ; rapport = seuil(x, rapport)
```

| Coefficient | Valeur | Rôle |
|---|---|---|
| `parlement_relation_majorite` / `_soutien` / `_opposition` | 0,6 / 0,1 / −0,5 | centres de bande (REL0) |
| `parlement_relation_seuil_soutien` / `_seuil_majorite` | −0,2 / 0,4 | frontières de rapport |
| `parlement_relation_hysteresis` | 0,1 | marge de part et d'autre ; h/2 resserre la bande à la nomination |
| `parlement_relation_retour` | 0,05 | retour mensuel au centre (demi-vie ≈ 14 mois) |
| `parlement_relation_par_loi` | 0,15 | par loi promulguée × fond borné |
| `parlement_relation_493` | 0,1 | 49.3 subi (hors majorité, fond < 0) |
| `parlement_relation_poids_popularite` | 0,07 | par mois × (popularité − 0,18) |
| `parlement_relation_memoire` | 0,5 | part de l'écart gardée à une nomination |
| `parlement_relation_cout_rupture` | 0,2 | par cran perdu à une nomination |
| `parlement_relation_fidelite` | 0,15 | camp choisi : bloc du camp, à l'ouverture |
| `parlement_relation_dissolution` | 0,1 | choc des groupes hors opposition |
| `presidentielle_deplacement_par_loi` | 0,03 | pas du positionnement par loi et par axe |
| `presidentielle_electeurs_suivent` | 0,4 | transfert au premier tour |

Ordres de grandeur : équilibre = centre + effet mensuel / 0,05. Popularité seule : l'équilibre se décale de 1,4 × Δpop, au plus −0,25 (popularité nulle) : la majorité (marge 0,3) et le soutien (marge 0,4) ne basculent jamais par la seule popularité ; vers le haut, une popularité ≥ 0,47 fait monter l'opposition en soutien ou le soutien en majorité. Lois : avec Jev (positions −1..1), 3 ou 4 lois franchement rejetées de suite font passer un soutien dans l'opposition ; avec les tags, l'effet est faible (SOC sur les retraites : −0,10, soit −0,015 par loi), à la même échelle que le vote.

Lois du mois = adoptées avec `promulgueLe` = ce mois : tick, 49.3 fait entre deux ticks (compté au tick du mois), `previewBill` (la loi compte dans la trajectoire « avec » : elle peut y faire basculer un groupe et donc modifier la stabilité par la cohésion, c'est voulu). Les votes et la censure du mois (étape 2) utilisent les rapports d'avant, comme `forecastVote`. Censure adoptée : aucun effet direct (texte non promulgué ; la nomination qui suit applique les règles ci-dessous).

**Cohabitation** : les relations de l'Assemblée bougent mais ses rapports restent figés jusqu'à la prochaine dissolution (§11.7). **Sénat** dynamique : même relation, mêmes seuils, jamais gelé ; non touché par les nominations, la cohabitation, la dissolution ni le 49.3 (`senatGroupes(s)` : rapports changés dans `s.senat`, sinon `rapport_gouvernement`).

**Nominations et cohabitation issue des urnes** (`appliquer(s, g, choix)`) : rapports = ceux du profil (jamais filtrés par les seuils) ; relation = `REL0[nouveau] + memoire × (relation − REL0[ancien])` (mémoire des griefs) `− cout_rupture × crans perdus` (nomination seulement) `− fidelite` (camp choisi seulement : les groupes du bloc du camp, quand la nomination fait entrer en majorité un groupe d'un autre bloc : le parti punit l'ouverture), puis `dansBande` : ramenée dans la bande du rapport resserrée de h/2 (majorité [0,35 ; 1], soutien [−0,25 ; 0,45], opposition [−1 ; −0,15]), donc aucune nomination ne fait rebasculer un groupe d'elle-même. Exemples : SOC en soutien puis `camp_presidentiel` → opposition à −0,7 ; après une censure due à un 49.3 (SOC ≈ −0,05) → −0,775 ; `ouverture_gauche` → majorité à 0,6 (0,45 si SOC était à −0,2). Un test garde `cout_rupture` < REL0.soutien − (seuil_soutien − h) = 0,4. `elections` appelle `appliquer(…, false)` en cas de cohabitation ou quand elle prend fin ; `scrutin` ne touche pas `s.relations`.

**Dissolution** : les groupes de l'Assemblée hors opposition perdent `parlement_relation_dissolution` (leurs sièges sont remis en jeu). La majorité reste vers 0,43 à 0,5, loin de sa sortie (0,3).

**Positionnement du Président** (`positionPresident`, non stocké, dérivé de `s.bills` : couvre tick, 49.3 et `previewBill`, rétroactif pour les sauvegardes en cours) : position du parti du joueur, puis pour chaque loi adoptée hors loi de finances (le budget annuel ne déplace rien), par ordre de promulgation, sur chaque axe `p += deplacement × axe × (axe × p > 0 ? 1 − |p| : 1)`, borné à ±1 (pas faible, amorti vers les extrêmes) : au plus 0,024 par loi ; douze lois de droite font passer l'économie d'Horizons de 0,36 à ≈ 0,52 (distance horizons–lr : 0,58).
**Électeurs qui suivent** (premier tour seulement : les intentions du tick et les législatives ne bougent pas) : pour chaque autre candidat p, `δ = electeurs_suivent × (k(p, position) − k(p, position initiale))`, `k = exp(−report_distance × distance)` ; δ > 0 : le joueur prend δ × I_p ; δ < 0 : il rend δ × I_joueur × I_p / Σ I_autres. Somme conservée, identité exacte à dérive nulle (une dérive de 0,2 vers LR prend ≈ 0,5 point à LR, sous le bruit de sondage). **Reports** du second tour : distance à la position courante du joueur. Sans loi adoptée, la présidentielle est identique au bit près.

**Camp** (`newGame({ seed, mode, camp })`, Décret et Bac à sable ; ignoré en Réaliste ou pour un parti hors des intentions). `camp` = parti des intentions de vote ; `campBloc(s)` = son bloc (absent : le centre). `choisirCamp` : `s.camp` ; si `campAutre(s)` (bloc ≠ centre) → gouvernement `camp_presidentiel` sans nom (PM fictif), toujours en coalition minoritaire, jamais en cohabitation (le joueur garde le 49.3), rapports de `profilCamp`, relations absentes (REL0). Camp `horizons` : départ réel (Lecornu), seule la fidélité s'ajoute.
- `profilCamp(s, profil)` (camp hors du centre ; sinon profils des données), sur les sièges initiaux (stable, mis en cache par bloc et profil) : blocs en majorité M = [i] (`camp_presidentiel`), [i, i+1] (`ouverture_gauche`), [i−1, i] (`ouverture_droite`), i = rang du bloc du camp dans l'ordre droite → gauche des données (indices hors bornes ignorés) ; `technicien` = profil des données, bloc du camp au moins en soutien. Soutien conditionnel : blocs adjacents à M et hors blocs (LIOT, NI) ; autres → opposition. **Plancher** : tant que l'opposition compte moins de sièges qu'au départ réel (OPP0 = 265, sièges en opposition dans `politics.json`), le groupe en soutien le plus éloigné du parti de tête du bloc du camp passe dans l'opposition : aucun camp ne démarre plus à l'abri de la censure que le départ réel. Départs (majorité / soutien / opposition, 575 sièges pourvus) : RN, Reconquête, DLF 139 / 80 / 356 ; LR 49 / 208 / 318 (le RN passe dans l'opposition) ; PP, Écologistes 107 / 192 / 276 ; LFI, PCF, LO 88 / 138 / 349.
- `rapportDe(s, g)` : cohabitation = coalition → majorité, bloc du camp → soutien ; sinon `profilCamp` ou profils des données. `majPres(s)` : camp hors du centre = [bloc du camp, autres blocs de la première coalition qui le contient] ; sinon `majorite_presidentielle`. `bloc(s)` (`tick.ts`) : partis du bloc du camp. `coh0(s)` : cohésion de référence du terme de stabilité = cohésion du départ du camp (sinon un camp minoritaire démarrerait avec un choc de stabilité).
- `joueur(s)` = `s.camp ?? JOUEUR` : candidat à la présidentielle ; les événements `presidentielle` portent `joueur`.
- `pouvoir()` ajoute `joueur`, `relations` (Assemblée et Sénat, toujours complet), `senat`, `positionnement`, `positionnementInitial` (`positionDe(joueur)`), `campAutre`. Nouveau `TurnEvent` `rapport` : `{ chambre, groupId, avant, apres }`.

**Sauvegardes** : `camp`, `relations` et `senat` sont facultatifs, au premier niveau de `GameState` (jamais dans `internals`) ; `newGame` sans camp ne les écrit pas (la première fin de mois écrit `relations`). Absents : camp réel, REL0, rapports du Sénat des données. `version` reste 1. Partie 2026 Réaliste « au gouvernement » sans loi : identique au bit près ; avec lois, seuls l'issue de la présidentielle et une bascule (0 dans le banc) peuvent différer.

**Calage** (`npm run balance`, ligne « bascules » et section « Camps ») : critère = 0 bascule dans toutes les cohortes « au gouvernement », votes, calage 2026 et « Ne rien faire » identiques, défaites à ±2 sur 50. Mesure : 0 bascule partout ; Relance 39 → 37 et SMIC 39 → 37 défaites (la loi rapproche le Président de la gauche : meilleurs reports face au RN), autres scénarios et cohorte de dissolution inchangés. Réglages en cas d'écart : une bascule due à la popularité → baisser `parlement_relation_poids_popularite`, jamais les seuils ; une bascule due à une loi → `par_loi` à 0,1 ; plus de 2 défaites présidentielles d'écart → baisser `presidentielle_deplacement_par_loi` (0,06 puis 0,04 donnaient −3 sur Relance : 0,03 retenu).

**Limites** : barrage défini par bloc (pas par position) ; popularité de départ commune à tous les camps (0,18 : victoire prévue ≈ 78 % pour le RN, ≈ 0 pour les autres camps choisis) ; pas de remaniement volontaire ni de majorité négociée ; fond des tags faible (dépend des axes des tags) ; bonus de vote discret (entre deux seuils, la relation n'agit pas sur le vote) ; profils génériques des camps approximatifs (voisinage de blocs) ; la relation ne dépend pas de la position du Président.

## 14. Réformes de structure (`src/reformes.ts`, `gamedata/reformes.json`)

Code : `src/reformes.ts` (catalogue, règles, montants, effets ; pur, sans tirage, n'importe pas `init.ts`), `tick.ts` (`circuit`, budget), `parliament.ts` (`fond`, `voteCongres`, `isBudget`, `can493`), `institutions.ts` (`scrutin`, `referendumOui`, `resoudreReferendum`, `forecastCircuit`), `index.ts` (`validateBill`, `canDeposit`, `deposit`, `amend`, `previewBill`). Coefficients `reforme_satisfaction_max` et `referendum_*` (requis, `hypothese: true`).

**Contrat.** `BillSpec.reforme` (facultatif, un modèle au plus par texte) : `creer_impot { assiette, taux }`, `supprimer_impot { impot }`, `proportionnelle { seuil 0-10 %, prime 0-25 % }`, `suppression_493 { portee: totale | hors_budget }`, `capitalisation { part 1-20 % }`. Listes fermées dans `schemas.ts` (`MODELES`, `ASSIETTES`, `IMPOTS`, `VOIES`). `Bill.voie` (`congres` | `referendum`) : fixée au dépôt (`deposit(state, id, voie?)`, la première voie du modèle par défaut), seulement pour une révision constitutionnelle hors décret. `Bill.referendum { date, oui, adopte }`. Un texte en cours de circuit reste `preparation`. `rampMonths` sert aussi de montée en charge de la réforme.

**Règles dérivées** (`regles(s)`, sur le modèle de `positionPresident`) : lues dans les lois adoptées, rien dans `GameState` (`version` reste 1, sauvegardes compatibles) : `{ proportionnelle?, sans493?, supprimes, crees, capitalisation? }`, exposées par `pouvoir().regles`. Doublon (`obstacleReforme`) : un autre texte de même clé (modèle, ou modèle et assiette ou impôt) en préparation ou adopté → refus au dépôt (`canDeposit`, tous modes) et à la validation. Une réforme compte comme le dépôt du mois. `amend` refuse, pour une réforme déposée, tout changement de clé et tout amendement après le premier vote. `validateBill` : taux dans les bornes de l'assiette, un des `tags_requis`, ni levier ni effet qualitatif ni loi de finances dans une révision, pas de levier lié à l'impôt supprimé (dans le même texte, puis dans toute loi ultérieure). `validateBill(state, spec, billId?)` : `billId` (projet amendé) est exclu du contrôle de doublon.

**Budget.** d = recette en plus à pleine charge (Md€ 2026) :
- créer : `R(τ) = k · τ · e^(−η τ)` (k = `rendement_par_unite`, η = `erosion` ; maximum de Laffer en 1/η) ;
- supprimer : `−recette_2026` de l'impôt, sur sa ligne (`ligne`) ;
- capitalisation : `−part/100 × cotisations_retraite_2026` sur `recettes.cotisations_sociales` ; `depenses.retraites` ne bouge pas (pensions dues : déficit de transition ; le gain sur les pensions arrive après 2030, non simulé).

`montantsReformes(s, t, scale)` : montants du mois en Md€ courants (× `centralFactor`), × rampe `min(1, (k+1)/rampMonths)` (k = mois depuis la promulgation, convention d'`effectValue`) ; `null` sans réforme budgétaire. Dans le tick : `discR = disc + R[ligne]` aux étapes 5 et 6 (sans réforme, `discR === disc` : mêmes flottants) ; un impôt créé a sa ligne `recettes.impot_<assiette>`, ajoutée en fin d'objet après les lignes de `budget.json`, comptée dans l'impulsion (`− multiplicateur_prelevements_court_terme × R`), le total, le déficit et les PO. L'offre structurelle `Ol` (Okun) compte les effets `reforme` comme ceux des leviers.

**Effets non budgétaires** (`effetsReforme`, à la promulgation) : format des effets de `levers.json`, élasticité par Md€ 2026 de recette en plus, amplitude = élasticité × d (une suppression inverse le signe) ; `debut = t + delai_mois`, `rampe = max(rampe_mois, rampMonths)` pour un effet `niveau`, `rampe_mois` seul pour un `choc` (forme copiée du levier, sinon la rampe écrase le pic). Cible `budget` interdite (validateur). Effets de groupe plafonnés à ±`reforme_satisfaction_max` (0,15 ; IR supprimé : +0,19 sinon pour les cadres) et pondérés par `satisfaction_poids_lois` (branche hors événement de `sumEffects`, sans le plafond des effets qualitatifs). `groupes_touches` (sens d > 0, × signe de d) s'ajoutent à `billGroups` : tension, popularité et vote seulement, jamais la satisfaction (§3). Un impôt supprimé efface les effets et remet à zéro le `delta` de ses leviers liés ; `promulgate` ignore ensuite ces leviers dans un texte déposé avant la suppression.

**Circuit constitutionnel** (art. 89). Proportionnelle et suppression du 49.3 : `voies: ["congres", "referendum"]` ; les trois modèles budgétaires : `[]` (loi ordinaire, navette du §4, 49.3 possible).

| Voie | Étapes | Règles |
|---|---|---|
| `congres` | Assemblée puis Sénat au mois du vote ; Congrès le mois suivant | texte identique : un rejet d'une chambre → `rejetee` (veto du Sénat, ni CMP ni dernier mot) ; Congrès = Assemblée et Sénat réunis (`voteCongres` : deux tirages de chambre), adopté si `5 × pour ≥ 3 × (pour + contre)` (3/5 des suffrages exprimés, constante de la Constitution) |
| `referendum` | Assemblée puis Sénat ; scrutin `referendum_campagne_mois` (2) plus tard | oui > 50 % ; un seul tirage gaussien |

**Vote sur le fond** : sur une révision (`constitutionnel(spec)`, chambres et Congrès, prévisions comprises), le bonus de rapport du §4 est multiplié par `1 − parlement_revision_malus_bonus` (1 : aucun bonus, le groupe vote selon `fond`, la popularité et l'accueil). Banc (seed 1, état initial) : Congrès 3 % sur la suppression du 49.3 (31 % avec le bonus, le bloc central suivant le gouvernement malgré −0,8), 25 % sur la proportionnelle (78 %) ; Sénat 26 % et 31 %. Lois ordinaires inchangées.

L'étape se déduit des votes (`circuit`, tick) : tous les votes comptent, sans filtre de législature : un texte voté par les deux chambres survit à une dissolution (précédent de 1973) ; pendant une dissolution, l'étape est reportée d'un mois comme les autres votes. Pas de 49.3 sur une révision. Les nouveaux tirages (Congrès, référendum) ne concernent que les textes qui ont une `voie`.

**Référendum** (`referendumOui`) : `oui = 100 σ(poids_popularite × (popularité − pivot) + poids_consignes × consignes + incertitude × z)`, consignes = moyenne, pondérée par les sièges de l'Assemblée, de `clamp(fond + relation, −1, 1)`.

| Coefficient | Valeur | Rôle |
|---|---|---|
| `referendum_poids_popularite` | 4 | plébiscite sur le Président |
| `referendum_pivot` | 0,35 | popularité neutre |
| `referendum_poids_consignes` | 1 | consignes unanimes ≈ +23 points autour de 50 % |
| `referendum_incertitude` | 0,3 | choc de campagne (logit), ≈ ±7 points |
| `referendum_campagne_mois` | 2 | délai après le vote des chambres |
| `referendum_duree_choc_mois` | 6 | chocs d'après scrutin |
| `referendum_echec_relation` | 0,1 | relations de tous les groupes après un échec |

Recoupements (banc, consignes approximatives, z = 0) : 1969 (popularité 0,45, consignes −0,3) → 52 % contre 47,6 % ; 1992 (0,3 ; 0,4) → 55 contre 51,0 ; 2000 (0,5 ; 0,8) → 80 contre 73,2 ; 2005 (0,35 ; 0,3) → 57 contre 45,3 : le modèle sous-estime le vote sanction de 2005. À l'état initial (popularité 0,18), oui ≈ 37 à 40 % : un référendum lancé tout de suite est perdu. `resoudreReferendum` tire z seulement en tick normal (`aleatoire: false` : z = 0, `s.rng` intact). Échec : chocs `event` `referendum:<billId>` (popularité −« moyenne », stabilité −« faible », tension +« faible », barème existant, `referendum_duree_choc_mois`), relations de tous les groupes − `referendum_echec_relation` (bornées à −1 ; les seuils du §13 jouent à l'étape 7b) ; en bac à sable aussi (ce n'est pas une défaite). Succès : popularité +« faible ». Événement `referendum { billId, oui, adopte }`.

**49.3** (`can493`) : `sans493 = totale` → plus jamais ; `hors_budget` → seulement pour un texte budgétaire (`isBudget`). Refusé aussi sur une réforme dont un doublon a été déposé après son rejet (`obstacleReforme`).

**Proportionnelle** (`scrutin`) : poids d'un bloc = voix de ses partis au-dessus du seuil (seuil par parti, sur les intentions de présidentielle) × `exp(legislatives_incertitude × z / legislatives_exposant)` × prime de popularité du camp `^(1/exposant)` : même incertitude relative et même prime qu'au scrutin majoritaire, ramenées à l'échelle des voix ; ni barrage ni ancrage local. Sièges : prime majoritaire `round(prime % × N)` au bloc en tête, le reste à la proportionnelle (plus forts restes) ; N = 577 − sièges des hors blocs. Même nombre de tirages : `forecastLegislatives` suit. Banc (seed 1) : RN 251 au scrutin majoritaire, 215 à la proportionnelle à 5 % (Reconquête et DLF sous le seuil), 265 avec une prime de 15 %.

**Modes.** Décret : pas de voie, promulgation sans vote au mois prévu. Bac à sable : votes simulés, pas de défaite. Dissolution : report du §11 avant le circuit, votes et étape conservés.

**Prévisualisation** (§8) : la branche « avec » promulgue la réforme (règles comprises) au mois du Congrès pour une révision ; `circuit` et `legislatives` décrits au §8.

**Garantie du banc** : sans réforme, tout nouveau calcul du tick est derrière `R` (null) ou `b.voie` ; aucune clé ajoutée à `rec`/`dep` ; `scrutin` tire toujours ses 5 gauss ; `fond`, `can493`, `isBudget` et `billGroups` ne changent qu'avec `spec.reforme` ou une règle en vigueur ; aucun tirage nouveau. `npm run balance` : sortie d'avant = préfixe exact de la nouvelle (section « Réformes » ajoutée en fin).

**Limites** :
- montants indexés sur le compte central, sans élasticité conjoncturelle propre (un IR supprimé laisse un résidu de l'ordre de EPS × écart × base) ;
- effets des leviers liés effacés d'un coup, alors que la recette décroît en rampe ;
- LIOT et NI gardent leurs sièges à la proportionnelle ; seuil appliqué par parti aux intentions de présidentielle ;
- pas d'abrogation, ni de suppression d'un impôt créé ;
- gain de la capitalisation non simulé ; sa baisse de cotisations garde l'effet de demande d'une baisse de prélèvement (ponytail) ;
- pas de référendum de l'art. 11, pas de blocage des voies constitutionnelles en cohabitation ;
- prévisualisation au délai du Congrès (un référendum arriverait `referendum_campagne_mois − 1` mois plus tard) ;
- proportionnelle en circuit constitutionnel par choix de jeu : en droit, elle relève de la loi ordinaire (art. 34, loi de 1985) ; `"voies": []` dans `reformes.json` suffit pour y revenir ;

## 15. Conseil constitutionnel (`src/conseil.ts`)

Contrôle a priori des lois votées (Constitution, art. 61 al. 2 et 3, art. 62). Mode Réaliste et bac à sable ; jamais en décret ni sur une révision constitutionnelle (le Conseil n'est pas compétent : 2003-469 DC).

**Saisine** (`saisine(s, b)`, pure, sans tirage), à l'adoption définitive (tick étape 2) ou après un 49.3 dont la censure est rejetée (`use493`) :
- groupes hors majorité dont `fond(b, chambre, groupe)` < seuil ; seuil = `conseil_seuil_opposition` (−0,4, « fortement opposé ») pour une loi ordinaire, 0 pour une loi de finances ou un texte passé par 49.3 (saisine quasi systématique en pratique) ;
- Assemblée d'abord, puis Sénat ; saisine si les sièges des groupes retenus atteignent 60 (art. 61 al. 2, constante constitutionnelle) ;
- `bill.saisine = { chambre, groupes, sieges, decisionLe }`, événement `saisine` ; le texte reste (ou redevient, après un 49.3) `preparation`, sans retrait, amendement ni 49.3 ;
- `decisionLe` : mois suivant (art. 61 al. 3) ; même mois pour une loi de finances (le Conseil statue fin décembre ; décidée dans le tick, pas de loi spéciale à tort). Au dernier tick (décembre 2030, t = 59), `decisions` décide tout texte encore déféré : une loi votée (ou passée par 49.3) ce mois-là n'attend pas 2031, où la partie est finie.

État initial (seed 1) : Retraites, SMIC, Immigration, Climat et Compétitivité saisis ; Relance, Défense et Dérapage non ; Austérité et Austérité brutale saisies après leur 49.3.

**Articles exposés** (`articles(b)`, pur) :
- loi de finances : cavaliers budgétaires (LOLF art. 34), p = `conseil_p_cavalier` (0,7), pour chaque levier sans effet `budget` (aujourd'hui `energie.trve`, `travail.duree_legale`, `regulation.taux_livret_a`) et chaque mesure qualitative hors budget ;
- loi ordinaire : mesures qualitatives selon e = exposition maximale de ses tags (`tags[].conseil` : `immigration_restriction` 0,5 et `securite_justice` 0,35 pour atteinte aux libertés ; `redistribution` et `fiscalite_hausse` 0,15 pour rupture d'égalité) : forte → e, moyenne → e × `conseil_part_moyenne` (0,4), faible → 0. Les leviers d'une loi ordinaire ne sont jamais exposés (pouvoir général d'appréciation du Parlement) : les textes du banc, faits de leviers seuls, ne perdent aucun effet ;
- impôt créé (`creer_impot`) : caractère confiscatoire, p = `conseil_p_confiscatoire` × clamp((τη − 1)/0,5, 0, 1), η = érosion de l'assiette. Aucun risque sous le maximum de Laffer 1/η, donc aucun taux par défaut exposé ; seul `tres_hauts_patrimoines` au-delà de 2,86 % l'est (0,6 à partir de 4,3 %).

**Probabilités** (`risqueConseil(s, b)`, pure, partagée par la décision, la prévisualisation et le banc) : n = max(1, leviers + mesures + réforme) ; `totale = conseil_totale_base + conseil_totale_pente × Σp/n` ; `partielle = (1 − totale)(1 − Π(1 − p))`. Articles retirés lors d'une censure partielle : ceux à p ≥ max(p)/2 ; s'ils couvrent les n articles de fond, la censure est totale. Écart volontaire à la spécification : ce cas étant déterministe, sa part partielle est reportée dans `totale` (même tirage, même issue), pour que l'aperçu annonce ce que fera la décision (un impôt seul à 4 % : totale ≈ 51 %).

**Décision** (`decider`, étape 2a) : un seul tirage `rand(graine(s, 15, t, n° de la loi))` (§6), identique en tick normal et en prévisualisation, `s.rng` intact. u < totale → censure totale ; u < totale + partielle → censure partielle ; sinon conforme. Pas de report pendant une dissolution (le Conseil est indépendant de l'Assemblée).
- **Conforme** : popularité + `conseil_popularite_conforme` (« victoire » légère), promulgation.
- **Partielle** : `spec` réduite (leviers, mesures ou réforme retirés), `saisine.censures` rempli (motif, libellé, élément retiré), promulgation du texte réduit (`promulgate` ne lit que `spec` ; les tags restent : `billGroups` et positionnement inchangés) ; popularité `bareme.popularite.faible × retirés / n` (négatif) ; relations des groupes de l'Assemblée hors opposition − `conseil_relation_censure`.
- **Totale** : `rejetee`, `saisine.issue = 'totale'`, aucune promulgation ; popularité −« moyenne », stabilité −« faible » ; relations hors opposition − 2 × `conseil_relation_censure`.
- Chocs : source `event` `conseil:<billId>`, forme choc, `conseil_duree_choc_mois`. Relations bornées à −1 (comme `dissolve`) ; les seuils du §13 jouent à l'étape 7b. Événements `conseil { issue, censures }` puis `promulgation`.
- Retard d'un mois : effets, rampes, `tension_lois_duree_mois`, relations (§13) et malus 49.3 partent au mois de la décision ; le delta des leviers est calculé à la valeur courante.

| Coefficient | Valeur | Rôle |
|---|---|---|
| `conseil_seuil_opposition` | −0,4 | fond sous lequel un groupe défère une loi ordinaire |
| `conseil_p_cavalier` | 0,7 | risque d'un cavalier budgétaire |
| `conseil_part_moyenne` | 0,4 | part de l'exposition pour une mesure moyenne |
| `conseil_p_confiscatoire` | 0,6 | risque maximal d'un impôt confiscatoire |
| `conseil_totale_base` | 0,005 | censure totale de base (vice de procédure) |
| `conseil_totale_pente` | 0,1 | hausse avec l'exposition moyenne |
| `conseil_popularite_conforme` | 0,005 | victoire d'une loi validée |
| `conseil_relation_censure` | 0,05 | camouflet pour les groupes qui ont porté le texte |
| `conseil_duree_choc_mois` | 6 | durée des chocs |

**Calage du banc** (section « Conseil constitutionnel ») : lois du banc saisies 29 % des fois sur 50 graines (100 % des adoptions définitives d'Austérité, Retraites, SMIC et Austérité brutale, presque jamais Relance, Défense, Dérapage : la censure de 49.3 en abat beaucoup avant) ; délai vote → promulgation 1 mois pour un texte saisi. Batterie synthétique : immigration (mesure forte) partielle ≈ 49 %, totale ≈ 3 % ; sécurité (moyenne) 14 % et 1 % ; loi de finances avec cavalier 67 % et 4 % ; impôt à 4 % : totale ≈ 51 % (article unique) ; lois du banc : 0,5 % de totale par saisine. Fréquences observées sur 50 graines conformes au risque prévu.

**Garantie du banc** : sans saisine, rien ne change (aucun tirage de `state.rng`, la décision tire sur une graine dérivée). Sorties identiques : Scénarios (décret), Votes (10 graines), Calage 2026, Camps, colonnes décret des Réformes. Écarts : défaites en démocratie des textes saisis (promulgation un mois plus tard, d'où un autre enchaînement d'événements aléatoires : ±2 sur 50, Austérité brutale 41 → 43 dont 5 soulèvements), dissolution au 13e mois (popularité décalée), défaites des réformes en démocratie (±2).

**Limites** : pas de QPC ; pas de saisine d'office des lois organiques ; leviers d'une loi ordinaire jamais censurés ; réserves d'interprétation non modélisées ; la saisine ne dépend que du fond (pas de calcul tactique de l'opposition) ; trajectoire de prévisualisation sans délai ni censure.

## 16. Bilan et score de fin de mandat (`src/bilan.ts`)

`engine.bilan(state): Bilan` : score 0-100, mention, six rubriques notées 0-100 et trois faits marquants au plus. Pur : aucun tirage, aucune écriture (test et banc : JSON de l'état identique avant et après). `provisoire = !isOver(s)` : l'onglet Sondages l'affiche en cours de partie (repliable), la fenêtre de fin de mandat et la carte de partage à la fin. Choix de jeu, sans source : les coefficients `bilan_*` sont des hypothèses de jeu.

**Références** : D = national de janvier 2026 (`newGame({ seed: 1 })`, indépendant de la graine et du camp, calculé une fois) ; satisfaction de départ = moyenne simple des `satisfaction_initiale` ; F = national courant ; moyH = moyenne sur `s.history`. Historique vide (partie neuve) : toutes les notes et le score valent 50, aucun fait.

**Deux écritures dans l'état**, sans tirage : `internals['n:dissolutions']` (+1 par `dissolve`, clé absente = 0) et `internals['pres:reelu']` (§12). Clé `pres:reelu` absente (sauvegarde antérieure) : réélection déduite (mois ≥ juin 2027, pas de défaite, hors bac à sable).

| Rubrique | Note (bornée à 0-100, k = `bilan_k_*`) |
|---|---|
| Finances publiques | 50 − k_dette × Δdette − k_deficit × Δdéficit |
| Emploi et croissance | 50 − k_chomage × Δchômage + k_croissance × (moyH croissance − `croissance_potentielle_long_terme`) |
| Pouvoir d'achat | 50 + k_satisfaction × Δsatisfaction moyenne − k_inflation × max(0, moyH inflation − `cible_inflation_bce`) − k_pauvrete × Δpauvreté |
| Cohésion | 50 − k_tension × Δtension + k_stabilite × Δstabilité |
| Popularité | 50 + k_popularite × Δpopularité |
| Parcours institutionnel | `bilan_institutions_base` + `bilan_pts_loi` × min(`bilan_lois_max`, lois adoptées hors loi de finances) + `bilan_pts_reelection` × réélu − `bilan_pts_censure` × gouvernements renversés − `bilan_pts_conseil_totale` × censures totales − `bilan_pts_conseil_partielle` × censures partielles (§15) − `bilan_pts_dissolution` × dissolutions |

Δ = F − D. Score = round(Σ `bilan_poids_*` × note), poids de somme 1 (finances et emploi 0,2, les autres 0,15). Plafond : `bilan_plafond_defaite` (35) après une défaite dette, régime ou soulèvement, `bilan_plafond_presidentielle` (45) après une présidentielle perdue. Chaque rubrique porte une phrase chiffrée (« Dette 125,0 % du PIB (+9,3), déficit 6,3 % (+1,2) »).

**Mention** (première règle vérifiée ; seuils de libellé codés en dur, pas de dynamique) : défaite → Banqueroute, Crise de régime, Le pays dans la rue, Mandat sans lendemain ; score ≥ 75 → Quinquennat historique ; ≥ 62 avec au moins 3 lois ou une réforme → Quinquennat réformateur ; finances ≥ 65 et popularité < 40 → Rigueur impopulaire ; emploi ≥ 65 et finances < 35 → Relance à crédit ; cohésion < 30 → Mandat de crise ; au plus une loi → Mandat d'attente ; score ≥ 50 → Mandat de gestion ; sinon Mandat contrasté.

**Faits marquants** : les 3 de plus fort poids, puis triés par date. Défaite (100), réélection de mai 2027 (90), gouvernement renversé sur un texte (75), réforme adoptée (70), référendum gagné ou perdu (70), législatives anticipées (ou de juin 2029, §17), avec « cohabitation » si c'est le profil en cours (65), loi censurée en totalité par le Conseil (60), première grève générale (premier mois avec tension ≥ `seuil_tension_greve_generale`, 55), chômage ramené à X % si Δ ≤ −1 (50), dette à X % du PIB si Δ ≥ +10 (50), censure partielle (30).

**Interface** : fenêtre de fin de mandat (App.tsx `FinDeMandat`, à la place de l'ancienne fenêtre de défaite) avec score, mention, rubriques, faits et « Partager mon quinquennat » ; bilan provisoire repliable en tête de l'onglet Sondages ; carte de partage (Share.tsx) avec les six rubriques notées /100 à la place des indicateurs quand la partie est finie. Pas d'image OG côté serveur (aucune route, il faudrait une dépendance) : la carte reste dessinée dans le navigateur.

**Calage du banc** (section « Bilan de fin de mandat », 50 graines) : « Ne rien faire » en bac à sable 46,3 (44 à 49 ; finances 36, emploi 52, pouvoir d'achat 50, cohésion 38, popularité 49, institutions 54), toutes en « Mandat d'attente ». Écart au prototype (institutions ≈ 55, score ≈ 47) : le prototype supposait la réélection ; en bac à sable sans action, 12 parties sur 50 seulement sont réélues. Avec `bilan_institutions_base` = 40, l'inaction valait 45,4 avant les législatives de juin 2029, puis 44,6 avec elles (le scrutin fait perdre de la cohésion, donc de la stabilité : note de cohésion 43 → 38) ; la base est portée à 50 (note neutre, comme les autres rubriques), d'où 46,3, dans la cible 45-50. En démocratie, les scénarios du banc se tiennent entre 41 (Austérité brutale, dont 8 défaites plafonnées à 35) et 46 : la plupart des parties s'arrêtent à la présidentielle (plafond 45), et une loi isolée ne change que quelques points (Dérapage : finances 27, emploi 73). Aucune défaite au-dessus de son plafond ; aucun état modifié par `bilan()`.

**Garantie du banc** : lecture seule ; les deux écritures nouvelles (`n:dissolutions`, `pres:reelu`) ne sont lues que par le bilan. Le bilan ne change aucune autre section du banc (les écarts de ces sections viennent du §17).

**Limites** : réélection inconnue avant mai 2027 dans le bilan provisoire (comptée 0) ; notes relatives à janvier 2026, pas à une trajectoire contrefactuelle sans action (l'inaction ne vaut pas 50) ; le score ne regarde que l'état final et les moyennes de croissance et d'inflation (une crise passée et résorbée ne pèse que par les faits marquants) ; pas de classement en ligne.

## 17. Législatives de juin 2029 (`src/institutions.ts`, `src/tick.ts`)

**Échéance** : `echeanceLegislatives(s)` = juin de l'année du dernier scrutin + 5. Les pouvoirs de l'Assemblée expirent le troisième mardi de juin de la cinquième année qui suit son élection (code électoral, art. LO121) et le scrutin a lieu dans les 60 jours qui précèdent (LO122). Rien n'est stocké : l'échéance se déduit de `institutions.legislatives`. Assemblée de juillet 2024 : juin 2029 (t = 41). Après une dissolution, l'échéance tombe en 2031 ou plus tard, donc hors partie : jamais de double scrutin. `Pouvoir.prochainesLegislatives` l'expose (interface, contexte du conseiller).

**Tick**
- Étape 1a : au mois échéance − 3 (mars 2029), hors défaite et hors dissolution en cours, échéance `legislatives_2029_annonce` (« Législatives en juin 2029 », date du 3e mardi de juin par `troisiemeMardiJuin`, 19 juin 2029). Aucun effet, aucun tirage.
- Étape 2 : au mois de l'échéance (`normales` = pas de dissolution, pas de défaite, tick normal), les votes du mois sont reportés d'un mois comme pendant une dissolution (mode démocratie), circuit des révisions compris. Les décisions du Conseil constitutionnel (2a) ne sont pas reportées.
- Étape 2b : `elections(s, t, true)`. Le scrutin tire sur la graine dérivée `graine(s, 17, t)` (§6) : `state.rng` n'avance pas, les législatives anticipées restent inchangées au bit près. Mêmes règles que des législatives anticipées (§11 : sièges, issue, démission ou cohabitation, choc de popularité, `legislatives` = juin 2029), sans le choc de stabilité de campagne (posé par `dissolve` seulement) ni le choc de relation. Événement `legislatives` avec `normales: true`.
- Cohésion de référence : un scrutin ordinaire n'est pas une crise de majorité. Au premier mois où le gouvernement n'est plus démissionnaire (nomination, cohabitation ou décret : dès le tick du scrutin), `internals['coh:ref']` = min(`coh0`, cohésion) remplace `coh0` dans le terme de cohésion de la stabilité (étape 8) jusqu'à la fin ; `internals['coh:attente']` marque l'attente. Une dissolution efface les deux clés (législatives anticipées inchangées). Sauvegarde sans ces clés : `coh0`, comme avant.
- Mode décret : le scrutin a lieu (sièges, choc de popularité, date), mais le gouvernement sortant reste, sans démission ni cohabitation, et sans événement de nomination.
- Après le scrutin, l'article 12 interdit une dissolution jusqu'en juin 2030 (automatique : `dissolutionPossible` suit `legislatives`).
- Cohérence avec 2027 : présidentielle perdue en Réaliste ou en décret, la partie est finie (pas de scrutin) ; en bac à sable, le scrutin a toujours lieu ; une cohabitation en cours suit la logique du §11 (une majorité présidentielle donne un gouvernement technicien démissionnaire).

**Pas de gel de dissolution** avant l'échéance : écart volontaire au cahier des charges. La règle n'existe pas en droit (l'article 12 ne joue qu'après un scrutin ; dissolution du 21 avril 1997, onze mois avant l'échéance de 1998) et serait inutile, puisque l'échéance se recalcule après une dissolution. Le remède tiendrait en une ligne dans `pouvoir()`.

**Interface et prompts** : « Soirée électorale (législatives de juin 2029) : … » ; ligne « Prochaines législatives : juin 2029 » dans l'onglet Pouvoir (si l'échéance est à venir et tombe avant la fin de la partie) ; avis « Législatives à la fin du mois : votes du mois reportés » (sans « votes du mois reportés » en décret) au mois de l'échéance ; le narrateur reçoit `normales`, le conseiller `prochaines_legislatives` (PROMPT_VERSION 7). Bilan (§16) : fait marquant « Législatives de juin 2029 ».

**Coefficients** : aucun nouveau (ceux du §11). `bilan_institutions_base` est porté de 40 à 50 (§16) pour garder l'inaction en bac à sable dans la cible du bilan.

**Calage du banc** (section « Législatives de juin 2029 », 50 graines) : en démocratie, 12 à 13 parties sur 50 atteignent juin 2029 sans action, ou avec Relance ou SMIC (les autres s'arrêtent à la présidentielle) : 9 à 10 sans majorité, 2 à 4 cohabitations, centre prévu 98-99 et obtenu 98-101 sièges, stabilité 0,33 en mai 2029 et 0,31-0,32 en fin de partie, aucune défaite de plus qu'avec le scrutin repoussé. En bac à sable sans action : 39 sans majorité et 11 cohabitations (prototype : 37 et 13 ; la graine dérivée et le report des votes changent les tirages). Dérapage (+90 Md€) atteint 2029 dans 20 parties : sans la cohésion de référence, 10 finissaient en crise de régime après le scrutin (la perte de cohésion d'une Assemblée sans majorité, bornée à 0,05, faisait passer sa stabilité, déjà minée par le spread, sous `defaite_stabilite_seuil`), ce que le cahier des charges excluait (« 0 défaite de plus ») ; avec elle, aucune (stabilité de fin 0,23). Idem pour « supprimer ir » et « supprimer taxe_fonciere » dans la colonne démocratie des Réformes (plus aucune défaite de régime).

**Garantie** : sans scrutin en juin 2029 (dissolution antérieure, défaite, prévisualisation), la sortie est identique au bit près, puisque la graine dérivée ne touche pas `state.rng`. Les écarts du banc par rapport au bilan (§16) : Défaites (Austérité : événements/an 2,6 → 2,5 ; Dérapage inchangé, 30), Réformes en démocratie (inchangées), Bilan (cohésion des parties qui atteignent 2029, base institutions). Scénarios décret, Votes, Dissolution au 13e mois (arrêtée au mois 25), Calage 2026, Camps, colonnes décret des Réformes et Conseil constitutionnel : identiques.

**Limites** : date du scrutin au mois près (pas de deux tours datés) ; pas de législatives en prévisualisation ; pas de campagne (choc de stabilité, relations) ; les textes non votés passent simplement à la nouvelle Assemblée (pas de caducité) ; une seule échéance possible dans la partie.
