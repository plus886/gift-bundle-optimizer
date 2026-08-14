import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "~/components/ui/field";
import type { BundleOptimizationResult } from "~/lib/gift-optimizer";
import { MAX_ITEMS, optimizeGiftBundles } from "~/lib/gift-optimizer";

type PurchaseItem = {
  price: string;
  quantity: string;
};

type TieredCalculationResult = {
  /** TIER_CONFIGS と同じ並び（門檻高 → 低） */
  tiers: BundleOptimizationResult[];
  combined: {
    totalAmount: number;
    coveredAmount: number;
    totalGifts: number;
  };
};

type TierConfig = {
  code: string;
  label: string;
  defaultThreshold: string;
  cardAccent: string;
  textAccent: string;
};

// 門檻由高至低排列（計算時依此順序優先湊高門檻）
const TIER_CONFIGS: TierConfig[] = [
  {
    code: "A",
    label: "贈品A",
    defaultThreshold: "3500",
    cardAccent: "from-amber-300/60 to-amber-500/50 text-amber-100",
    textAccent: "text-amber-200",
  },
  {
    code: "B",
    label: "贈品B",
    defaultThreshold: "2000",
    cardAccent: "from-sky-300/60 to-sky-500/50 text-sky-100",
    textAccent: "text-sky-200",
  },
  {
    code: "C",
    label: "贈品C",
    defaultThreshold: "1000",
    cardAccent: "from-violet-300/60 to-violet-500/50 text-violet-100",
    textAccent: "text-violet-200",
  },
];

const DEFAULT_ITEMS: PurchaseItem[] = [{ price: "", quantity: "" }];

export function GiftCalculator() {
  const [thresholds, setThresholds] = useState<string[]>(
    TIER_CONFIGS.map((tier) => tier.defaultThreshold)
  );
  const [items, setItems] = useState<PurchaseItem[]>(DEFAULT_ITEMS);
  const [calculation, setCalculation] =
    useState<TieredCalculationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  const summary = calculation;

  const handleThresholdChange = (index: number, value: string) => {
    const sanitized = value.replace(/[^0-9.]/g, "");
    setThresholds((prev) =>
      prev.map((current, idx) => (idx === index ? sanitized : current))
    );
  };

  const addItem = () => {
    setItems((prev) => [...prev, { price: "", quantity: "" }]);
  };

  const updateItem = (
    index: number,
    field: keyof PurchaseItem,
    rawValue: string
  ) => {
    const sanitized = rawValue.replace(/[^0-9.]/g, "");
    setItems((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        [field]: sanitized,
      };
      return next;
    });
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleCalculate = () => {
    setIsCalculating(true);
    setError(null);

    try {
      const parsedThresholds = thresholds.map((value, index) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error(`請正確輸入${TIER_CONFIGS[index].label}的門檻金額。`);
        }
        return parsed;
      });

      let positionCounter = 1;
      const expandedItems = items.flatMap(({ price, quantity }) => {
        const amountValue = Number(price || "0");
        const quantityValue = Number(quantity || "0");
        const sanitizedQuantity = Math.floor(quantityValue);

        if (
          !Number.isFinite(amountValue) ||
          amountValue <= 0 ||
          !Number.isFinite(sanitizedQuantity) ||
          sanitizedQuantity <= 0
        ) {
          return [];
        }

        return Array.from({ length: sanitizedQuantity }, () => ({
          amount: amountValue,
          position: positionCounter++,
        }));
      });

      if (!expandedItems.length) {
        throw new Error("請輸入每筆金額與數量。");
      }

      if (expandedItems.length > MAX_ITEMS) {
        throw new Error(`最多只能計算合計${MAX_ITEMS}件，請調整購買數量。`);
      }

      let remaining = expandedItems;
      const tiers = parsedThresholds.map((threshold) => {
        const result = optimizeGiftBundles(remaining, threshold);
        remaining = result.leftover;
        return result;
      });

      setCalculation({
        tiers,
        combined: {
          totalAmount: tiers[0]?.totalAmount ?? 0,
          coveredAmount: tiers.reduce(
            (sum, tier) => sum + tier.coveredAmount,
            0
          ),
          totalGifts: tiers.reduce((sum, tier) => sum + tier.totalGifts, 0),
        },
      });
    } catch (err) {
      setCalculation(null);
      const message = err instanceof Error ? err.message : "計算時發生錯誤。";
      setError(message);
    } finally {
      setIsCalculating(false);
    }
  };

  const handleReset = () => {
    setThresholds(TIER_CONFIGS.map((tier) => tier.defaultThreshold));
    setItems(DEFAULT_ITEMS);
    setCalculation(null);
    setError(null);
  };

  return (
    <div className="mt-8 grid gap-8 md:grid-cols-[1.2fr_1fr]">
      <GiftParameters
        thresholds={thresholds}
        items={items}
        onChangeThreshold={handleThresholdChange}
        onAddItem={addItem}
        onUpdateItem={updateItem}
        onRemoveItem={removeItem}
        onCalculate={handleCalculate}
        onReset={handleReset}
        isCalculating={isCalculating}
      />
      <ResultsPanel summary={summary} error={error} />
    </div>
  );
}

