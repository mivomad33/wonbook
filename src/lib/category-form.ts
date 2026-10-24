// 카테고리 폼 검사(5단계 파일 8장). 폼(클라이언트)과 서버 액션이 같이 쓰므로 DB 코드를 두지 않는다.
import { z } from "zod";
import { stripNul } from "@/lib/form-fields";
import { CATEGORY_GROUPS } from "@/db/schema";
import { CATEGORY_COLOR_NAMES, CATEGORY_ICONS } from "@/lib/category-style";

export const categoryFormSchema = z.object({
  name: z.preprocess(stripNul, z.string().trim().min(1, "이름을 입력하세요.")),
  group: z.enum(CATEGORY_GROUPS, "묶음을 고르세요."),
  // 색·아이콘은 목록 안의 값만 받는다(design-refresh 명세서 4.5-1). 새로 만들 때 비우면 서버가 고른다(4.5-4).
  color: z.preprocess((v) => (v === "" ? undefined : v), z.enum(CATEGORY_COLOR_NAMES as [string, ...string[]], "색을 목록에서 고르세요.").optional()),
  icon: z.preprocess((v) => (v === "" ? undefined : v), z.enum(CATEGORY_ICONS, "아이콘을 목록에서 고르세요.").optional()),
});

export type CategoryInput = z.output<typeof categoryFormSchema>;

// AI가 확실하지 않을 때 고르는 "기타" 카테고리(5단계 파일 4.1). 프롬프트와 "기타" 다시 묻기(8장, 결정 F9)가 이름으로 찾으므로
// 이름·묶음을 바꾸거나 지우지 못하게 한다.
export const OTHER_CATEGORY_NAMES = ["기타 지출", "기타 수입"] as const;

export const isFixedCategory = (name: string) => (OTHER_CATEGORY_NAMES as readonly string[]).includes(name);
