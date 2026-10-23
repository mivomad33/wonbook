// 계정 폼 검사와 종류별 금융사 규칙(2단계 파일 1.2). 폼(클라이언트)과 서버 액션이 같이 쓰므로 DB 코드를 두지 않는다.
// 계좌번호는 서버로 보내지 않는다(4.7-1). 흐름: 폼 값 → accountFormSchema(브라우저) → toAccountInput(브라우저, 해시와 끝 4자리)
// → 서버 액션 → accountInputSchema(서버 다시 검사) → lib/accounts.
import { z } from "zod";
import { ACCOUNT_KINDS, INSTITUTIONS, type AccountKind, type Institution } from "@/db/schema";
import { dateSchema, emptyToNull, moneySchema, optionalTextSchema, stripNul } from "@/lib/form-fields";
import { toDisplayBalance } from "@/lib/format";
import { normalizeAccountKey } from "@/lib/import/account-key";
import { accountKeyRefSchema, toAccountKeyRef } from "@/lib/privacy/account-key";

// 종류마다 고를 수 있는 금융사(2단계 파일 1.2). 연결 금융사가 있는 부채 계정은 없다.
export const INSTITUTIONS_BY_KIND: Record<AccountKind, readonly Institution[]> = {
  asset: ["hana_bank", "kb_bank", "kakao_bank", "kis"],
  liability: [],
  card: ["hana_card", "kb_card"],
};

// 파일에서 계좌를 찾는 식별값을 쓰는 금융사(은행·증권). 카드는 카드사당 계정 1개라 쓰지 않는다(design.md 1.3-B).
export const KEYED_INSTITUTIONS: readonly Institution[] = ["hana_bank", "kb_bank", "kakao_bank", "kis"];

const isKeyed = (institution: Institution | null) => institution != null && KEYED_INSTITUTIONS.includes(institution);

const institutionField = z.preprocess(emptyToNull, z.enum(INSTITUTIONS, "금융사를 다시 고르세요.").nullable());
const openingDateField = z.preprocess(emptyToNull, dateSchema("기준일을 YYYY-MM-DD로 입력하세요.").nullable());

function checkInstitution(v: { kind: AccountKind; institution: Institution | null }, ctx: z.RefinementCtx) {
  if (v.institution && !INSTITUTIONS_BY_KIND[v.kind].includes(v.institution)) {
    ctx.addIssue({ code: "custom", path: ["institution"], message: "종류에 맞지 않는 금융사입니다." });
  }
}

// 계정 폼 검사(브라우저). 화면 입력값(부채 기초 잔액은 양수)을 받아 저장값(부채는 음수)으로 바꾼다.
// externalKey는 화면에서 친 계좌번호를 파일과 같은 규칙으로 정규화한 값이다. 서버로 보내기 전에 toAccountInput으로 바꾼다.
export const accountFormSchema = z
  .object({
    name: z.preprocess(stripNul, z.string().trim().min(1, "이름을 입력하세요.")),
    kind: z.enum(ACCOUNT_KINDS, "종류를 고르세요."),
    institution: institutionField,
    externalKey: optionalTextSchema,
    openingBalance: z.preprocess((v) => (v == null || v === "" ? 0 : v), moneySchema),
    openingDate: openingDateField,
  })
  .superRefine(checkInstitution)
  .transform((v) => {
    const isCard = v.kind === "card";
    return {
      name: v.name,
      kind: v.kind,
      institution: v.institution,
      // 정규화해 두면 하이픈만 다른 같은 계좌가 같은 해시가 된다(3단계 파일 3장).
      externalKey: isKeyed(v.institution) ? normalizeAccountKey(v.institution, v.externalKey) : null,
      // 카드 계정은 잔액을 쓰지 않아 0으로 둔다(design.md 1.2).
      openingBalance: isCard ? 0 : toDisplayBalance(v.kind, v.openingBalance),
      openingDate: isCard ? null : v.openingDate,
    };
  });

export type AccountFormValues = z.output<typeof accountFormSchema>;

// 서버 액션이 받는 값. 금액은 저장값(부채는 음수)이다.
// accountKey: { digest, last4 }면 그 식별값으로 저장, null이면 식별값 없음, 빠지면(undefined) 수정 때 저장된 값을 그대로 둔다.
export const accountInputSchema = z
  .object({
    name: z.preprocess(stripNul, z.string().trim().min(1, "이름을 입력하세요.").max(100, "이름은 100자까지입니다.")),
    kind: z.enum(ACCOUNT_KINDS, "종류를 고르세요."),
    institution: institutionField,
    accountKey: accountKeyRefSchema.nullable().optional(),
    openingBalance: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
    openingDate: openingDateField,
  })
  .superRefine(checkInstitution)
  .transform((v) => {
    const isCard = v.kind === "card";
    return {
      name: v.name,
      kind: v.kind,
      institution: v.institution,
      accountKey: isKeyed(v.institution) ? v.accountKey : null,
      openingBalance: isCard ? 0 : v.openingBalance,
      openingDate: isCard ? null : v.openingDate,
    };
  });

export type AccountInput = z.output<typeof accountInputSchema>;

// 브라우저에서 폼 값을 서버로 보낼 값으로 바꾼다. 계좌번호는 해시와 끝 4자리가 된다.
// keepBlankKey: 수정 폼에서 식별값 칸을 비워 두면 저장된 값을 그대로 둔다(화면에는 끝 4자리만 보인다).
export async function toAccountInput(values: AccountFormValues, options: { keepBlankKey?: boolean } = {}): Promise<AccountInput> {
  const { externalKey, ...rest } = values;
  const accountKey =
    externalKey == null && options.keepBlankKey && isKeyed(values.institution) ? undefined : await toAccountKeyRef(values.institution, externalKey);
  return { ...rest, accountKey };
}
