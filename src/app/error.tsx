"use client";

import { Button } from "@/components/ui/button";

// 예상하지 못한 서버 오류나 DB 연결 실패 때 기술 정보 대신 보이는 화면(4.10-6).
export default function ErrorPage({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-[560px] flex-col justify-center gap-4 px-4 py-10">
      <div className="flex flex-col gap-4 rounded-xl border p-6 sm:p-8">
        <h1 className="text-xl font-bold">문제가 생겼습니다</h1>
        <p className="text-muted-foreground">잠시 연결이 원활하지 않았습니다. 다시 시도해 주세요. 계속되면 조금 뒤에 다시 들러 주세요.</p>
        <Button size="lg" onClick={() => retry()}>
          다시 시도
        </Button>
      </div>
    </main>
  );
}
