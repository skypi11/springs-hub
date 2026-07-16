export const meta = {
  name: 'adversarial-review',
  description: 'TEMPLATE de review adversariale multi-agents : N lentilles spécialisées, chaque finding contre-vérifié par des réfuteurs indépendants',
  phases: [
    { title: 'Review', detail: 'lentilles spécialisées en parallèle' },
    { title: 'Verify', detail: 'réfutation indépendante de chaque finding' },
  ],
}

// ── COMMENT UTILISER CE TEMPLATE ─────────────────────────────────────────────
// Le passage d'`args` à un workflow NOMMÉ n'est pas fiable dans ce runtime, et
// les lentilles d'une review sont TOUJOURS spécifiques au composant audité.
// Donc : COPIER ce script dans un Workflow({ script }) inline, et remplir les
// 3 zones ci-dessous. C'est le pattern éprouvé (reviews Lots 0-2).
//
// À REMPLIR :
//   CONTEXT    : fichiers à auditer + docs sources de vérité + décisions métier
//                déjà tranchées à NE PAS re-débattre.
//   DIMENSIONS : 3 à 5 lentilles { key, prompt } d'experts spécialisés. Chaque
//                prompt finit par « Rends UNIQUEMENT des défauts concrets avec
//                le scénario exact ».
//   budget     : 'eco' (1 réfuteur, medium) | 'normal' (2 réfuteurs, high) |
//                'critique' (2 réfuteurs high + preuve par test exigée).

const CONTEXT = `<< à remplir : fichiers, docs sources, décisions tranchées >>`
const DIMENSIONS = [
  // { key: 'transactions', prompt: `Tu es ... Rends UNIQUEMENT des défauts concrets avec scénario.` },
]
const budget = 'normal' // 'eco' | 'normal' | 'critique'

const refuterCount = budget === 'eco' ? 1 : 2
const refuterEffort = budget === 'eco' ? 'medium' : 'high'
const proofTests = budget === 'critique'

if (DIMENSIONS.length === 0) throw new Error('Remplis CONTEXT et DIMENSIONS avant de lancer.')

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
  DIMENSIONS,
  d => agent(
    `${d.prompt}\n\nContexte commun :\n${CONTEXT}\n\nRéponds via StructuredOutput.`,
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
          `Contexte du projet :\n${CONTEXT}\n\n` +
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
