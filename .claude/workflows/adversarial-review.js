export const meta = {
  name: 'adversarial-review',
  description: 'Review adversariale multi-agents : N lentilles spécialisées, chaque finding contre-vérifié par des réfuteurs indépendants',
  whenToUse: 'Après avoir construit un composant substantiel (lot, module, lib critique) et AVANT de le considérer fini. Args : { context, dimensions, budget? ("eco"|"normal"|"critique"), proofTests? }',
  phases: [
    { title: 'Review', detail: 'lentilles spécialisées en parallèle' },
    { title: 'Verify', detail: 'réfutation indépendante de chaque finding' },
  ],
}

// ── Paramètres ───────────────────────────────────────────────────────────────
// args.context     : string — contexte commun injecté dans chaque lentille
//                    (fichiers à auditer, docs sources de vérité à lire,
//                    décisions métier déjà tranchées à NE PAS re-débattre).
// args.dimensions  : Array<{ key: string, prompt: string }> — les lentilles.
//                    Chaque prompt doit finir par « Rends UNIQUEMENT des
//                    défauts concrets avec le scénario exact ».
// args.budget      : 'eco' (1 réfuteur, effort medium) | 'normal' (2 réfuteurs,
//                    effort high — défaut) | 'critique' (2 réfuteurs effort
//                    high + preuve par test exigée).
// args.proofTests  : true → les réfuteurs doivent PROUVER le bug en écrivant
//                    un test exécuté puis supprimé (défaut si budget=critique).

if (!args || !args.context || !Array.isArray(args.dimensions) || args.dimensions.length === 0) {
  throw new Error('args requis : { context: string, dimensions: [{key, prompt}], budget?, proofTests? }')
}

const budget = args.budget ?? 'normal'
const refuterCount = budget === 'eco' ? 1 : 2
const refuterEffort = budget === 'eco' ? 'medium' : 'high'
const proofTests = args.proofTests ?? (budget === 'critique')

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          description: { type: 'string' },
          suggestion: { type: 'string' },
        },
        required: ['title', 'file', 'severity', 'description'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reasoning: { type: 'string' },
  },
  required: ['refuted', 'reasoning'],
}

const ANGLES = [
  proofTests
    ? "correctness : le bug est-il réel dans le code tel qu'écrit ? PROUVE-le en écrivant un test temporaire (fichier __probe à SUPPRIMER après exécution) avant de conclure"
    : "correctness : le bug est-il réel dans le code tel qu'écrit ? Vérifie en lisant le code réel, pas la description",
  'impact : même si techniquement vrai, cela cause-t-il un vrai problème en production pour CE projet (volumes réels, humains dans la boucle) ?',
]

const results = await pipeline(
  args.dimensions,
  d => agent(
    `${d.prompt}\n\nContexte commun :\n${args.context}\n\nRéponds via StructuredOutput.`,
    { label: `review:${d.key}`, phase: 'Review', schema: FINDINGS_SCHEMA, effort: 'high' },
  ),
  (review, dim) => {
    if (!review || !review.findings || review.findings.length === 0) return []
    return parallel(review.findings.slice(0, 8).map(f => () =>
      parallel(ANGLES.slice(0, refuterCount).map(angle => () =>
        agent(
          `Tu es un vérificateur adversarial (angle ${angle}).\n` +
          `Finding à RÉFUTER si possible (dimension ${dim.key}) :\n` +
          `Titre : ${f.title}\nFichier : ${f.file}${f.line ? ':' + f.line : ''}\nSévérité annoncée : ${f.severity}\n` +
          `Description : ${f.description}\nSuggestion : ${f.suggestion ?? '—'}\n\n` +
          `Contexte du projet :\n${args.context}\n\n` +
          `Si le finding est faux, exagéré, contraire à une décision métier déjà validée, ou déjà couvert ailleurs → refuted=true avec la preuve. ` +
          `En cas de doute réel sur un blocker/major, refuted=false.`,
          { label: `verify:${dim.key}:${f.title.slice(0, 28)}`, phase: 'Verify', schema: VERDICT_SCHEMA, effort: refuterEffort },
        )))
        .then(verdicts => {
          const valid = verdicts.filter(Boolean)
          const refutations = valid.filter(v => v.refuted)
          return {
            ...f,
            dimension: dim.key,
            // Tué seulement si TOUS les réfuteurs le réfutent — le doute profite au finding.
            survived: refutations.length < Math.max(1, valid.length),
            refutations: valid.map(v => ({ refuted: v.refuted, reasoning: v.reasoning.slice(0, 400) })),
          }
        })
    ))
  }
)

const all = results.filter(Boolean).flat().filter(Boolean)
const survived = all.filter(f => f.survived)
log(`${all.length} findings bruts, ${survived.length} survivants après réfutation (budget ${budget})`)
return {
  survived: survived.sort((a, b) => {
    const rank = { blocker: 0, major: 1, minor: 2 }
    return rank[a.severity] - rank[b.severity]
  }),
  killed: all.filter(f => !f.survived).map(f => ({ title: f.title, severity: f.severity, dimension: f.dimension })),
}
