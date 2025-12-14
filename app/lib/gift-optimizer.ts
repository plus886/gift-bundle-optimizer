export type BundleItem = {
  amount: number;
  position: number;
};

export type BundleGroup = {
  total: number;
  items: BundleItem[];
};

export type BundleOptimizationResult = {
  groups: BundleGroup[];
  leftover: BundleItem[];
  totalGifts: number;
  threshold: number;
  totalAmount: number;
  coveredAmount: number;
};

export const MAX_ITEMS = 50;

/**
 * Calculate the combination of purchases that yields the most gifts.
 * Uses bitmask dynamic programming and is limited to MAX_ITEMS inputs to
 * keep the search space tractable in the browser.
 */
export function optimizeGiftBundles(
  items: BundleItem[],
  threshold: number
): BundleOptimizationResult {
  const sanitized = items
    .map((item, index) => ({
      amount: Math.floor(item.amount),
      position: item.position ?? index + 1,
    }))
    .filter((item) => Number.isFinite(item.amount) && item.amount > 0);

  if (!sanitized.length || threshold <= 0) {
    return {
      groups: [],
      leftover: sanitized,
      totalGifts: 0,
      threshold,
      totalAmount: sanitized.reduce((sum, item) => sum + item.amount, 0),
      coveredAmount: 0,
    };
  }

  if (sanitized.length > MAX_ITEMS) {
    throw new Error(`最多僅能計算 ${MAX_ITEMS} 筆消費資料。`);
  }

  const n = sanitized.length;
  const totalAmount = sanitized.reduce((sum, item) => sum + item.amount, 0);
  const limit = 1 << n;
  const subsetSums = new Array<number>(limit).fill(0);

  for (let mask = 1; mask < limit; mask++) {
    const lsb = mask & -mask;
    const bitIndex = Math.log2(lsb);
    subsetSums[mask] = subsetSums[mask ^ lsb] + sanitized[bitIndex].amount;
  }

  const dp = new Array<number>(limit).fill(0);
  const parent = new Array<{ prev: number; subset: number } | null>(limit).fill(
    null
  );

  for (let mask = 1; mask < limit; mask++) {
    let best = 0;
    let bestSubset = 0;
    let sub = mask;

    while (sub) {
      if (subsetSums[sub] >= threshold) {
        const candidate = dp[mask ^ sub] + 1;
        if (candidate > best) {
          best = candidate;
          bestSubset = sub;
        }
      }

      sub = (sub - 1) & mask;
    }

    dp[mask] = best;
    if (bestSubset) {
      parent[mask] = { prev: mask ^ bestSubset, subset: bestSubset };
    }
  }

  let bestMask = 0;
  let totalGifts = 0;

  for (let mask = 0; mask < limit; mask++) {
    if (dp[mask] > totalGifts) {
      totalGifts = dp[mask];
      bestMask = mask;
    }
  }

  const groups: BundleGroup[] = [];
  const usedPositions = new Set<number>();
  let cursor = bestMask;

  while (cursor) {
    const node = parent[cursor];
    if (!node) {
      break;
    }
    const { prev, subset } = node;
    const items: BundleItem[] = [];

    for (let bit = 0; bit < n; bit++) {
      if ((subset >> bit) & 1) {
        const item = sanitized[bit];
        items.push(item);
        usedPositions.add(item.position);
      }
    }

    groups.push({
      total: items.reduce((sum, item) => sum + item.amount, 0),
      items,
    });

    cursor = prev;
  }

  groups.reverse();

  const leftover: BundleItem[] = sanitized.filter(
    (item) => !usedPositions.has(item.position)
  );

  const coveredAmount = groups.reduce((sum, group) => sum + group.total, 0);

  return {
    groups,
    leftover,
    totalGifts,
    threshold,
    totalAmount,
    coveredAmount,
  };
}
