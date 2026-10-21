# Moteur Hexagone

Moteur de simulation du jeu [Hexagone](https://hexagone2027.com) : la France au 1er janvier 2026, gouvernée mois par mois jusqu'en décembre 2030.

Ce dépôt contient la partie ouverte du jeu :

- `src/` : moteur déterministe en TypeScript pur (sans DOM ni réseau). Tick mensuel (macroéconomie, finances publiques, opinion, tensions régionales), leviers et lois, Parlement (votes, 49.3, censure), institutions (gouvernement, dissolution, cohabitation), événements aléatoires, fins de partie anticipées.
- `gamedata/` : état initial et coefficients, chaque valeur sourcée ou marquée comme hypothèse (`gamedata/SOURCES.md`).
- `ENGINE.md` : conventions et formules. En cas de doute, ce fichier fait foi.
- `scripts/` : validation des données, parties complètes sans joueur, banc d'équilibrage.

Le modèle de langage, l'interface et le serveur du jeu ne sont pas ici : le moteur ne reçoit que des projets de loi déjà structurés (`BillSpec`).

## Utilisation

Node 22.18 ou plus récent.

```bash
npm install
npm test            # tests Vitest
npm run validate    # valide gamedata/*.json et leurs cohérences croisées
npm run smoke       # parties complètes 2026-2030, échoue sur NaN ou dérive absurde
npm run balance     # tableaux d'équilibrage (scénarios, votes, calibration 2026)
```

```ts
import { engine } from './src/index.ts';

let state = engine.newGame({ seed: 42, mode: 'democratie' });
const { state: next, report } = engine.endTurn(state);
```

L'API complète est décrite par l'interface `Engine` de `src/types.ts`. Même état et mêmes actions donnent toujours le même résultat : l'aléa passe par un générateur initialisé par la graine et stocké dans l'état.

## Licence

[AGPL-3.0](LICENSE). Un service qui utilise ce moteur, modifié ou non, doit publier son code source sous la même licence.

Les contributions sont bienvenues (corrections de données, de sources, de formules). Ouvrez d'abord un ticket pour en discuter : une contribution acceptée sera soumise à un accord de cession de droits, pour pouvoir être intégrée au jeu.
