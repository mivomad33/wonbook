"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatNumber } from "@/lib/format";
import { CATEGORY_COLORS } from "@/lib/category-style";
import { cn } from "@/lib/utils";

// 그래프(design-refresh 명세서 4.1-5). 라이브러리 없이 SVG로 그린다.
// 마우스를 올리거나(휴대폰은 누르면) 그 값이 그래프 위·가운데에 보이고, 그래프마다 화면 읽기 프로그램용 이름(aria-label)이 있다.

const won = (v: number) => `${formatNumber(v)}원`;

export const TREND_COLORS = {
  income: "var(--income)",
  expense: "var(--expense)",
  card: CATEGORY_COLORS.amber.base,
} as const;

export type TrendMonth = { month: string; label: string; income: number; expense: number; card: number };

/** 최근 몇 달의 수입·지출·카드 사용 막대(4.3-2). 막대 묶음을 누르면 그 달로 간다(hrefPrefix 뒤에 YYYY-MM을 붙인다). */
export function TrendChart({ months, current, hrefPrefix }: { months: TrendMonth[]; current: string; hrefPrefix: string }) {
  const [active, setActive] = useState(current);
  const peak = Math.max(0, ...months.flatMap((m) => [m.income, m.expense, m.card]));
  const hasData = peak > 0;
  // 그림 폭을 실제 화면 폭(px)에 맞춰, 좁은 화면에서도 글자가 줄어들지 않게 한다.
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(520);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(Math.min(560, Math.max(260, e.contentRect.width)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasData]);
  if (!hasData) return <p className="text-sm text-muted-foreground">최근 6개월에 거래가 없습니다.</p>;
  const shown = months.find((m) => m.month === active) ?? months[months.length - 1];
  // 눈금은 만 원 이상 간격으로 둔다(원 단위 소수 눈금이 생기지 않게).
  const step = Math.max(10_000, niceStep(peak / 3));
  const max = step * Math.max(1, Math.ceil(peak / step));
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const h = 170;
  const top = 8;
  const bottom = 22;
  const left = 34;
  const gw = (w - left) / months.length;
  const bw = Math.min(16, gw / 4.5);
  const y = (v: number) => h - bottom - (Math.max(0, v) / max) * (h - bottom - top);
  const bars: { key: keyof typeof TREND_COLORS; dx: number }[] = [
    { key: "income", dx: -bw * 1.5 - 2 },
    { key: "expense", dx: -bw / 2 },
    { key: "card", dx: bw / 2 + 2 },
  ];
  return (
    <div ref={box} className="max-w-[560px]">
      <p className="mb-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground" aria-live="polite">
        <span className="font-medium text-foreground">{shown.label}</span>
        <span>수입 {won(shown.income)}</span>
        <span>지출 {won(shown.expense)}</span>
        <span>카드 사용 {won(shown.card)}</span>
      </p>
      <svg viewBox={`0 0 ${w} ${h}`} className="block h-auto w-full" role="group" aria-label="최근 6개월 수입·지출·카드 사용">
        {ticks.map((t) => (
          <g key={t} aria-hidden="true">
            <line x1={left} x2={w} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeDasharray={t === 0 ? undefined : "3 3"} />
            <text x={left - 4} y={y(t) + 3.5} fontSize={10} textAnchor="end" fill="var(--muted-foreground)">
              {formatMan(t)}
            </text>
          </g>
        ))}
        {months.map((m, i) => {
          const x = left + gw * i + gw / 2;
          const isCurrent = m.month === current;
          return (
            <Link
              key={m.month}
              href={`${hrefPrefix}${m.month}`}
              aria-label={`${m.label}: 수입 ${won(m.income)}, 지출 ${won(m.expense)}, 카드 사용 ${won(m.card)}`}
              onPointerEnter={() => setActive(m.month)}
              onFocus={() => setActive(m.month)}
              onPointerLeave={() => setActive(current)}
              className="outline-none focus-visible:[&_rect.hit]:stroke-ring"
            >
              <rect className="hit" x={left + gw * i + 2} y={0} width={gw - 4} height={h} fill="transparent" strokeWidth={2} rx={6} />
              {bars.map((b) => (
                <rect
                  key={b.key}
                  x={x + b.dx}
                  y={y(m[b.key])}
                  width={bw}
                  height={Math.max(0, y(0) - y(m[b.key]))}
                  rx={2.5}
                  fill={TREND_COLORS[b.key]}
                  opacity={isCurrent ? 1 : 0.45}
                />
              ))}
              <text
                x={x}
                y={h - 6}
                fontSize={11}
                textAnchor="middle"
                fill={isCurrent ? "var(--foreground)" : "var(--muted-foreground)"}
                fontWeight={isCurrent ? 700 : 400}
              >
                {m.label}
              </text>
            </Link>
          );
        })}
      </svg>
      <Legend
        items={[
          { label: "수입", color: TREND_COLORS.income },
          { label: "지출(계정)", color: TREND_COLORS.expense },
          { label: "카드 사용", color: TREND_COLORS.card },
        ]}
      />
    </div>
  );
}

