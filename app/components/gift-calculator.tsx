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
  tierA: BundleOptimizationResult;
  tierB: BundleOptimizationResult;
  combined: {
    totalAmount: number;
    coveredAmount: number;
    totalGifts: number;
  };
};

const DEFAULT_THRESHOLD_A = "2000";
const DEFAULT_THRESHOLD_B = "1000";
const DEFAULT_ITEMS: PurchaseItem[] = [{ price: "", quantity: "" }];

export function GiftCalculator() {
  const [thresholdA, setThresholdA] = useState(DEFAULT_THRESHOLD_A);
  const [thresholdB, setThresholdB] = useState(DEFAULT_THRESHOLD_B);
  const [items, setItems] = useState<PurchaseItem[]>(DEFAULT_ITEMS);
  const [calculation, setCalculation] =
    useState<TieredCalculationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  const summary = calculation;

  const handleThresholdChange =
    (setter: (value: string) => void) => (value: string) => {
      setter(value.replace(/[^0-9.]/g, ""));
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
      const parsedThresholdA = Number(thresholdA);
      const parsedThresholdB = Number(thresholdB);

      if (!Number.isFinite(parsedThresholdA) || parsedThresholdA <= 0) {
        throw new Error("請正確輸入贈品A的門檻金額。");
      }

      if (!Number.isFinite(parsedThresholdB) || parsedThresholdB <= 0) {
        throw new Error("請正確輸入贈品B的門檻金額。");
      }

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

      const tierA = optimizeGiftBundles(expandedItems, parsedThresholdA);
      const tierB = optimizeGiftBundles(tierA.leftover, parsedThresholdB);

      setCalculation({
        tierA,
        tierB,
        combined: {
          totalAmount: tierA.totalAmount,
          coveredAmount: tierA.coveredAmount + tierB.coveredAmount,
          totalGifts: tierA.totalGifts + tierB.totalGifts,
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
    setThresholdA(DEFAULT_THRESHOLD_A);
    setThresholdB(DEFAULT_THRESHOLD_B);
    setItems(DEFAULT_ITEMS);
    setCalculation(null);
    setError(null);
  };

  return (
    <div className="mt-8 grid gap-8 md:grid-cols-[1.2fr_1fr]">
      <GiftParameters
        thresholdA={thresholdA}
        thresholdB={thresholdB}
        items={items}
        onChangeThresholdA={handleThresholdChange(setThresholdA)}
        onChangeThresholdB={handleThresholdChange(setThresholdB)}
        onAddItem={addItem}
        onUpdateItem={updateItem}
        onRemoveItem={removeItem}
        onCalculate={handleCalculate}
        onReset={handleReset}
        isCalculating={isCalculating}
      />
      <ResultsPanel
        summary={summary}
        error={error}
        thresholdA={thresholdA}
        thresholdB={thresholdB}
      />
    </div>
  );
}

type GiftParametersProps = {
  thresholdA: string;
  thresholdB: string;
  items: PurchaseItem[];
  onChangeThresholdA: (value: string) => void;
  onChangeThresholdB: (value: string) => void;
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
  thresholdA,
  thresholdB,
  items,
  onChangeThresholdA,
  onChangeThresholdB,
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
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-white/70">
                贈品A
              </p>
              <Input
                inputMode="numeric"
                value={thresholdA}
                onChange={(event) =>
                  onChangeThresholdA(event.currentTarget.value)
                }
                placeholder="例如：2000"
                aria-label="贈品A的門檻金額"
                disabled
              />
            </div>
            <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-white/70">
                贈品B
              </p>
              <Input
                inputMode="numeric"
                value={thresholdB}
                onChange={(event) =>
                  onChangeThresholdB(event.currentTarget.value)
                }
                placeholder="例如：1000"
                aria-label="贈品B的門檻金額"
                disabled
              />
            </div>
          </div>
          <FieldDescription>
            會先盡量湊足高門檻的贈品A，再用剩餘金額爭取贈品B。
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
  thresholdA: string;
  thresholdB: string;
};

function ResultsPanel({
  summary,
  error,
  thresholdA,
  thresholdB,
}: ResultsPanelProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 p-6 shadow-inner shadow-black/30">
      <h2 className="text-xl font-semibold text-white">計算結果</h2>
      {error ? (
        <p className="mt-4 text-sm text-red-300">{error}</p>
      ) : summary ? (
        <div className="mt-4 space-y-6">
          <SummaryTotals
            summary={summary}
            thresholdA={thresholdA}
            thresholdB={thresholdB}
          />
          <ResultStats
            summary={summary}
            thresholdA={thresholdA}
            thresholdB={thresholdB}
          />
          <GiftCombinationList
            summary={summary}
            thresholdA={thresholdA}
            thresholdB={thresholdB}
          />
          {summary.tierB.leftover.length ? (
            <div>
              <p className="text-sm font-semibold text-white/80">未使用</p>
              <p className="text-xs text-white/70">
                {summary.tierB.leftover
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

function SummaryTotals({
  summary,
  thresholdA,
  thresholdB,
}: {
  summary: TieredCalculationResult;
  thresholdA: string;
  thresholdB: string;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-white/70">可獲得的贈品總數</p>
        <p className="text-5xl font-black text-emerald-300">
          {summary.combined.totalGifts}
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {[
          {
            label: "贈品A",
            value: summary.tierA.totalGifts,
            accent: "from-amber-300/60 to-amber-500/50 text-amber-100",
            thresholdValue: Number(thresholdA),
          },
          {
            label: "贈品B",
            value: summary.tierB.totalGifts,
            accent: "from-sky-300/60 to-sky-500/50 text-sky-100",
            thresholdValue: Number(thresholdB),
          },
        ].map((item) => (
          <div
            key={item.label}
            className={`rounded-2xl border border-white/10 bg-gradient-to-br ${item.accent} p-4 text-center shadow-lg shadow-black/30`}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-white/90">
              {item.label}
            </p>
            <p className="text-4xl font-black text-white">
              {item.value}
              <span className="ml-1 text-base font-semibold">份</span>
            </p>
            <p className="text-xs text-white/90">
              門檻 ${item.thresholdValue.toLocaleString()}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultStats({
  summary,
  thresholdA,
  thresholdB,
}: {
  summary: TieredCalculationResult;
  thresholdA: string;
  thresholdB: string;
}) {
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
        <span className="font-semibold text-amber-200">
          A ${Number(thresholdA).toLocaleString()}
        </span>{" "}
        <span className="font-semibold text-sky-200">
          B ${Number(thresholdB).toLocaleString()}
        </span>
      </p>
    </div>
  );
}

function GiftCombinationList({
  summary,
  thresholdA,
  thresholdB,
}: {
  summary: TieredCalculationResult;
  thresholdA: string;
  thresholdB: string;
}) {
  return (
    <div className="space-y-4">
      {[
        {
          label: "贈品A",
          tier: summary.tierA,
          accent: "text-amber-200",
          thresholdValue: Number(thresholdA),
        },
        {
          label: "贈品B",
          tier: summary.tierB,
          accent: "text-sky-200",
          thresholdValue: Number(thresholdB),
        },
      ].map(({ label, tier, accent, thresholdValue }) => (
        <div key={label}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-white/80">
              {label} 的組合
            </p>
            <p className={`text-xs font-semibold ${accent}`}>
              門檻 ${thresholdValue.toLocaleString()} ／ {tier.totalGifts}份
            </p>
          </div>
          {tier.groups.length ? (
            <ul className="space-y-2 text-sm text-white/90">
              {tier.groups.map((group, index) => (
                <li
                  key={`${label}-${index}`}
                  className="rounded-xl border border-white/10 bg-white/5 p-4"
                >
                  <p className="text-xs uppercase text-white/60">
                    組合 {index + 1}
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
              沒有符合 {label} 門檻的組合。
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
