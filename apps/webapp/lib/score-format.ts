export function scoreToPercent(score: number): number {
  return score * 100;
}

export function formatScorePercent(score: number, digits = 1): string {
  return `${scoreToPercent(score).toFixed(digits)}%`;
}
