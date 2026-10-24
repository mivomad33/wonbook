import {
  ArrowLeftRight,
  BookOpen,
  Briefcase,
  Building2,
  Bus,
  Car,
  CircleEllipsis,
  Coffee,
  Coins,
  CreditCard,
  Dumbbell,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  Landmark,
  type LucideIcon,
  MonitorPlay,
  Music,
  PawPrint,
  PiggyBank,
  Pill,
  Plane,
  Receipt,
  Baby,
  Scissors,
  Send,
  Shield,
  Shirt,
  ShoppingCart,
  Smartphone,
  SprayCan,
  Tag,
  Utensils,
  Wallet,
} from "lucide-react";
import { type CategoryIcon as IconName, categoryColorValues, isCategoryIcon, softBackground } from "@/lib/category-style";
import { cn } from "@/lib/utils";

// 카테고리 색 점·배지·아이콘(design-refresh 명세서 4.5-5). 거래 목록·월별·이동 표는 배지와 점을, 카테고리 화면은 아이콘을 쓴다.
// 미분류(color 없음)는 회색이다.

export const CATEGORY_ICON_COMPONENTS: Record<IconName, LucideIcon> = {
  tag: Tag,
  "shopping-cart": ShoppingCart,
  utensils: Utensils,
  coffee: Coffee,
  "spray-can": SprayCan,
  shirt: Shirt,
  house: House,
  smartphone: Smartphone,
  car: Car,
  bus: Bus,
  "heart-pulse": HeartPulse,
  pill: Pill,
  baby: Baby,
  "graduation-cap": GraduationCap,
  plane: Plane,
  "monitor-play": MonitorPlay,
  landmark: Landmark,
  shield: Shield,
  gift: Gift,
  "circle-ellipsis": CircleEllipsis,
  briefcase: Briefcase,
  "building-2": Building2,
  coins: Coins,
  "piggy-bank": PiggyBank,
  receipt: Receipt,
  wallet: Wallet,
  "credit-card": CreditCard,
  "arrow-left-right": ArrowLeftRight,
  send: Send,
  dumbbell: Dumbbell,
  "book-open": BookOpen,
  "paw-print": PawPrint,
  "gamepad-2": Gamepad2,
  music: Music,
  scissors: Scissors,
  fuel: Fuel,
};

type Style = { color?: string | null; icon?: string | null };

export function CategoryDot({ color, className }: { color?: string | null; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-2 shrink-0 rounded-full", className)}
      style={{ background: categoryColorValues(color).base }}
    />
  );
}

/** 색 점과 이름의 작은 배지. name이 없으면 "미분류"다. */
export function CategoryBadge({ name, color, className }: { name?: string | null; color?: string | null; className?: string }) {
  const c = categoryColorValues(name ? color : null);
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-px text-xs whitespace-nowrap", className)}
      style={{ background: softBackground(c.base), color: c.text }}
    >
      <span aria-hidden="true" className="inline-block size-1.5 shrink-0 rounded-full" style={{ background: c.base }} />
      {name ?? "미분류"}
    </span>
  );
}

/** 색 바탕의 둥근 사각형 안 아이콘. */
export function CategoryIconBox({ color, icon, size = 28, className }: Style & { size?: number; className?: string }) {
  const c = categoryColorValues(color);
  const Icon = CATEGORY_ICON_COMPONENTS[isCategoryIcon(icon) ? icon : "tag"];
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex shrink-0 items-center justify-center rounded-md", className)}
      style={{ width: size, height: size, background: softBackground(c.base), color: c.text }}
    >
      <Icon style={{ width: size * 0.55, height: size * 0.55 }} />
    </span>
  );
}
