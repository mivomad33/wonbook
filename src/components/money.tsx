import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";

// 금액 표시(design.md 3.2). 고정폭 숫자에 천 단위 쉼표와 `원`을 붙인다. 오른쪽 정렬은 감싸는 칸(표 셀 등)에서 text-right로 맞춘다.
// signed: 거래 금액(양수 초록, 음수 빨강). 잔액·합계는 색을 넣지 않는다.
// plus: 양수에 +를 붙인다. 보정 합계처럼 늘었는지 줄었는지가 중요한 합계에 쓴다.
export function Money({
  value,
  signed = false,
  plus = false,
  className,
}: {
  value: number;
  signed?: boolean;
  plus?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "whitespace-nowrap tabular-nums",
        signed && value > 0 && "text-green-600",
        signed && value < 0 && "text-red-600",
        className,
      )}
    >
      {plus && value > 0 && "+"}
      {formatNumber(value)}원
    </span>
  );
}
