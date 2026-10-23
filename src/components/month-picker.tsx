"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQueryUpdate } from "@/hooks/use-query-update";
import { shiftMonth } from "@/lib/format";

// 월 선택(2단계 파일 4장). 값이 바뀌면 URL의 month 쿼리를 바꾼다. 전체 기간은 month=all이고, allowAll이 false면 감춘다(6단계 월별 수입/지출).
export function MonthPicker({ value, allowAll = true }: { value: string | "all"; allowAll?: boolean }) {
  const updateQuery = useQueryUpdate();
  const isAll = value === "all";
  const setMonth = (month: string) => updateQuery({ month });

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="icon"
        aria-label="이전 달"
        disabled={isAll}
        onClick={() => setMonth(shiftMonth(value, -1))}
      >
        <ChevronLeftIcon />
      </Button>
      <Input
        type="month"
        aria-label="월"
        className="w-36"
        value={isAll ? "" : value}
        onChange={(e) => e.target.value && setMonth(e.target.value)}
      />
      <Button
        variant="outline"
        size="icon"
        aria-label="다음 달"
        disabled={isAll}
        onClick={() => setMonth(shiftMonth(value, 1))}
      >
        <ChevronRightIcon />
      </Button>
      {allowAll && (
        <Button variant={isAll ? "secondary" : "ghost"} aria-pressed={isAll} onClick={() => setMonth("all")}>
          전체 기간
        </Button>
      )}
    </div>
  );
}
