import { Skeleton } from "@/components/ui/skeleton";

// 화면 본문을 불러오는 동안 보이는 자리(4.10-5). DB가 깨어나는 동안 멈춘 것처럼 보이지 않게 <Suspense fallback>에 넣는다.
// 표 tables개, 표마다 줄 rows개 모양이다.
export function TablesSkeleton({ tables = 1, rows = 5 }: { tables?: number; rows?: number }) {
  return (
    <div role="status" aria-label="불러오는 중" className="flex flex-col gap-6">
      {Array.from({ length: tables }, (_, t) => (
        <div key={t} className="flex flex-col gap-2">
          <Skeleton className="h-5 w-24" />
          {Array.from({ length: rows }, (_, r) => (
            <Skeleton key={r} className="h-8 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}

// 요약 카드와 패널로 된 화면의 자리(design-refresh 명세서 4.6-4). 요약 카드 stats개, 패널 panels개다.
// rows를 주면 패널 대신 줄 rows개의 표 자리를 둔다(거래 목록).
export function DashboardSkeleton({ stats = 3, panels = 2, rows }: { stats?: number; panels?: number; rows?: number }) {
  return (
    <div role="status" aria-label="불러오는 중" className="flex flex-col gap-3.5">
      {stats > 0 && (
        <div className="grid grid-cols-2 gap-2.5 md:flex md:gap-3.5 md:*:flex-1">
          {Array.from({ length: stats }, (_, i) => (
            <Skeleton key={i} className="h-[76px] rounded-lg" />
          ))}
        </div>
      )}
      {rows
        ? Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)
        : Array.from({ length: panels }, (_, i) => <Skeleton key={i} className="h-44 rounded-lg" />)}
    </div>
  );
}
