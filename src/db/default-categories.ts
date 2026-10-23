// 가입하면 받는 기본 카테고리 25개(5단계 파일 1.2 버전 B, 9장). 그 뒤로는 사용자가 카테고리 화면에서 고친다.
// sort_order는 묶음 안의 순서다.
import type { DbOrTx } from "./client";
import { type CategoryGroup, categories } from "./schema";

export const DEFAULT_CATEGORIES: readonly { name: string; group: CategoryGroup; sortOrder: number }[] = [
  { name: "장보기", group: "expense", sortOrder: 1 },
  { name: "외식·배달", group: "expense", sortOrder: 2 },
  { name: "카페·간식", group: "expense", sortOrder: 3 },
  { name: "생활용품", group: "expense", sortOrder: 4 },
  { name: "쇼핑·의류", group: "expense", sortOrder: 5 },
  { name: "주거·관리비", group: "expense", sortOrder: 6 },
  { name: "통신", group: "expense", sortOrder: 7 },
  { name: "교통·차량", group: "expense", sortOrder: 8 },
  { name: "의료·건강", group: "expense", sortOrder: 9 },
  { name: "육아·교육", group: "expense", sortOrder: 10 },
  { name: "여가·여행", group: "expense", sortOrder: 11 },
  { name: "구독·디지털", group: "expense", sortOrder: 12 },
  { name: "세금·공과금", group: "expense", sortOrder: 13 },
  { name: "보험", group: "expense", sortOrder: 14 },
  { name: "경조사·기부", group: "expense", sortOrder: 15 },
  { name: "기타 지출", group: "expense", sortOrder: 16 },
  { name: "급여", group: "income", sortOrder: 1 },
  { name: "정부 지원", group: "income", sortOrder: 2 },
  { name: "부수입", group: "income", sortOrder: 3 },
  { name: "이자·배당", group: "income", sortOrder: 4 },
  { name: "환급·캐시백", group: "income", sortOrder: 5 },
  { name: "기타 수입", group: "income", sortOrder: 6 },
  { name: "카드대금", group: "move", sortOrder: 1 },
  { name: "내 계좌·페이 이동", group: "move", sortOrder: 2 },
  { name: "개인 송금", group: "move", sortOrder: 3 },
];

export async function createDefaultCategories(db: DbOrTx, userId: number): Promise<void> {
  await db.insert(categories).values(DEFAULT_CATEGORIES.map((c) => ({ ...c, userId })));
}
