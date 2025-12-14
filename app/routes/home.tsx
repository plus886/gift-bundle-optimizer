import type { Route } from "./+types/home";
import { GiftCalculator } from "~/components/gift-calculator";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "禮品組合最佳化" },
    {
      name: "description",
      content: "根據購買金額的組合，計算可獲得最多贈品的最佳方案。",
    },
  ];
}

export default function Home() {
  return (
    <main className="flex min-h-svh flex-col gap-10 bg-neutral-950 px-4 py-16 text-white md:px-8">
      <section className="mx-auto max-w-4xl rounded-3xl border border-white/10 bg-gradient-to-b from-white/10 to-white/5 p-8 shadow-2xl shadow-black/50 backdrop-blur">
        <Hero />
        <GiftCalculator />
      </section>
    </main>
  );
}

function Hero() {
  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-amber-200">
        禮品最佳化器
      </p>
      <h1 className="text-balance text-3xl font-bold leading-tight text-white md:text-4xl">
        自動算出讓贈品數量最大化的購買組合
      </h1>
      <p className="text-balance text-sm text-white/80 md:text-base">
        輸入購買金額列表與贈品門檻，就能立刻找到可以拿到最多贈品的組合。
      </p>
    </div>
  );
}
