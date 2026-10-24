"use client";

import { CATEGORY_ICON_COMPONENTS } from "@/components/category-style";
import { CATEGORY_COLOR_NAMES, CATEGORY_COLORS, CATEGORY_ICONS, type CategoryColor, type CategoryIcon } from "@/lib/category-style";
import { cn } from "@/lib/utils";

// 색·아이콘 고르기(design-refresh 명세서 4.5-6). 브라우저 기본 라디오 버튼을 겹쳐 써서 Tab으로 들어가 화살표 키로 고르고,
// 폼에는 color·icon 값으로 그대로 실린다.

const COLOR_LABELS: Record<CategoryColor, string> = {
  green: "초록",
  teal: "청록",
  sky: "하늘",
  blue: "파랑",
  indigo: "남색",
  violet: "보라",
  pink: "분홍",
  rose: "장미",
  red: "빨강",
  orange: "주황",
  amber: "호박",
  brown: "갈색",
  gray: "회색",
};

const ICON_LABELS: Record<CategoryIcon, string> = {
  tag: "태그",
  "shopping-cart": "장바구니",
  utensils: "식기",
  coffee: "커피",
  "spray-can": "세제",
  shirt: "옷",
  house: "집",
  smartphone: "휴대폰",
  car: "자동차",
  bus: "버스",
  "heart-pulse": "건강",
  pill: "약",
  baby: "아기",
  "graduation-cap": "학사모",
  plane: "비행기",
  "monitor-play": "영상",
  landmark: "관공서",
  shield: "방패",
  gift: "선물",
  "circle-ellipsis": "기타",
  briefcase: "서류 가방",
  "building-2": "건물",
  coins: "동전",
  "piggy-bank": "저금통",
  receipt: "영수증",
  wallet: "지갑",
  "credit-card": "카드",
  "arrow-left-right": "양방향 화살표",
  send: "보내기",
  dumbbell: "운동",
  "book-open": "책",
  "paw-print": "반려동물",
  "gamepad-2": "게임",
  music: "음악",
  scissors: "가위",
  fuel: "주유",
};

const radio = "peer absolute inset-0 cursor-pointer appearance-none rounded-[inherit] outline-none";

// value가 null이면 아무것도 고르지 않은 상태다(새 카테고리: 서버가 묶음에서 덜 쓴 색을 고른다).
export function ColorPicker({ value, onChange }: { value: CategoryColor | null; onChange: (v: CategoryColor) => void }) {
  return (
    <div role="radiogroup" aria-label="색" className="flex flex-wrap gap-2">
      {CATEGORY_COLOR_NAMES.map((c) => (
        <label key={c} className="relative size-6 rounded-full" title={COLOR_LABELS[c]}>
          <input
            type="radio"
            name="color"
            value={c}
            checked={value === c}
            onChange={() => onChange(c)}
            aria-label={COLOR_LABELS[c]}
            className={radio}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none block size-full rounded-full ring-offset-2 ring-offset-background peer-checked:ring-2 peer-checked:ring-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
            style={{ background: CATEGORY_COLORS[c].base }}
          />
        </label>
      ))}
    </div>
  );
}

export function IconPicker({ value, color, onChange }: { value: CategoryIcon; color: CategoryColor | null; onChange: (v: CategoryIcon) => void }) {
  return (
    <div role="radiogroup" aria-label="아이콘" className="grid grid-cols-9 gap-1.5">
      {CATEGORY_ICONS.map((name) => {
        const Icon = CATEGORY_ICON_COMPONENTS[name];
        const checked = value === name;
        return (
          <label key={name} className="relative flex aspect-square items-center justify-center rounded-md" title={ICON_LABELS[name]}>
            <input
              type="radio"
              name="icon"
              value={name}
              checked={checked}
              onChange={() => onChange(name)}
              aria-label={ICON_LABELS[name]}
              className={radio}
            />
            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none flex size-full items-center justify-center rounded-md border text-muted-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
                checked && "border-2",
              )}
              style={checked ? { borderColor: CATEGORY_COLORS[color ?? "gray"].base, color: CATEGORY_COLORS[color ?? "gray"].text } : undefined}
            >
              <Icon className="size-4" />
            </span>
          </label>
        );
      })}
    </div>
  );
}
