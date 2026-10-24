// 카테고리 색·아이콘(design-refresh 명세서 4.5). DB에는 색 이름과 아이콘 이름을 저장하고, 화면은 이 목록으로 그린다.
// 서버는 목록 밖의 값을 거부한다(isCategoryColor, isCategoryIcon).

// base: 점·도넛·아이콘 색, text: 배지 글자 색(흰 바탕과 옅은 배지 바탕에서 4.5:1 이상, src/lib/contrast.test.ts).
export const CATEGORY_COLORS = {
  green: { base: "#16a34a", text: "#166534" },
  teal: { base: "#0d9488", text: "#0f766e" },
  sky: { base: "#0284c7", text: "#0369a1" },
  blue: { base: "#2563eb", text: "#1d4ed8" },
  indigo: { base: "#6366f1", text: "#4338ca" },
  violet: { base: "#7c3aed", text: "#6d28d9" },
  pink: { base: "#db2777", text: "#be185d" },
  rose: { base: "#e11d48", text: "#be123c" },
  red: { base: "#dc2626", text: "#b91c1c" },
  orange: { base: "#ea580c", text: "#c2410c" },
  amber: { base: "#d97706", text: "#b45309" },
  brown: { base: "#a16207", text: "#854d0e" },
  gray: { base: "#64748b", text: "#475569" },
} as const;

export type CategoryColor = keyof typeof CATEGORY_COLORS;
export const CATEGORY_COLOR_NAMES = Object.keys(CATEGORY_COLORS) as CategoryColor[];

// 미분류 거래의 점·배지 색(고를 수 있는 색이 아니다)
export const UNCATEGORIZED_COLOR = { base: "#a3a3a3", text: "#525252" } as const;

// 배지·아이콘 바탕은 base 색을 옅게(알파 0x1a ≈ 10%) 흰 바탕에 겹친다.
export const SOFT_ALPHA = 0x1a;
export const softBackground = (hex: string) => `${hex}${SOFT_ALPHA.toString(16).padStart(2, "0")}`;

// lucide 아이콘 이름(kebab-case). 컴포넌트는 components/category-style.tsx가 이 목록과 같은 순서로 둔다.
export const CATEGORY_ICONS = [
  "tag",
  "shopping-cart",
  "utensils",
  "coffee",
  "spray-can",
  "shirt",
  "house",
  "smartphone",
  "car",
  "bus",
  "heart-pulse",
  "pill",
  "baby",
  "graduation-cap",
  "plane",
  "monitor-play",
  "landmark",
  "shield",
  "gift",
  "circle-ellipsis",
  "briefcase",
  "building-2",
  "coins",
  "piggy-bank",
  "receipt",
  "wallet",
  "credit-card",
  "arrow-left-right",
  "send",
  "dumbbell",
  "book-open",
  "paw-print",
  "gamepad-2",
  "music",
  "scissors",
  "fuel",
] as const;

export type CategoryIcon = (typeof CATEGORY_ICONS)[number];

// 새 칸의 DB 기본값과 이름으로 기본값을 찾지 못한 카테고리의 값(4.5-3)
export const DEFAULT_CATEGORY_COLOR: CategoryColor = "gray";
export const DEFAULT_CATEGORY_ICON: CategoryIcon = "tag";

export const isCategoryColor = (v: unknown): v is CategoryColor =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(CATEGORY_COLORS, v);
export const isCategoryIcon = (v: unknown): v is CategoryIcon =>
  typeof v === "string" && (CATEGORY_ICONS as readonly string[]).includes(v);

// 자동으로 고르는 색. 회색은 이동 묶음과 기본값용이라 지출·수입에는 자동으로 고르지 않는다(사용자는 고를 수 있다).
export const AUTO_CATEGORY_COLORS: CategoryColor[] = CATEGORY_COLOR_NAMES.filter((c) => c !== "gray");
const AUTO_ORDER = AUTO_CATEGORY_COLORS;

/** 묶음 안에서 가장 적게 쓴 색을 고른다(같으면 팔레트 순서). 이동 묶음은 늘 회색이다(4.5-2·4.5-4). */
export function pickCategoryColor(group: string, usedInGroup: readonly string[]): CategoryColor {
  if (group === "move") return "gray";
  const counts = new Map<CategoryColor, number>(AUTO_ORDER.map((c) => [c, 0]));
  for (const c of usedInGroup) if (isCategoryColor(c)) counts.set(c, (counts.get(c) ?? 0) + 1);
  let best = AUTO_ORDER[0];
  for (const c of AUTO_ORDER) if ((counts.get(c) ?? 0) < (counts.get(best) ?? 0)) best = c;
  return best;
}

/** 저장된 색 이름을 화면 색으로 바꾼다. 미분류(null)는 회색 계열이다. */
export function categoryColorValues(color: string | null | undefined) {
  return isCategoryColor(color) ? CATEGORY_COLORS[color] : UNCATEGORIZED_COLOR;
}
