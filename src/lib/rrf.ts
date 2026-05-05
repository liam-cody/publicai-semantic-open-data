/**
 * Reciprocal Rank Fusion — merge multiple ranked id lists without score calibration.
 * @param lists Each list is ordered best-first (ids at rank 0 = best)
 * @param k RRF constant (common default 60)
 */
export function reciprocalRankFusion(lists: number[][], k = 60): { id: number; score: number }[] {
  const scores = new Map<number, number>()

  for (const list of lists) {
    list.forEach((id, rank) => {
      const inc = 1 / (k + rank + 1)
      scores.set(id, (scores.get(id) ?? 0) + inc)
    })
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
}
