import type { ReactNode } from "react";

// 화면 제목과 오른쪽 버튼 자리(design.md 3.1의 본문 순서).
export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <h1 className="text-lg font-semibold">{title}</h1>
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}
