import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// 데모 표시와 로그인 버튼(4.5-4). 데모의 모든 화면 위쪽에 늘 보인다.
export function DemoBanner() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-amber-50 px-4 py-2 text-sm md:px-7" role="status">
      <span>
        <strong className="font-semibold">데모</strong> 가짜 데이터로 둘러보는 중입니다. 고치거나 올리려면 로그인해 주세요.
      </span>
      <span className="flex gap-2">
        <form action="/api/auth/logout" method="post">
          <button type="submit" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            나가기
          </button>
        </form>
        <a href="/api/auth/login" className={cn(buttonVariants({ size: "sm" }))}>
          구글로 로그인
        </a>
      </span>
    </div>
  );
}