type GiftParametersProps = {
  thresholds: string[];
  items: PurchaseItem[];
  onChangeThreshold: (index: number, value: string) => void;
  onAddItem: () => void;
  onUpdateItem: (
    index: number,
    field: keyof PurchaseItem,
    value: string
  ) => void;
  onRemoveItem: (index: number) => void;
  onCalculate: () => void;
  onReset: () => void;
  isCalculating: boolean;
};

function GiftParameters({
  thresholds,
  items,
  onChangeThreshold,
  onAddItem,
  onUpdateItem,
  onRemoveItem,
  onCalculate,
  onReset,
  isCalculating,
}: GiftParametersProps) {
  const hasInvalidQuantity = items.some((item) => {
    const quantityValue = Number(item.quantity);
    return (
      !Number.isFinite(quantityValue) ||
      quantityValue < 1 ||
      item.quantity.trim() === ""
    );
  });

  return (
    <FieldSet>
      <FieldLegend>參數</FieldLegend>
      <Field>
        <FieldLabel>贈品門檻金額</FieldLabel>
        <FieldContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            {TIER_CONFIGS.map((tier, index) => (
              <div
                key={tier.label}
                className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-4"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-white/70">
                  {tier.label}
                </p>
                <Input
                  inputMode="numeric"
                  value={thresholds[index]}
                  onChange={(event) =>
                    onChangeThreshold(index, event.currentTarget.value)
                  }
                  placeholder={`例如：${tier.defaultThreshold}`}
                  aria-label={`${tier.label}的門檻金額`}
                  disabled
                />
              </div>
            ))}
          </div>
          <FieldDescription>
            會先盡量湊足高門檻的贈品A，再依序用剩餘金額爭取贈品B、贈品C。
          </FieldDescription>
        </FieldContent>
      </Field>

      <Button
        type="button"
        variant="secondary"
        onClick={onReset}
        disabled={isCalculating}
        className="w-full border border-white/20 bg-transparent text-white hover:bg-white/10"
      >
        重設
      </Button>

      <Field>
        <FieldLabel>購買金額 × 數量</FieldLabel>
        <FieldContent className="space-y-3">
          <PurchaseItemList
            items={items}
            onUpdateItem={onUpdateItem}
            onRemoveItem={onRemoveItem}
          />
          <Button
            type="button"
            variant="secondary"
            className="w-full border border-white/10 bg-white/10 text-white hover:bg-white/20"
            onClick={onAddItem}
          >
            + 新增商品
          </Button>
          <FieldDescription>
            請確保所有購買數量加總不超過 {MAX_ITEMS}
            件，亦可重複輸入相同商品。
          </FieldDescription>
        </FieldContent>
      </Field>

      <div className="flex flex-col gap-3">
        <Button
          type="button"
          onClick={onCalculate}
          disabled={isCalculating || hasInvalidQuantity}
          className="w-full bg-emerald-500 text-white hover:bg-emerald-600 focus-visible:bg-emerald-600"
        >
          {isCalculating ? "計算中..." : "開始計算"}
        </Button>
        <p className="text-xs text-white/70">輸入完成後請按「開始計算」。</p>
      </div>
    </FieldSet>
  );
}

type PurchaseItemListProps = Pick<
  GiftParametersProps,
  "items" | "onUpdateItem" | "onRemoveItem"
>;

