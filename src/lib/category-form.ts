// 카테고리 폼 검사(5단계 파일 8장). 폼(클라이언트)과 서버 액션이 같이 쓰므로 DB 코드를 두지 않는다.
import { z } from "zod";
import { stripNul } from "@/lib/form-fields";
import { CATEGORY_GROUPS } from "@/db/schema";

export const categoryFormSchema = z.object({
  name: z.preprocess(stripNul, z.string().trim().min(1, "이름을 입력하세요.")),
  group: z.enum(CATEGORY_GROUPS, "묶음을 고르세요."),
});

export type CategoryInput = z.output<typeof categoryFormSchema>;

// AI가 확실하지 않을 때 고르는 "기타" 카테고리(5단계 파일 4.1). 프롬프트와 "기타" 다시 묻기(8장, 결정 F9)가 이름으로 찾으므로
// 이름·묶음을 바꾸거나 지우지 못하게 한다.
export const OTHER_CATEGORY_NAMES = ["기타 지출", "기타 수입"] as const;

export const isFixedCategory = (name: string) => (OTHER_CATEGORY_NAMES as readonly string[]).includes(name);
