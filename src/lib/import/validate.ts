// 서버가 받은 업로드 값 검사(4.3-2). 브라우저가 보낸 값을 그대로 믿지 않는다.
// 형식(날짜, 정수 금액, 0이 아닌 금액, 칸 길이)과 개수를 보고, 글 칸의 긴 숫자를 다시 가린다(2.2).
import { z } from "zod";
import { INSTITUTIONS } from "@/db/schema";
import { accountKeyRefSchema } from "@/lib/privacy/account-key";
import { maskAccountNumbers } from "@/lib/privacy/mask";
import { UserError } from "@/lib/user-error";
import { maskTransaction, type UploadRequestFile } from "./payload";

// 한 요청에 받는 거래 수(파일을 모두 더한 수)와 글 칸 길이
export const MAX_TRANSACTIONS_PER_REQUEST = 10_000;
export const MAX_TEXT_LENGTH = 200;
// 한 번에 고르는 파일 수. 금융사 6곳의 파일을 모두 골라도 넉넉하다.
export const MAX_FILES_PER_REQUEST = 50;

const date = z.iso.date();
const text = z.string().max(MAX_TEXT_LENGTH);
const money = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);

const transactionSchema = z.strictObject({
  date,
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
    .nullable(),
  amount: money.refine((v) => v !== 0),
  description: text,
  method: text.nullable(),
  memo: text.nullable(),
  cardLabel: text.nullable(),
  balanceAfter: money.nullable(),
});

const fileSchema = z.strictObject({
  fileName: text.min(1),
  institution: z.enum(INSTITUTIONS),
  accountKey: accountKeyRefSchema.nullable(),
  period: z.object({ start: date, end: date }).refine((p) => p.start <= p.end),
  transactions: z.array(transactionSchema).max(MAX_TRANSACTIONS_PER_REQUEST),
  confirmedIds: z.array(z.number().int().positive()).max(MAX_TRANSACTIONS_PER_REQUEST),
  createAccount: z.boolean().optional(),
});

const requestSchema = z.array(fileSchema).min(1).max(MAX_FILES_PER_REQUEST);

// 잘못된 칸을 사람이 알아볼 이름으로 알려준다. 값은 메시지에 넣지 않는다(로그에 거래 내용이 남지 않게, 4.7-3).
const FIELD_LABELS: Record<string, string> = {
  date: "날짜",
  time: "시각",
  amount: "금액",
  description: "내용",
  method: "거래 방식",
  memo: "메모",
  cardLabel: "카드",
  balanceAfter: "거래 후 잔액",
  fileName: "파일 이름",
  institution: "금융사",
  accountKey: "계좌 식별값",
  period: "조회기간",
  confirmedIds: "확인한 거래",
};

function describeIssue(issue: z.core.$ZodIssue): string {
  // 정해진 칸 밖의 값(계정 id 등)은 받지 않는다(4.3-2).
  if (issue.code === "unrecognized_keys") return "업로드 값에 알 수 없는 칸이 있습니다. 파일을 다시 올려 주세요.";
  const field = [...issue.path].reverse().find((p): p is string => typeof p === "string" && p in FIELD_LABELS);
  const label = field ? FIELD_LABELS[field] : "형식";
  if (issue.code === "too_big" && field && field !== "amount" && field !== "balanceAfter") {
    return `${label} 칸이 ${MAX_TEXT_LENGTH}자를 넘는 거래가 있습니다. 파일을 확인해 주세요.`;
  }
  if (field === "amount") return "금액이 0이거나 원 단위 정수가 아닌 거래가 있습니다. 파일을 확인해 주세요.";
  return `${label} 형식이 맞지 않는 값이 있습니다. 파일을 확인해 주세요.`;
}

// 받은 값을 검사하고 글 칸을 다시 가린 값을 돌려준다. 맞지 않으면 UserError를 던지고 아무것도 반영하지 않는다.
export function parseUploadRequest(input: unknown): UploadRequestFile[] {
  // 개수는 형식보다 먼저 본다. 너무 큰 요청은 칸마다 검사하지 않고 바로 거부한다.
  if (Array.isArray(input)) {
    if (input.length > MAX_FILES_PER_REQUEST) throw new UserError(`한 번에 올릴 수 있는 파일은 ${MAX_FILES_PER_REQUEST}개까지입니다.`);
    const total = input.reduce((s: number, f) => s + (Array.isArray(f?.transactions) ? f.transactions.length : 0), 0);
    if (total > MAX_TRANSACTIONS_PER_REQUEST) {
      throw new UserError(
        `한 번에 올릴 수 있는 거래는 ${MAX_TRANSACTIONS_PER_REQUEST.toLocaleString("ko-KR")}건까지입니다. 파일을 나눠 올려 주세요.`,
      );
    }
  }
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) throw new UserError(describeIssue(parsed.error.issues[0]));
  for (const file of parsed.data) {
    if (file.transactions.some((t) => t.date < file.period.start || t.date > file.period.end)) {
      throw new UserError("조회기간 밖의 거래가 있습니다. 파일을 확인해 주세요.");
    }
  }
  return parsed.data.map((f) => ({ ...f, fileName: maskAccountNumbers(f.fileName), transactions: f.transactions.map(maskTransaction) }));
}
