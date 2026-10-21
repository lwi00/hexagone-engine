// Valide gamedata/*.json contre src/schemas.ts, puis les cohérences entre fichiers.
// Usage : npm run validate            (tous les fichiers présents)
//         npm run validate -- macro    (un seul fichier)
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import * as S from '../src/schemas.ts';

const FILES: Record<string, z.ZodTypeAny> = {
  macro: S.Macro,
  budget: S.Budget,
  regions: S.Regions,
  groups: S.Groups,
  politics: S.Politics,
  'events-2026': S.Events,
  'events-random': S.RandomEvents,
  levers: S.Levers,
  coefficients: S.Coefficients,
  tags: S.Tags,
};

// Clés présentes dans le JSON mais absentes du schéma (zod les supprimerait en silence).
const unknownKeys = (raw: any, parsed: any, path: string, out: string[]) => {
  if (Array.isArray(raw) && Array.isArray(parsed)) raw.forEach((r, i) => unknownKeys(r, parsed[i], `${path}[${i}]`, out));
  else if (raw && typeof raw === 'object' && parsed && typeof parsed === 'object')
    for (const k of Object.keys(raw)) k in parsed ? unknownKeys(raw[k], parsed[k], `${path}.${k}`, out) : out.push(`${path}.${k}: clé hors schéma`);
};

const only = process.argv[2];
const errors: string[] = [];
const data: Record<string, any> = {};
const load = (name: string) => JSON.parse(readFileSync(`gamedata/${name}.json`, 'utf8'));

for (const [name, schema] of Object.entries(FILES)) {
  if (only && only !== name) continue;
  if (!existsSync(`gamedata/${name}.json`)) { if (only) errors.push(`${name}: fichier absent`); continue; }
  const raw = load(name);
  const r = schema.safeParse(raw);
  if (!r.success) r.error.issues.forEach((i) => errors.push(`${name}: ${i.path.join('.')} — ${i.message}`));
  else { data[name] = r.data; unknownKeys(raw, r.data, name, errors); }
}

