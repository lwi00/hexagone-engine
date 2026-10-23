# Moteur Hexagone : conventions (phase 1)

Contrat de types : `src/types.ts`. Données : `gamedata/*.json` (schémas `src/schemas.ts`, conventions `gamedata/SOURCES.md`).
Formules des dynamiques : champ `description` de chaque coefficient de `gamedata/coefficients.json`. Référence numérique : `scripts/papersim.cjs`.
Les règles ci-dessous tranchent les ambiguïtés relevées par la critique de la phase 0.5. En cas de conflit, ce fichier l'emporte.

## 1. Temps et ordre du tick

Un seul projet déposé par mois (`canDeposit`, `deposit` refuse le second) ; les lois de finances (`spec.loiDeFinances`) n'entrent pas dans ce compte. Les brouillons restent illimités. `amend` remplace le texte d'un projet en brouillon ou en préparation (un projet déposé garde sa date de vote). Un projet retiré disparaît à la fin du mois.

Un tick = un mois. `endTurn` applique, dans cet ordre, en utilisant les valeurs du mois précédent pour les boucles (spread ↔ stabilité, satisfaction ↔ chômage) :

1. **Événements** du mois (`events-2026.json`, date au mois près) : `exogene` → effets actifs ; `echeance` → simple `TurnEvent` (aucun effet).
1b. **Événement aléatoire** (§5b) : au plus un par mois.
2. **Lois** : celles dont `voteLe` = ce mois sont votées (§4) ; adoptées → `promulgueLe` = ce mois ; leurs leviers et effets qualitatifs démarrent. Assemblée dissoute ce mois-ci (mode démocratie) : votes du mois reportés d'un mois (`voteLe` = mois suivant, aucun vote). Seuls comptent les votes de l'Assemblée en place : un texte adopté par une Assemblée dissoute (puis rejeté au Sénat) est revoté par les deux chambres.
2b. **Législatives anticipées** (§11) si une dissolution a été prononcée ce mois-ci.
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
- **49.3** après un rejet : budget (tag `fiscalite_*`/`austerite_depenses`/`relance_depenses` et coût ≠ 0) illimité, sinon une fois par année civile. Motion de censure votée immédiatement par les groupes hors majorité (opposition et soutien conditionnel : l'opposition seule n'atteint pas 289 sièges) selon `p_contre` ; adoptée si ≥ 289 voix → loi rejetée (`censuree`), choc de stabilité `censure_choc_stabilite` sur `censure_duree_choc_mois`, le gouvernement devient démissionnaire (§11).
- Le 49.3 est impossible en cohabitation (prérogative du PM), pour un gouvernement démissionnaire et pendant une dissolution (§11).
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
- Au tick de décembre, après les votes : sans loi de finances **adoptée** pour l'année suivante, l'État passe sous **loi spéciale** (cas réels : 2025, 2026) : chocs faibles de stabilité (6 mois), de prime de risque (6 mois) et de popularité (3 mois).

## 6. Déterminisme

`mulberry32` initialisé par `seed`, état dans `state.rng`. Aucun `Math.random` ni `Date` dans `src/`. Même état + mêmes actions ⇒ même résultat. Le moteur est pur : chaque fonction renvoie un nouvel état.

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
- Coût : ≈ 20 ms pour 60 mois (test < 100 ms).


## 10. Fin de partie anticipée (défaites)

- Trois causes, chacune avec un seuil (coefficients `defaite_*`) : **dette** (spread ≥ `defaite_spread_seuil`, l'État perd l'accès aux marchés), **régime** (stabilité ≤ `defaite_stabilite_seuil`, le Président démissionne), **soulèvement** (tension nationale ≥ `defaite_tension_seuil`).
- Compteur `internals['def:<cause>']` : +1 par mois au-delà du seuil, remis à 0 dès qu'il repasse. Premier mois : `TurnEvent` `alerte` ; au mois `defaite_mois_consecutifs` : `state.defaite = { cause, date }`, `TurnEvent` `defaite`, et `isOver` devient vrai. Seule la première défaite compte.
- `engine.dangers(state)` liste les compteurs en cours (bandeau d'alerte de l'interface, contexte du conseiller LLM).
- Le spread reçoit un terme non linéaire en déficit (`spread_non_lineaire_deficit`, actif au-delà de 6 %), sans quoi aucune dérive budgétaire ne menait à la crise de la dette.
- Calage (50 graines, `npm run balance`) : aucune défaite sans action ni pour une réforme isolée (retraites, austérité de 20 Md€) ; quelques-unes pour un dérapage de +90 Md€ ou une austérité brutale ; environ deux tiers des parties en cumulant deux réformes brutales ; toujours pour une dérive budgétaire extrême.

## 11. Institutions : gouvernement, censure, dissolution, cohabitation

Code : `src/institutions.ts`. Données : `politics.institutions` (blocs, coalitions, profils). Coefficients `legislatives_*`, `dissolution_*`, `parlement_malus_cohabitation`.

**Règles**
1. **Gouvernement** : `state.institutions?.gouvernement` (profil, PM, date, démission). Les rapports des groupes restent dans `parliament.assemblee[].rapport` (lus par le vote, la censure et la cohésion qui alimente la stabilité) : nommer un PM réécrit les rapports et les relations (§13). Entre deux nominations, les rapports suivent les relations (§13). La discipline des groupes ne change pas.
2. **Censure adoptée** : le gouvernement devient **démissionnaire**. `deposit` est refusé et le 49.3 impossible ; l'interface désactive « Fin du mois » tant qu'aucun PM n'est nommé. Le moteur ne bloque pas `endTurn` (scripts et prévisualisation restent totaux) : les textes déjà en préparation sont votés avec les rapports en place.
3. **Nomination** (`nominate`) : seulement si le gouvernement est démissionnaire, pas de remaniement volontaire. Quatre profils nommables (`camp_presidentiel`, `ouverture_gauche`, `ouverture_droite`, `technicien`), rapports donnés par `profils[].rapports` (groupe absent = opposition). `cohabitation` n'est jamais nommable : seul le tick le pose après des législatives.
4. **Dissolution** (`dissolve`, art. 12) : mode démocratie, partie en cours, aucune dissolution en cours, au moins `dissolution_delai_mois` (12) écoulés depuis le dernier scrutin législatif (juillet 2024 au départ : possible dès janvier 2026). Prononcée au mois t, elle entraîne les deux tours au tick de t (étape 2b). Choc de stabilité `dissolution_choc_stabilite` sur `dissolution_duree_choc_mois` ; votes du mois t reportés d'un mois.
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