function PurchaseItemList({
  items,
  onUpdateItem,
  onRemoveItem,
}: PurchaseItemListProps) {
  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div
          key={index}
          className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/5 p-3 md:flex-row md:items-center"
        >
          <div className="flex flex-1 flex-col gap-2 md:flex-row">
            <Input
              className="border-white/10 bg-transparent"
              value={item.price}
              aria-label={`購買金額 ${index + 1}`}
              inputMode="numeric"
              placeholder="金額（例如：1400）"
              onChange={(event) =>
                onUpdateItem(index, "price", event.currentTarget.value)
              }
            />
            <Input
              className="border-white/10 bg-transparent md:w-28"
              value={item.quantity}
              aria-label={`購買數量 ${index + 1}`}
              inputMode="numeric"
              placeholder="數量"
              onChange={(event) =>
                onUpdateItem(index, "quantity", event.currentTarget.value)
              }
            />
          </div>
          {items.length > 1 ? (
            <Button
              type="button"
              variant="ghost"
              className="text-xs text-white/70 hover:text-white"
              onClick={() => onRemoveItem(index)}
            >
              刪除
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

type ResultsPanelProps = {
  summary: TieredCalculationResult | null;
  error: string | null;
};

function ResultsPanel({ summary, error }: ResultsPanelProps) {
  const finalLeftover = summary
    ? (summary.tiers[summary.tiers.length - 1]?.leftover ?? [])
    : [];

  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 p-6 shadow-inner shadow-black/30">
      <h2 className="text-xl font-semibold text-white">計算結果</h2>
      {error ? (
        <p className="mt-4 text-sm text-red-300">{error}</p>
      ) : summary ? (
        <div className="mt-4 space-y-6">
          <SummaryTotals summary={summary} />
          <ResultStats summary={summary} />
          <GiftCombinationList summary={summary} />
          {finalLeftover.length ? (
            <div>
              <p className="text-sm font-semibold text-white/80">未使用</p>
              <p className="text-xs text-white/70">
                {finalLeftover
                  .map(
                    (item) =>
                      `#${item.position}: $${item.amount.toLocaleString()}`
                  )
                  .join(", ")}
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-sm text-white/60">
          輸入條件後按下「開始計算」即可顯示結果。
        </p>
      )}
    </div>
  );
}

function SummaryTotals({ summary }: { summary: TieredCalculationResult }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-white/70">可獲得的贈品總數</p>
        <p className="text-5xl font-black text-emerald-300">
          {summary.combined.totalGifts}
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {TIER_CONFIGS.map((tier, index) => {
          const result = summary.tiers[index];
          if (!result) return null;

          return (
            <div
              key={tier.label}
              className={`rounded-2xl border border-white/10 bg-gradient-to-br ${tier.cardAccent} p-4 text-center shadow-lg shadow-black/30`}
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-white/90">
                {tier.label}
              </p>
              <p className="text-4xl font-black text-white">
                {result.totalGifts}
                <span className="ml-1 text-base font-semibold">份</span>
              </p>
              <p className="text-xs text-white/90">
                門檻 ${result.threshold.toLocaleString()}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ResultStats({ summary }: { summary: TieredCalculationResult }) {
  return (
    <div className="grid gap-3 text-sm text-white/80">
      <p>
        總購買金額:{" "}
        <span className="font-semibold text-white">
          ${summary.combined.totalAmount.toLocaleString()}
        </span>
      </p>
      <p>
        符合贈品金額:{" "}
        <span className="font-semibold text-white">
          ${summary.combined.coveredAmount.toLocaleString()}
        </span>
      </p>
      <p>
        門檻金額:{" "}
        {TIER_CONFIGS.map((tier, index) => {
          const result = summary.tiers[index];
          if (!result) return null;

          return (
            <span
              key={tier.label}
              className={`mr-1 font-semibold ${tier.textAccent}`}
            >
              {tier.code} ${result.threshold.toLocaleString()}
            </span>
          );
        })}
      </p>
    </div>
  );
}

function GiftCombinationList({ summary }: { summary: TieredCalculationResult }) {
  return (
    <div className="space-y-4">
      {TIER_CONFIGS.map((tier, index) => {
        const result = summary.tiers[index];
        if (!result) return null;

        return (
          <div key={tier.label}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-white/80">
                {tier.label} 的組合
              </p>
              <p className={`text-xs font-semibold ${tier.textAccent}`}>
                門檻 ${result.threshold.toLocaleString()} ／ {result.totalGifts}
                份
              </p>
            </div>
            {result.groups.length ? (
              <ul className="space-y-2 text-sm text-white/90">
                {result.groups.map((group, groupIndex) => (
                  <li
                    key={`${tier.label}-${groupIndex}`}
                    className="rounded-xl border border-white/10 bg-white/5 p-4"
                  >
                    <p className="text-xs uppercase text-white/60">
                      組合 {groupIndex + 1}
                    </p>
                    <p className="text-lg font-semibold text-white">
                      合計 ${group.total.toLocaleString()}
                    </p>
                    <p className="text-xs text-white/70">
                      {group.items
                        .map(
                          (item) =>
                            `#${item.position}: $${item.amount.toLocaleString()}`
                        )
                        .join(" + ")}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-white/70">
                沒有符合 {tier.label} 門檻的組合。
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