if ((!only || only === 'regions.geojson') && existsSync('gamedata/regions.geojson')) {
  const g = JSON.parse(readFileSync('gamedata/regions.geojson', 'utf8'));
  const codes = (g.features ?? []).map((f: any) => f.properties?.code).sort();
  if (g.type !== 'FeatureCollection') errors.push('regions.geojson: pas une FeatureCollection');
  if (JSON.stringify(codes) !== JSON.stringify([...S.REGION_CODES].sort()))
    errors.push(`regions.geojson: codes attendus ${S.REGION_CODES.join(',')}, trouvés ${codes.join(',')}`);
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= Math.abs(b) * tol;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

const { macro, budget, regions, groups, politics, levers, coefficients, tags } = data;
const ev = data['events-2026'];
if (budget) {
  const r = sum(Object.values(budget.recettes).map((s: any) => s.value));
  const d = sum(Object.values(budget.depenses).map((s: any) => s.value));
  if (!near(r, budget.total_recettes.value, 0.01)) errors.push(`budget: somme recettes ${r} ≠ total ${budget.total_recettes.value}`);
  if (!near(d, budget.total_depenses.value, 0.01)) errors.push(`budget: somme dépenses ${d} ≠ total ${budget.total_depenses.value}`);
  for (const k of [...S.RECETTES]) if (!(k in budget.recettes)) errors.push(`budget: recette ${k} manquante`);
  for (const k of [...S.DEPENSES]) if (!(k in budget.depenses)) errors.push(`budget: dépense ${k} manquante`);
  if (macro && !near(budget.pib_reference_md, macro.indicators.pib_nominal.value, 0.06))
    errors.push(`budget: pib_reference_md ${budget.pib_reference_md} incohérent avec macro.pib_nominal ${macro.indicators.pib_nominal.value}`);
}
if (regions) {
  const codes = new Set(regions.map((r: any) => r.code));
  if (codes.size !== 18) errors.push('regions: codes en double');
  if (macro) {
    const pop = sum(regions.map((r: any) => r.population.value)) / 1e6;
    if (!near(pop, macro.indicators.population.value, 0.02)) errors.push(`regions: population totale ${pop.toFixed(2)} M ≠ macro ${macro.indicators.population.value} M`);
  }
  regions.forEach((r: any) => {
    const t = sum(Object.values(r.composition_sociale.parts) as number[]);
    if (!near(t, 1, 0.05)) errors.push(`regions.${r.code}: composition sociale = ${t.toFixed(3)} (attendu ≈ 1)`);
  });
}
if (groups) {
  const s = sum(groups.map((g: any) => g.part_population_adulte.value));
  if (!near(s, 1, 0.05)) errors.push(`groups: somme des parts = ${s.toFixed(3)} (attendu ≈ 1)`);
  const ids = new Set((politics?.parties ?? []).map((p: any) => p.id));
  groups.forEach((g: any) => {
    const t = sum(g.vote.resultats.map((r: any) => r.pct));
    if (t > 101 || t < 90) errors.push(`groups.${g.id}: vote total = ${t}% (attendu 90..101)`);
    if (politics) g.vote.resultats.forEach((r: any) => { if (!ids.has(r.party_id)) errors.push(`groups.${g.id}: parti inconnu ${r.party_id}`); });
  });
}
if (politics) {
  for (const ch of ['assemblee', 'senat'] as const) {
    const c = politics[ch];
    const n = sum(c.groupes.map((g: any) => g.sieges)) + c.vacants;
    if (n !== c.total) errors.push(`politics.${ch}: sièges + vacants = ${n} ≠ ${c.total}`);
    const ids = new Set(politics.parties.map((p: any) => p.id));
    c.groupes.forEach((g: any) => g.parties.forEach((p: string) => { if (!ids.has(p)) errors.push(`politics.${ch}.${g.id}: parti inconnu ${p}`); }));
  }
  if (!politics.parties.some((p: any) => p.id === politics.president.party_id)) errors.push('politics: party_id du président inconnu');
  const pct = sum(politics.intentions_vote.resultats.map((r: any) => r.pct));
  if (pct > 101) errors.push(`politics: intentions de vote = ${pct}%`);
  // Institutions : chaque groupe AN dans un seul bloc (ou hors blocs), chaque parti du sondage dans un seul bloc.
  const I = politics.institutions, an = politics.assemblee.groupes.map((g: any) => g.id);
  const sondage = politics.intentions_vote.resultats.map((r: any) => r.party_id);
  const blocIds = I.blocs.map((b: any) => b.id);
  const once = (what: string, attendus: string[], cites: string[]) => {
    for (const id of attendus) { const n = cites.filter((x) => x === id).length; if (n !== 1) errors.push(`politics.institutions: ${what} ${id} cité ${n} fois`); }
    for (const id of cites) if (!attendus.includes(id)) errors.push(`politics.institutions: ${what} inconnu ${id}`);
  };
  once('groupe', an, [...I.blocs.flatMap((b: any) => b.groupes), ...I.hors_blocs]);
  once('parti', sondage, I.blocs.flatMap((b: any) => b.parties));
  for (const id of [...I.majorite_presidentielle, ...I.coalitions_opposition.flatMap((c: any) => c.blocs)])
    if (!blocIds.includes(id)) errors.push(`politics.institutions: bloc inconnu ${id}`);
  for (const p of I.profils) for (const id of Object.keys(p.rapports)) if (!an.includes(id)) errors.push(`politics.institutions.${p.id}: groupe inconnu ${id}`);
}
const leverIds = new Set((levers ?? []).map((l: any) => l.id));
if (levers) {
  if (leverIds.size !== levers.length) errors.push('levers: ids en double');
  levers.forEach((l: any) => {
    const v = l.valeur_initiale.value;
    if (v < l.min || v > l.max) errors.push(`levers.${l.id}: valeur initiale ${v} hors [${l.min}, ${l.max}]`);
  });
}
const checkTarget = (where: string, t: any) => {
  if (t.kind === 'indicator' && !(S.INDICATORS as readonly string[]).includes(t.id)) errors.push(`${where}: indicateur inconnu ${t.id}`);
  if (t.kind === 'indicator' && (S.DERIVED_INDICATORS as readonly string[]).includes(t.id)) errors.push(`${where}: ${t.id} est dérivé par le moteur, cibler une ligne budget / prime_risque / notation`);
  if (t.kind === 'budget' && !S.BUDGET_LINES.includes(t.id)) errors.push(`${where}: ligne budgétaire inconnue ${t.id}`);
  if (['budget', 'indicator', 'group', 'region', 'lever'].includes(t.kind) && !t.id) errors.push(`${where}: id requis pour kind ${t.kind}`);
  if (t.kind === 'group' && !(S.SOCIAL_GROUPS as readonly string[]).includes(t.id)) errors.push(`${where}: groupe inconnu ${t.id}`);
  if (t.kind === 'region' && !(S.REGION_CODES as readonly string[]).includes(t.id)) errors.push(`${where}: région inconnue ${t.id}`);
  if (t.kind === 'lever' && levers && !leverIds.has(t.id)) errors.push(`${where}: levier inconnu ${t.id}`);
};
levers?.forEach((l: any) => l.effets.forEach((e: any) => {
  checkTarget(`levers.${l.id}`, e.cible);
  if (e.forme === 'choc' && !e.duree_mois) errors.push(`levers.${l.id}: effet choc sans duree_mois`);
}));
ev?.forEach((e: any) => {
  e.effets.forEach((f: any) => checkTarget(`events.${e.id}`, f.cible));
  if (e.type === 'echeance' && e.effets.length) errors.push(`events.${e.id}: une échéance n'a pas d'effet mécanique`);
});
const rnd = data['events-random'];
if (rnd && new Set(rnd.map((e: any) => e.id)).size !== rnd.length) errors.push('events-random: ids en double');
const VARIABLES = [...S.INDICATORS, 'popularite', 'tension', 'stabilite', ...S.SOCIAL_GROUPS.map((g) => `groupe:${g}`)] as string[];
rnd?.forEach((e: any) => {
  e.effets.forEach((f: any) => {
    if (f.cible.kind === 'region' && !f.cible.id) { if (!e.region) errors.push(`events-random.${e.id}: effet region sans id ni tirage de région`); }
    else checkTarget(`events-random.${e.id}`, f.cible);
  });
  e.conditions.forEach((c: any) => { if (!VARIABLES.includes(c.variable)) errors.push(`events-random.${e.id}: variable inconnue ${c.variable}`); });
});
if (coefficients) {
  const ids = new Set(coefficients.map((c: any) => c.id));
  if (ids.size !== coefficients.length) errors.push('coefficients: ids en double');
  if (!only) S.REQUIRED_COEFFICIENTS.forEach((id) => { if (!ids.has(id)) errors.push(`coefficients: ${id} manquant`); });
}
if (tags && new Set(tags.map((t: any) => t.id)).size !== tags.length) errors.push('tags: ids en double');

if (errors.length) {
  console.error(errors.map((e) => `✗ ${e}`).join('\n'));
  process.exit(1);
}
console.log(`✓ ${Object.keys(data).join(', ') || 'aucun fichier'} valides`);
