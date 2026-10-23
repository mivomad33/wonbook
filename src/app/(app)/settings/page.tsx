import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth/current";
import { FeedbackLink } from "@/components/feedback-link";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { getAppDb } from "@/db/client";
import { cn } from "@/lib/utils";
import { hasKakaoPassword } from "@/secrets/kakao-password";
import { DeleteAccount, KakaoPasswordForm } from "./settings-forms";

export const metadata: Metadata = { title: "설정" };

// 설정(4.6-4): 카카오뱅크 암호, 거래 내보내기, 로그아웃, 탈퇴
export default function Page() {
  return (
    <>
      <PageHeader title="설정" />
      <Suspense>
        <Content />
      </Suspense>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex max-w-xl flex-col gap-2 border-b pb-6">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

async function Content() {
  const user = await requireUser();
  if (user.isDemo) redirect("/home");
  const saved = await hasKakaoPassword(getAppDb(), user.id);
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">{user.email}로 로그인했습니다.</p>
      <Section title="카카오뱅크 파일 암호">
        <p className="text-sm text-muted-foreground">카카오뱅크 거래 내역 파일을 열 때 쓰는 암호입니다. 서버에 암호화해 저장하고, 화면에 다시 보여 주지 않습니다.</p>
        <KakaoPasswordForm saved={saved} />
      </Section>
      <Section title="거래 내보내기">
        <p className="text-sm text-muted-foreground">모든 계정의 거래를 CSV 파일로 내려받습니다. 엑셀에서 바로 열 수 있습니다.</p>
        <a href="/api/export" className={cn(buttonVariants({ variant: "outline" }), "self-start")} download>
          CSV 내려받기
        </a>
      </Section>
      <Section title="로그아웃">
        <form action="/api/auth/logout" method="post">
          <button type="submit" className={cn(buttonVariants({ variant: "outline" }))}>
            로그아웃
          </button>
        </form>
      </Section>
      <Section title="탈퇴">
        <p className="text-sm text-muted-foreground">탈퇴하면 계정과 가계부 데이터(계정, 거래, 업로드 기록, 카테고리, 저장된 분류, 설정)를 바로 지웁니다. 되살릴 수 없습니다.</p>
        <DeleteAccount />
      </Section>
      <p className="text-sm text-muted-foreground">
        써 보니 어떠셨나요? <FeedbackLink className="underline">의견 보내기</FeedbackLink>
      </p>
    </div>
  );
}
