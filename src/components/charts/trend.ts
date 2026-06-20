export type ChartPoint = { x: number; y: number }

/** Drop points victory/Skia can't plot (NaN/Infinity coordinates poison the whole path). */
export function finitePoints<T extends ChartPoint>(data: T[]): T[] {
  return data.filter((d) => Number.isFinite(d.x) && Number.isFinite(d.y))
}

/** Least-squares linear regression → slope + intercept. */
export function leastSquares(data: ChartPoint[]): { slope: number; intercept: number } {
  const n = data.length
  if (n < 2) return { slope: 0, intercept: data[0]?.y ?? 0 }
  let sx = 0
  let sy = 0
  let sxy = 0
  let sxx = 0
  for (const { x, y } of data) {
    sx += x
    sy += y
    sxy += x * y
    sxx += x * x
  }
  const denom = n * sxx - sx * sx || 1
  const slope = (n * sxy - sx * sy) / denom
  const intercept = (sy - slope * sx) / n
  return { slope, intercept }
}

/** Add a `trend` field (the regression value at each x) so victory can plot a trend line. */
export function withTrend(data: ChartPoint[]): (ChartPoint & { trend: number })[] {
  const { slope, intercept } = leastSquares(data)
  return data.map((d) => ({ ...d, trend: slope * d.x + intercept }))
}
