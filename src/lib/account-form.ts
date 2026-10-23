// 계정 폼 검사와 종류별 금융사 규칙(2단계 파일 1.2). 폼(클라이언트)과 서버 액션이 같이 쓰므로 DB 코드를 두지 않는다.
import { z } from "zod";
import { ACCOUNT_KINDS, INSTITUTIONS, type AccountKind, type Institution } from "@/db/schema";
import { dateSchema, emptyToNull, moneySchema, optionalTextSchema } from "@/lib/form-fields";
import { toDisplayBalance } from "@/lib/format";
import { normalizeAccountKey } from "@/lib/import/account-key";

// 종류마다 고를 수 있는 금융사(2단계 파일 1.2). 연결 금융사가 있는 부채 계정은 없다.
export const INSTITUTIONS_BY_KIND: Record<AccountKind, readonly Institution[]> = {
  asset: ["hana_bank", "kb_bank", "kakao_bank", "kis"],
  liability: [],
  card: ["hana_card", "kb_card"],
};

// 파일에서 계좌를 찾는 식별값(external_key)을 쓰는 금융사(은행·증권). 카드는 카드사당 계정 1개라 쓰지 않는다(design.md 1.3-B).
export const KEYED_INSTITUTIONS: readonly Institution[] = ["hana_bank", "kb_bank", "kakao_bank", "kis"];

// 계정 폼 검사. 화면 입력값(부채 기초 잔액은 양수)을 받아 저장값(부채는 음수)으로 바꾼다.
export const accountFormSchema = z
  .object({
    name: z.string().trim().min(1, "이름을 입력하세요."),
    kind: z.enum(ACCOUNT_KINDS, "종류를 고르세요."),
    institution: z.preprocess(emptyToNull, z.enum(INSTITUTIONS, "금융사를 다시 고르세요.").nullable()),
    externalKey: optionalTextSchema,
    openingBalance: z.preprocess((v) => (v == null || v === "" ? 0 : v), moneySchema),
    openingDate: z.preprocess(emptyToNull, dateSchema("기준일을 YYYY-MM-DD로 입력하세요.").nullable()),
  })
  .superRefine((v, ctx) => {
    if (v.institution && !INSTITUTIONS_BY_KIND[v.kind].includes(v.institution)) {
      ctx.addIssue({ code: "custom", path: ["institution"], message: "종류에 맞지 않는 금융사입니다." });
    }
  })
  .transform((v) => {
    const isCard = v.kind === "card";
    return {
      name: v.name,
      kind: v.kind,
      institution: v.institution,
      // 파일과 같은 규칙으로 정규화해 저장한다. 그래야 unique index가 하이픈만 다른 같은 계좌를 막는다(3단계 파일 3장).
      externalKey:
        v.institution && KEYED_INSTITUTIONS.includes(v.institution) ? normalizeAccountKey(v.institution, v.externalKey) : null,
      // 카드 계정은 잔액을 쓰지 않아 0으로 둔다(design.md 1.2).
      openingBalance: isCard ? 0 : toDisplayBalance(v.kind, v.openingBalance),
      openingDate: isCard ? null : v.openingDate,
    };
  });

export type AccountInput = z.output<typeof accountFormSchema>;
