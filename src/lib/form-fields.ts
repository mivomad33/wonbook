// 여러 폼(계정, 거래, 이체)이 같이 쓰는 칸 검사(2단계 파일 4장). 폼(클라이언트)도 불러 쓰므로 DB 코드를 두지 않는다.
import { z } from "zod";

// 빈 칸과 폼에서 숨긴 칸(FormData에 없음)은 null로 본다.
export const emptyToNull = (v: unknown) => (v == null || (typeof v === "string" && v.trim() === "") ? null : v);

// 원 단위 0 이상 정수. 부호는 받지 않는다(구분 토글이나 계정 종류로 정한다).
export const moneySchema = z.coerce
  .number("금액을 숫자로 입력하세요.")
  .int("금액을 원 단위 정수로 입력하세요.")
  .nonnegative("금액은 0 이상이어야 합니다.")
  .max(Number.MAX_SAFE_INTEGER, "금액이 너무 큽니다.");

export const idSchema = z.coerce.number("계정을 고르세요.").int("계정을 고르세요.").positive("계정을 고르세요.");

// 칸 이름이 날짜가 아니면(기준일 등) 오류 문구를 따로 넘긴다.
export const dateSchema = (message = "날짜를 YYYY-MM-DD로 입력하세요.") => z.iso.date(message);

// HH:MM 또는 HH:MM:SS(design.md 1.1). 비우면 null.
export const timeSchema = z.preprocess(
  emptyToNull,
  z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "시각을 HH:MM으로 입력하세요.")
    .nullable(),
);

// 앞뒤 공백을 지운 선택 글. 비우면 null.
export const optionalTextSchema = z.preprocess(emptyToNull, z.string().trim().nullable());
