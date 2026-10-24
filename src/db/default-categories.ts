// 가입하면 받는 기본 카테고리 25개(5단계 파일 1.2 버전 B, 9장). 그 뒤로는 사용자가 카테고리 화면에서 고친다.
// sort_order는 묶음 안의 순서다.
import type { DbOrTx } from "./client";
import type { CategoryColor, CategoryIcon } from "@/lib/category-style";
import { type CategoryGroup, categories } from "./schema";

// color·icon은 화면 색·아이콘(design-refresh 명세서 4.5-2). 아이콘은 서로 겹치지 않는다. 마이그레이션 0002가 같은 값으로 기존 카테고리를 채운다.
export const DEFAULT_CATEGORIES: readonly { name: string; group: CategoryGroup; sortOrder: number; color: CategoryColor; icon: CategoryIcon }[] = [
  { name: "장보기", group: "expense", sortOrder: 1, color: "green", icon: "shopping-cart" },
  { name: "외식·배달", group: "expense", sortOrder: 2, color: "orange", icon: "utensils" },
  { name: "카페·간식", group: "expense", sortOrder: 3, color: "brown", icon: "coffee" },
  { name: "생활용품", group: "expense", sortOrder: 4, color: "teal", icon: "spray-can" },
  { name: "쇼핑·의류", group: "expense", sortOrder: 5, color: "rose", icon: "shirt" },
  { name: "주거·관리비", group: "expense", sortOrder: 6, color: "amber", icon: "house" },
  { name: "통신", group: "expense", sortOrder: 7, color: "sky", icon: "smartphone" },
  { name: "교통·차량", group: "expense", sortOrder: 8, color: "blue", icon: "bus" },
  { name: "의료·건강", group: "expense", sortOrder: 9, color: "red", icon: "heart-pulse" },
  { name: "육아·교육", group: "expense", sortOrder: 10, color: "pink", icon: "graduation-cap" },
  { name: "여가·여행", group: "expense", sortOrder: 11, color: "violet", icon: "plane" },
  { name: "구독·디지털", group: "expense", sortOrder: 12, color: "indigo", icon: "monitor-play" },
  { name: "세금·공과금", group: "expense", sortOrder: 13, color: "sky", icon: "landmark" },
  { name: "보험", group: "expense", sortOrder: 14, color: "blue", icon: "shield" },
  { name: "경조사·기부", group: "expense", sortOrder: 15, color: "violet", icon: "gift" },
  { name: "기타 지출", group: "expense", sortOrder: 16, color: "gray", icon: "circle-ellipsis" },
  { name: "급여", group: "income", sortOrder: 1, color: "blue", icon: "briefcase" },
  { name: "정부 지원", group: "income", sortOrder: 2, color: "teal", icon: "building-2" },
  { name: "부수입", group: "income", sortOrder: 3, color: "violet", icon: "coins" },
  { name: "이자·배당", group: "income", sortOrder: 4, color: "green", icon: "piggy-bank" },
  { name: "환급·캐시백", group: "income", sortOrder: 5, color: "amber", icon: "receipt" },
  { name: "기타 수입", group: "income", sortOrder: 6, color: "gray", icon: "wallet" },
  { name: "카드대금", group: "move", sortOrder: 1, color: "gray", icon: "credit-card" },
  { name: "내 계좌·페이 이동", group: "move", sortOrder: 2, color: "gray", icon: "arrow-left-right" },
  { name: "개인 송금", group: "move", sortOrder: 3, color: "gray", icon: "send" },
];

export async function createDefaultCategories(db: DbOrTx, userId: number): Promise<void> {
  await db.insert(categories).values(DEFAULT_CATEGORIES.map((c) => ({ ...c, userId })));
}
