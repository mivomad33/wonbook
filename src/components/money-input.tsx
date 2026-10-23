"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

// 금액 입력(2단계 파일 4장). 입력하는 동안 쉼표를 넣고, 폼에는 `name`으로 쉼표 없는 정수 문자열을 넘긴다.
// 부호는 받지 않는다(부호는 구분 토글이나 계정 종류로 정한다).
export function MoneyInput({
  name,
  defaultValue,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "name" | "defaultValue" | "value" | "onChange" | "type"> & {
  name: string;
  defaultValue?: number;
}) {
  const [digits, setDigits] = useState(defaultValue == null ? "" : String(defaultValue));

  return (
    <>
      <Input
        {...props}
        inputMode="numeric"
        autoComplete="off"
        value={digits === "" ? "" : formatNumber(Number(digits))}
        onChange={(e) => setDigits(e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 15))}
        className={cn("text-right tabular-nums", className)}
      />
      <input type="hidden" name={name} value={digits} />
    </>
  );
}