// 눈금 간격: 1·2·5 × 10ⁿ 중 v 이상인 가장 작은 값
function niceStep(v: number) {
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 5, 10].find((k) => k * p >= v) ?? 10) * p;
}

// 눈금 글자: 만 원 단위("300만"), 만 원보다 작으면 원 그대로
const formatMan = (v: number) => (v === 0 ? "0" : v >= 10_000 ? `${formatNumber(Math.round(v / 10_000))}만` : formatNumber(v));

export function Legend({ items, className }: { items: { label: string; color: string }[]; className?: string }) {
  return (
    <ul className={cn("mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground", className)}>
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1">
          <span aria-hidden="true" className="inline-block size-2.5 rounded-[2px]" style={{ background: it.color }} />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

export type DonutItem = { name: string; color: string; amount: number };

/** 카테고리 구성 도넛(4.3-3). 금액이 양수인 항목만 그린다. 그릴 것이 없으면 안내를 보여 준다. */
export function Donut({ items, label, size = 140 }: { items: DonutItem[]; label: string; size?: number }) {
  const [active, setActive] = useState<number | null>(null);
  const shown = items.filter((it) => it.amount > 0);
  const total = shown.reduce((s, it) => s + it.amount, 0);
  if (total <= 0) {
    return (
      <div className="flex shrink-0 items-center justify-center rounded-full border border-dashed text-center text-xs text-muted-foreground" style={{ width: size, height: size }}>
        그릴 지출이
        <br />
        없습니다
      </div>
    );
  }
  const r = size / 2 - 11;
  const c = 2 * Math.PI * r;
  const gap = shown.length > 1 ? 1.5 : 0;
  const lens = shown.map((it) => (it.amount / total) * c);
  const offsets = lens.map((_, i) => lens.slice(0, i).reduce((s, l) => s + l, 0));
  const cur = active === null ? null : shown[active];
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
      role="img"
      aria-label={`${label}: ${shown.map((it) => `${it.name} ${won(it.amount)}`).join(", ")}`}
      onPointerLeave={() => setActive(null)}
    >
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {shown.map((it, i) => {
          const len = lens[i];
          return (
            <circle
              key={it.name}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={it.color}
              strokeWidth={active === i ? 20 : 16}
              strokeDasharray={`${Math.max(0, len - gap)} ${c - Math.max(0, len - gap)}`}
              strokeDashoffset={-offsets[i]}
              onPointerEnter={() => setActive(i)}
              onClick={() => setActive(i)}
              className="cursor-pointer"
            />
          );
        })}
      </g>
      <text x="50%" y="46%" textAnchor="middle" fontSize={11} fill="var(--muted-foreground)">
        {cur ? cur.name : "합계"}
      </text>
      <text x="50%" y="59%" textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--foreground)">
        {won(cur ? cur.amount : total)}
      </text>
    </svg>
  );
}

export type ShareItem = { name: string; value: number; color: string };

/** 가로 비중 막대(4.2-1 자산과 부채). 칸에 마우스를 올리거나 누르면 이름과 금액이 보인다. */
export function ShareBar({ items, label }: { items: ShareItem[]; label: string }) {
  const [active, setActive] = useState<number | null>(null);
  const total = items.reduce((s, it) => s + it.value, 0);
  if (total <= 0) return null;
  const cur = active === null ? null : items[active];
  return (
    <div>
      <div
        className="flex h-3.5 overflow-hidden rounded-full"
        role="img"
        aria-label={`${label}: ${items.map((it) => `${it.name} ${won(it.value)}`).join(", ")}`}
        onPointerLeave={() => setActive(null)}
      >
        {items.map((it, i) => (
          <span
            key={it.name + i}
            className="h-full cursor-pointer border-r border-card last:border-r-0"
            style={{ flexGrow: it.value, flexBasis: 0, background: it.color }}
            onPointerEnter={() => setActive(i)}
            onClick={() => setActive(i)}
          />
        ))}
      </div>
      <p className="mt-1.5 h-4 text-xs text-muted-foreground" aria-hidden="true">
        {cur ? `${cur.name} ${won(cur.value)} (${Math.round((cur.value / total) * 100)}%)` : ""}
      </p>
      <Legend items={items.map((it) => ({ label: it.name, color: it.color }))} className="mt-0.5" />
    </div>
  );
}
