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
