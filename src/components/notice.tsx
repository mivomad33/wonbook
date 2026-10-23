import type { ReactNode } from "react";

// 자동 처리 알림의 노란 알림 상자(design.md 3.1·3.2). 본문 제목 아래, 요약·표 위에 둔다.
// 4단계 보정 알림과 6단계 알림이 같이 쓴다. action에는 "닫기" 같은 버튼을 넣는다.
export function Notice({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div role="status" className="mb-4 flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-950">
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        {children && <div className="mt-1">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
