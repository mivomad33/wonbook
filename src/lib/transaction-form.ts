// 거래·이체 폼 검사(2단계 파일 3장). 폼(클라이언트)과 서버 액션이 같이 쓰므로 DB 코드를 두지 않는다.
import { z } from "zod";
import { dateSchema, emptyToNull, idSchema, moneySchema, optionalTextSchema, stripNul, timeSchema } from "@/lib/form-fields";

// 수입/지출(카드 계정이면 환불/사용). 저장할 때 지출·사용이면 음수로 바꾼다.
export const DIRECTIONS = ["in", "out"] as const;
export type Direction = (typeof DIRECTIONS)[number];

const positiveMoney = moneySchema.refine((v) => v > 0, "0보다 큰 금액을 입력하세요.");
const descriptionSchema = z.preprocess((v) => stripNul(v ?? ""), z.string().trim());

export const transactionFormSchema = z
  .object({
    accountId: idSchema,
    date: dateSchema(),
    time: timeSchema,
    direction: z.enum(DIRECTIONS, "구분을 고르세요."),
    amount: positiveMoney,
    description: descriptionSchema,
    memo: optionalTextSchema,
    // 수동 거래만 폼에서 고른다(5단계 파일 2장). 비우면 미분류. 업로드 거래는 거래 목록의 배지에서 바꾼다.
    categoryId: z.preprocess(emptyToNull, idSchema.nullable()).optional(),
  })
  .transform(({ direction, amount, ...v }) => ({ ...v, amount: direction === "out" ? -amount : amount }));

export type TransactionInput = z.output<typeof transactionFormSchema>;

// 반대쪽이 없는 이체를 고칠 때는 지워진 쪽 계정 칸이 비어 온다(2단계 파일 3.3). 둘 다 있어야 하는지는 lib에서 본다.
export const transferFormSchema = z
  .object({
    fromAccountId: z.preprocess(emptyToNull, idSchema.nullable()),
    toAccountId: z.preprocess(emptyToNull, idSchema.nullable()),
    date: dateSchema(),
    time: timeSchema,
    amount: positiveMoney,
    description: descriptionSchema,
    memo: optionalTextSchema,
  })
  .superRefine((v, ctx) => {
    if (v.fromAccountId != null && v.fromAccountId === v.toAccountId) {
      ctx.addIssue({ code: "custom", path: ["toAccountId"], message: "보내는 계정과 받는 계정이 같습니다." });
    }
  });

export type TransferInput = z.output<typeof transferFormSchema>;
