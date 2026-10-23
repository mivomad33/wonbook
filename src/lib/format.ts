// 금액·날짜 형식과 화면 표시용 변환(2단계 파일 4장).
import type { AccountKind } from "@/db/schema";

// 천 단위 쉼표. 원 단위 정수만 다룬다(design.md 1.1).
export function formatNumber(value: number): string {
  return value.toLocaleString("ko-KR");
}

// 부채 계정은 음수로 저장하고 화면에서 부호를 뒤집는다(design.md 1.1). 입력값을 저장값으로 바꿀 때도 같은 식이다.
export function toDisplayBalance(kind: AccountKind, balance: number): number {
  // -balance는 0에서 -0이 되므로 0 - balance로 뒤집는다.
  return kind === "liability" ? 0 - balance : balance;
}

// 날짜는 한국 시간(Asia/Seoul) 기준 문자열로 다룬다(design.md 1.1, 4.2-3). 서버 시간대(UTC)와 상관없다.
// 한국은 서머타임이 없어 UTC+9로 고정해 계산한다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function toDateString(d: Date): string {
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export function today(now: Date = new Date()): string {
  return toDateString(now);
}

// 이번 달(`YYYY-MM`)
export function currentMonth(now: Date = new Date()): string {
  return today(now).slice(0, 7);
}

// `YYYY-MM-DD`에서 delta일 옮긴 날. 시간대 영향을 받지 않게 UTC로 계산한다.
export function shiftDate(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// from에서 to까지 며칠인지(`YYYY-MM-DD`). to가 앞이면 음수다. 자산 현황의 올린 기간에 쓴다(6단계 파일 4.1).
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// `YYYY-MM`에서 delta달 옮긴 달
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

// `2026-10` → `2026년 10월`
export function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${y}년 ${m}월`;
}

// 저장한 시각(ISO, UTC)을 실행하는 컴퓨터 시간대로 `2026-10-19 14:03`
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${toDateString(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 사이드바처럼 좁은 곳에 쓰는 짧은 형식 `10월 19일 14:03`
export function formatShortDateTime(iso: string): string {
  const [date, time] = formatDateTime(iso).split(" ");
  const [, m, d] = date.split("-").map(Number);
  return `${m}월 ${d}일 ${time}`;
}
