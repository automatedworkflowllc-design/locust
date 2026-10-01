/**
 * WHAT A JUDGE IS ASKED (0.520), after Artificial Analysis's Optima, whose
 * results are graded "against custom rubric criteria" by a judge model.
 *
 * Locust's comparison is a person's own question, not a benchmark, so the
 * judge is one model the person picks, asked once, after the answers are
 * in. It reads them under blind letters -- never the models' names, so a
 * judge cannot favour its own maker -- against what the person says a good
 * answer does, if they said. It answers in plain prose the comparison shows
 * as the judge's view; it never keeps an answer, the person does.
 *
 * Bounded: each answer is quoted up to `ANSWER_CHARS`, and a cut is said.
 */
export const ANSWER_CHARS = 6_000

export interface JudgedAnswer {
  /** "A", "B", "C": the column's letter, never its model. */
  readonly letter: string
  readonly text: string
}

function quoted(text: string): string {
  const trimmed = text.trim()
  return trimmed.length <= ANSWER_CHARS ? trimmed : `${trimmed.slice(0, ANSWER_CHARS)}\n[This answer continues; the rest is not shown here.]`
}

export function judgePrompt(input: { readonly ask: string; readonly answers: readonly JudgedAnswer[]; readonly criteria?: string }): string {
  const criteria = input.criteria?.trim()
  return [
    'You are judging answers that different AI models gave to the same request. Do not use any tools and do not change any files: read, and give your view.',
    `The request was:\n\n${input.ask.trim()}`,
    ...input.answers.map((answer) => `Answer ${answer.letter}:\n\n${quoted(answer.text)}`),
    ...(criteria === undefined || criteria.length === 0 ? [] : [`The person says a good answer does this:\n\n${criteria}`]),
    [
      'Reply in plain prose, in this order:',
      `- For each answer (${input.answers.map((answer) => `Answer ${answer.letter}`).join(', ')}), one or two sentences: what it did well and what it missed${criteria === undefined || criteria.length === 0 ? '' : ', against what the person said a good answer does'}.`,
      '- Then one sentence: which answer you would keep, and why.',
      'Call them only Answer A, Answer B and so on. Do not guess which model wrote which.'
    ].join('\n')
  ].join('\n\n')
}
