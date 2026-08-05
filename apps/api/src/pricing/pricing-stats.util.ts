/**
 * Small, dependency-free numeric helpers shared by the anomaly-detection and
 * rollup services. Deliberately pure functions (no Prisma/NestJS imports)
 * so they're trivially testable and reusable.
 */

/** Sorted-array median. Returns null for an empty input. */
export function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Linear-interpolation percentile (p in [0,1]) over a sorted array. */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const rank = p * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  const weight = rank - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * Median Absolute Deviation, scaled by 1.4826 so it approximates a standard
 * deviation for normally-distributed data (the standard convention). Returns
 * { median, scaledMad }. scaledMad is 0 when every value is identical.
 */
export function scaledMedianAbsoluteDeviation(values: number[]): { median: number; scaledMad: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const med = median(sorted) ?? 0;
  const deviations = sorted.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  const mad = median(deviations) ?? 0;
  return { median: med, scaledMad: mad * 1.4826 };
}

export function sortNumeric(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}
