import type { BundleItem } from "~/lib/gift-optimizer";

export type DiscountTier = {
  threshold: number;
  rate: number; // e.g. 0.1 for 10%
  cap?: number; // maximum amount eligible for discount (before rate)
};

export type DiscountableItem = BundleItem & {
  discountable: boolean;
};

export type AppliedDiscount = {
  threshold: number;
  rate: number;
  cap: number | null;
  qualifyingPositions: number[];
  discountedPositions: number[];
};

export type DiscountResult = {
  discountedItems: BundleItem[];
  totalBefore: number;
  totalAfter: number;
  savings: number;
  appliedTier: AppliedDiscount | null;
};

const MAX_DP_LIMIT = 200_000;

export function applyTieredDiscounts(
  items: DiscountableItem[],
  tiers: DiscountTier[]
): DiscountResult {
  const sanitizedItems = items.map((item) => ({
    ...item,
    amount: Math.floor(item.amount),
  }));

  const totalBefore = sanitizedItems.reduce((sum, item) => sum + item.amount, 0);
  if (!sanitizedItems.length || !tiers.length) {
    return {
      discountedItems: sanitizedItems,
      totalBefore,
      totalAfter: totalBefore,
      savings: 0,
      appliedTier: null,
    };
  }

  const sortedTiers = [...tiers].sort((a, b) => a.threshold - b.threshold);
  const eligible = sanitizedItems.filter((item) => item.discountable);
  const eligibleTotal = eligible.reduce((sum, item) => sum + item.amount, 0);

  let best: DiscountResult = {
    discountedItems: sanitizedItems,
    totalBefore,
    totalAfter: totalBefore,
    savings: 0,
    appliedTier: null,
  };

  for (const tier of sortedTiers) {
    if (tier.threshold <= 0 || tier.rate <= 0) continue;
    if (eligibleTotal < tier.threshold) continue;

    const qualifying = findCheapestQualifyingSubset(eligible, tier.threshold);
    if (!qualifying) continue;

    const qualifyingSet = new Set(qualifying.positions);
    const cap = Number.isFinite(tier.cap || NaN) ? Math.max(0, tier.cap!) : null;
    let remainingCap = cap ?? Infinity;
    let savings = 0;

    const discountedItems = sanitizedItems.map((item) => {
      const base = item.amount;
      if (!item.discountable || qualifyingSet.has(item.position)) {
        return { amount: base, position: item.position };
      }

      const discountablePortion = Math.min(base, remainingCap);
      remainingCap = Math.max(0, remainingCap - discountablePortion);

      const discountedAmount =
        discountablePortion > 0
          ? base - discountablePortion * tier.rate
          : base;

      savings += discountablePortion * tier.rate;

      return {
        amount: Math.floor(Math.max(0, discountedAmount)),
        position: item.position,
      };
    });

    const totalAfter = discountedItems.reduce((sum, item) => sum + item.amount, 0);

    const discountedPositions = sanitizedItems
      .filter((item) => item.discountable && !qualifyingSet.has(item.position))
      .map((item) => item.position);

    const candidate: DiscountResult = {
      discountedItems,
      totalBefore,
      totalAfter,
      savings,
      appliedTier: {
        threshold: tier.threshold,
        rate: tier.rate,
        cap: cap ?? null,
        qualifyingPositions: qualifying.positions,
        discountedPositions,
      },
    };

    if (candidate.savings > best.savings + 1e-6) {
      best = candidate;
      continue;
    }

    if (
      Math.abs(candidate.savings - best.savings) <= 1e-6 &&
      candidate.appliedTier &&
      best.appliedTier &&
      candidate.appliedTier.rate > best.appliedTier.rate
    ) {
      best = candidate;
    }
  }

  return best;
}

function findCheapestQualifyingSubset(
  items: DiscountableItem[],
  threshold: number
): { total: number; positions: number[] } | null {
  if (!items.length) return null;

  const maxAmount = items.reduce((max, item) => Math.max(max, item.amount), 0);
  const limit = Math.min(MAX_DP_LIMIT, threshold + maxAmount);

  // DP over sums to find the smallest sum >= threshold.
  const reachable = new Uint8Array(limit + 1);
  const prev = new Int32Array(limit + 1).fill(-1);
  const prevItemIdx = new Int32Array(limit + 1).fill(-1);
  reachable[0] = 1;

  items.forEach((item, idx) => {
    const amt = item.amount;
    for (let s = limit - amt; s >= 0; s--) {
      if (!reachable[s]) continue;
      const next = s + amt;
      if (!reachable[next]) {
        reachable[next] = 1;
        prev[next] = s;
        prevItemIdx[next] = idx;
      }
    }
  });

  let bestSum = -1;
  for (let s = threshold; s <= limit; s++) {
    if (reachable[s]) {
      bestSum = s;
      break;
    }
  }

  if (bestSum === -1) {
    // Fallback greedy: sort ascending and accumulate.
    const sorted = [...items].sort((a, b) => a.amount - b.amount);
    let total = 0;
    const positions: number[] = [];
    for (const item of sorted) {
      total += item.amount;
      positions.push(item.position);
      if (total >= threshold) {
        return { total, positions };
      }
    }
    return null;
  }

  const positions: number[] = [];
  let cursor = bestSum;
  while (cursor > 0) {
    const idx = prevItemIdx[cursor];
    if (idx === -1) break;
    positions.push(items[idx].position);
    cursor = prev[cursor];
  }

  return { total: bestSum, positions };
}
