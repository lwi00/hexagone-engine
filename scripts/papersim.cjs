// Simulation papier (sans action du joueur) à partir de gamedata/*.json. Référence pour le moteur de la phase 1. Usage : node scripts/papersim.cjs . <mois> [events]
const dir = process.argv[2], N = +process.argv[3] || 3, withEv = process.argv[4] === 'events';
const J = (f) => require(`${dir}/gamedata/${f}.json`);
const C = Object.fromEntries(J('coefficients').map((c) => [c.id, c.value]));
const M = J('macro'), B = J('budget'), G = J('groups'), P = J('politics'), R = J('regions'), E = J('events-2026');
const ind = (k) => M.indicators[k].value;
const bar = (k, m) => C[`bareme.${k}.${m}`];
// événements actifs au mois t (t=0 = janvier 2026) ; choc actif [mois début, début+duree)
const evs = withEv ? E.filter((e) => e.type === 'exogene').flatMap((e) => e.effets.map((f) => ({ ...f, m0: +e.date.slice(5, 7) - 1, id: e.id }))) : [];
const act = (kind, id, t) => evs.filter((f) => f.cible.kind === kind && (id == null || f.cible.id === id) && t >= f.m0 && (t < f.m0 + f.duree_mois))
  .reduce((s, f) => s + f.direction * (bar(kind === 'indicator' ? { croissance_pib: 'croissance', inflation: 'inflation', chomage_bit: 'chomage' }[id] : kind, f.magnitude) ?? 0), 0);
const gs = C.croissance_potentielle, us = C.chomage_structurel;
let lnY = 0, u = ind('chomage_bit'), pis = ind('inflation'), lnP = 0, lnPd = 0, D = ind('dette_publique_md'), r = C.taux_apparent_dette;
const gHist = Array(6).fill(gs); // ponytail: historique de ḡ initialisé à g* (convention ajoutée dans okun_coefficient)
const Phist = Array.from({ length: 12 }, (_, k) => -(12 - k) * Math.log(1 + ind('inflation') / 100) / 12); // ln P(t-12..t-1)
const defHist = Array(12).fill(ind('deficit_public'));
const pib0 = ind('pib_nominal'), primDef = B.total_depenses.value - B.depenses.interets_dette.value - B.total_recettes.value;
const S0 = M.stabilite.value; let O = 0, Ein = 0, spread = C.spread_constante, interets = 0, pibHist = Array(12).fill(pib0 / 12);
const rows = [];
for (let t = 0; t < N; t++) {
  const Oold = O; O = -C.impact_politique_budgetaire_2026 * -1 / 100 * Math.min(1, (t + 1) / 12) + act('indicator', 'croissance_pib', t) / 100;
  const dlnY = gs / 1200 + (O - Oold); lnY += dlnY; const gm = 1200 * dlnY;
  gHist.push(gm); gHist.shift(); const gbar = gHist.reduce((a, b) => a + b) / 6;
  const ush = act('indicator', 'chomage_bit', t);
  u = u - C.okun_coefficient * (gbar - gs) / 12 + C.chomage_rappel_structurel * (us - u);
  const anc = C.cible_inflation_bce + C.pente_phillips * (us - (u + ush));
  const Eold = Ein; Ein = act('indicator', 'inflation', t) / 100;
  lnP += pis / 1200 + (Ein - Eold); pis = anc + C.inertie_inflation * (pis - anc);
  Phist.push(lnP); const yoy = 100 * (Math.exp(lnP - Phist.shift()) - 1);
  lnPd += (C.deflateur_pib_tendance + (yoy - ind('inflation'))) / 1200;
  const pibM = (B.pib_reference_md / 12) * Math.exp(lnY + lnPd - (C.croissance_potentielle + C.deflateur_pib_tendance) / 1200 * 6); // niveau mensuel centré sur 2026
  pibHist.push(pibM); pibHist.shift(); const pibA = pibHist.reduce((a, b) => a + b);
  const im = C.taux_reference_bund_initial + spread / 100;
  const intM = r / 100 * D / 12; interets += intM; const dD = primDef / 12 + intM;
  const Rf = C.part_dette_refinancee_mois * D; const Dn = D + dD;
  r = (r * (D - Rf - Math.max(0, -dD)) + im * (Rf + Math.max(0, dD))) / Dn; D = Dn;
  defHist.push(100 * dD * 12 / pibA); defHist.shift(); const def12 = defHist.reduce((a, b) => a + b) / 12;
  const dette = 100 * D / pibA;
  const crans = evs.filter((f) => f.cible.kind === 'notation' && t >= f.m0).reduce((s, f) => s + f.direction * ({ faible: 1, moyenne: 2, forte: 3 }[f.magnitude]) * (C.spread_poids_agence_secondaire ?? 1), 0);
  spread = Math.max(0, C.spread_constante + C.spread_sensibilite_deficit * (def12 - ind('deficit_public')) + C.spread_sensibilite_dette * (dette - ind('dette_publique'))
    + C.spread_non_lineaire_dette * Math.max(0, dette - 130) ** 2 + C.spread_degradation_note * crans + act('prime_risque', null, t));
  rows.push({ mois: t + 1, g_m: gm.toFixed(2), gbar: gbar.toFixed(2), chomage: (u + ush).toFixed(3), infl_yoy: yoy.toFixed(2), pi_s: pis.toFixed(2),
    dette_md: D.toFixed(1), dette_pct: dette.toFixed(2), def12: def12.toFixed(2), r_app: r.toFixed(3), interets_annualises: (12 * intM).toFixed(1), spread: spread.toFixed(1), oat: (C.taux_reference_bund_initial + spread / 100).toFixed(2) });
}
console.table(rows);
// scores au point fixe : contrôles d'initialisation
const sumw = G.reduce((s, g) => s + g.part_population_adulte.value, 0);
const pop = G.reduce((s, g) => s + g.part_population_adulte.value * g.satisfaction_initiale.value, 0) / sumw;
const popR = R.reduce((s, x) => s + x.population.value, 0);
const Tm = R.reduce((s, x) => s + x.population.value * x.tension_initiale.value, 0) / popR;
const coh = Math.min(1, P.assemblee.groupes.reduce((s, g) => s + g.sieges * g.discipline * ({ majorite: 1, soutien_conditionnel: 0.5 }[g.rapport_gouvernement] ?? 0), 0) / 289);
console.log({ popularite_politics: P.president.popularite.value, moyenne_satisfaction: pop.toFixed(4), tension_nat: M.tension_nationale.value, moy_tension_regions: Tm.toFixed(4), calage_k: (M.tension_nationale.value - Tm).toFixed(4),
  regions_au_dessus_seuil: R.filter((x) => x.tension_initiale.value >= C.seuil_tension_greves).map((x) => `${x.code}:${x.tension_initiale.value}`), coh: coh.toFixed(3), interets_cumules: interets.toFixed(1) });
