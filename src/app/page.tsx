// 로그인 전 소개 화면(4.6-1). 확정 시안(docs/specs/2026-10-public-multiuser/design/landing.html)의 구성·문구를 따른다.
// 정적 페이지다(요청마다 DB를 부르지 않는다, 4.6-11). 로그인한 사람은 proxy가 자산 현황으로 보낸다.
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EyeOff, FileLock, Hash, ShieldCheck, Trash2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { FeedbackLink } from "@/components/feedback-link";
import { LogoMark } from "@/components/logo";
import { CategoryBadge } from "@/components/category-style";
import { CategoryBreakdown } from "@/components/category-breakdown";
import { Money } from "@/components/money";
import { StatCard } from "@/components/panel";
import { REPO_URL, SITE_NAME, SITE_URL } from "@/config";
import { cn } from "@/lib/utils";
import { LoginError } from "./_landing/login-error";
import { SUPPORTED_GROUPS } from "./_landing/supported";
import { LANDING_TITLE, pageMetadata, SITE_DESCRIPTION } from "./site-meta";

export const metadata: Metadata = pageMetadata("/", LANDING_TITLE);

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: SITE_NAME,
  description: SITE_DESCRIPTION,
  url: `${SITE_URL}/`,
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web",
  inLanguage: "ko",
  offers: { "@type": "Offer", price: "0", priceCurrency: "KRW" },
};

const btn = (variant: "default" | "outline", size: "default" | "lg" = "lg") => cn(buttonVariants({ variant, size }), size === "lg" && "h-11 px-[18px] text-[15px]");

function GoogleMark() {
  return (
    <span aria-hidden="true" className="inline-flex size-[18px] items-center justify-center rounded-full border bg-white text-[11px] font-extrabold text-[#4285f4]">
      G
    </span>
  );
}

function GoogleButton({ variant = "default" }: { variant?: "default" | "outline" }) {
  return (
    <a href="/api/auth/login" className={btn(variant)}>
      <GoogleMark />
      구글로 시작하기
    </a>
  );
}

function DemoButton({ variant = "outline" }: { variant?: "default" | "outline" }) {
  return (
    <a href="/demo" className={btn(variant)}>
      로그인 없이 데모 보기
    </a>
  );
}

const Num = ({ className, children }: { className?: string; children: React.ReactNode }) => (
  <td className={cn("px-2.5 py-1.5 text-right whitespace-nowrap tabular-nums", className)}>{children}</td>
);
const Td = ({ className, children }: { className?: string; children: React.ReactNode }) => <td className={cn("px-2.5 py-1.5", className)}>{children}</td>;
const Th = ({ className, children }: { className?: string; children: React.ReactNode }) => (
  <th className={cn("bg-muted/50 px-2.5 py-1.5 text-left text-xs font-medium text-muted-foreground", className)}>{children}</th>
);
const Badge = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-block rounded-full bg-brand-soft px-2 text-xs font-semibold text-brand-soft-foreground">{children}</span>
);
const Card = ({ className, children }: { className?: string; children: React.ReactNode }) => (
  <div className={cn("rounded-xl border bg-card", className)}>{children}</div>
);
const table = "w-full border-collapse text-[13px] [&_td]:border-b [&_th]:border-b [&_tr:last-child_td]:border-b-0";

function Step({ n, title, body, children }: { n: number; title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="grid items-center gap-8 md:grid-cols-[1fr_1.1fr] [&>*]:min-w-0">
      <div>
        <Badge>{n}</Badge>
        <h2 className="mt-2 mb-2 text-2xl font-bold tracking-tight">{title}</h2>
        <p className="text-muted-foreground">{body}</p>
      </div>
      {children}
    </div>
  );
}

const SAFETY = [
  { icon: FileLock, title: "원본 파일은 서버로 가지 않습니다", body: "파일은 브라우저에서 읽고, 읽은 거래 내역만 저장합니다." },
  { icon: Hash, title: "계좌번호는 끝 4자리만 남깁니다", body: "거래 내용에 들어 있는 계좌번호도 가려서 저장합니다." },
  { icon: EyeOff, title: "운영자도 내 거래를 볼 수 없습니다", body: "운영자는 가입자 수와 자동 분류 사용량만 봅니다." },
  { icon: Trash2, title: "탈퇴하면 바로 지웁니다", body: "떠나기 전에 거래 내역을 CSV로 내려받을 수 있습니다." },
] as const;

const wrap = "mx-auto max-w-[1080px] px-5";

export default function LandingPage() {
  return (
    <div className="text-[15px] leading-relaxed">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
      <header className={cn(wrap, "flex h-[60px] items-center justify-between")}>
        <div className="flex items-center gap-2 text-[17px] font-extrabold tracking-tight">
          <LogoMark />
          {SITE_NAME}
        </div>
        <div className="flex gap-2">
          <a href="/demo" className={cn(btn("outline", "default"), "hidden sm:inline-flex")}>
            데모 보기
          </a>
          <a href="/api/auth/login" className={btn("default", "default")}>
            로그인
          </a>
        </div>
      </header>

      <main>
        <section className={cn(wrap, "pt-14 text-center")}>
          <h1 className="text-[30px] leading-tight font-bold tracking-tight sm:text-[40px]">
            은행 파일만 올리면
            <br />
            가계부 정리 끝
          </h1>
          <p className="mt-4 text-base text-foreground/80 sm:text-lg">금융사에서 내려받은 거래 내역 파일을 올리면 입력, 분류, 잔액 맞추기까지 알아서 끝납니다.</p>
          <div className="mt-7 flex flex-wrap justify-center gap-2.5">
            <GoogleButton />
            <DemoButton />
          </div>
          <Suspense>
            <LoginError />
          </Suspense>
        </section>

        <section className={cn(wrap, "mt-18 grid gap-12")}>
          <Step n={1} title="금융사에서 파일을 받아 올립니다" body="여러 파일을 한 번에 끌어다 놓으면 금융사와 계좌를 알아서 찾습니다. 같은 기간을 겹쳐 올려도 중복되지 않습니다.">
            <Card className="px-4 py-3.5">
              <div className="mb-2 font-semibold">이번 결과</div>
              <table className={table}>
                <thead>
                  <tr>
                    <Th>파일</Th>
                    <Th className="text-right">넣음</Th>
                    <Th className="text-right">지움</Th>
                    <Th className="hidden text-right sm:table-cell">분류</Th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["국민카드 카드이용내역.xls", 142, 38, 142],
                    ["하나은행 거래내역조회.xls", 31, 0, 29],
                    ["카카오뱅크 거래내역.xlsx", 12, 4, 12],
                  ].map(([name, a, b, c]) => (
                    <tr key={name}>
                      <Td>{name}</Td>
                      <Num>{a}</Num>
                      <Num>{b}</Num>
                      <Num className="hidden sm:table-cell">{c}</Num>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2.5 rounded-lg border border-notice-border bg-notice px-3 py-2 text-[13px] text-notice-foreground">카카오 비상금 잔액을 맞추는 보정 거래 1건을 만들었습니다.</div>
            </Card>
          </Step>

          <Step n={2} title="카테고리는 AI가 붙입니다" body="처음 보는 가맹점만 AI가 분류하고, 한 번 고친 분류는 다음 파일에도 그대로 붙습니다.">
            <Card className="overflow-hidden">
              <table className={table}>
                <thead>
                  <tr>
                    <Th>날짜</Th>
                    <Th>내용</Th>
                    <Th>카테고리</Th>
                    <Th className="text-right">금액</Th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["10-21", "김밥천국", "외식·배달", "orange", "-9,800"],
                    ["10-21", "이마트", "장보기", "green", "-58,300"],
                    ["10-20", "예금이자", "이자·배당", "green", "+1,210"],
                  ].map(([date, desc, cat, color, amount]) => (
                    <tr key={desc}>
                      <Td className="text-muted-foreground">{date}</Td>
                      <Td>{desc}</Td>
                      <Td>
                        <CategoryBadge name={cat} color={color} />
                      </Td>
                      <Num className={amount.startsWith("-") ? "text-expense" : "text-income"}>{amount}</Num>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </Step>

          <Step n={3} title="한 달이 한눈에 보입니다" body="자산 현황과 월별 수입·지출을 계정과 카드로 나눠 보여 줍니다. 잔액이 어긋나면 보정 거래로 맞춥니다.">
            <div className="flex flex-col gap-2.5">
              {/* 월별 화면과 같은 요약 카드. 그림 칸이 좁은 폭(sm 미만, 설명과 나란히 놓이는 md)에서는 한 줄에 다 들어가지 않아 위아래로 쌓는다. */}
              <div className="grid gap-2.5 sm:grid-cols-3 md:grid-cols-1 lg:grid-cols-3">
                <StatCard compact label="수입" value={<Money value={3_412_000} className="text-income" />} />
                <StatCard compact label="지출" value={<Money value={2_036_500} className="text-expense" />} />
                <StatCard compact label="카드 사용" value={<Money value={1_284_300} />} />
              </div>
              <Card className="px-4 py-3.5">
                <div className="mb-1.5 flex items-baseline justify-between">
                  <b>10월 카드 사용</b>
                  <span className="text-[13px] text-muted-foreground">카테고리별</span>
                </div>
                <div className="text-[13px]">
                  <CategoryBreakdown
                    lines={[
                      { categoryId: 1, name: "외식·배달", color: "orange", amount: 412_800, ratio: 32 },
                      { categoryId: 2, name: "장보기", color: "green", amount: 298_100, ratio: 23 },
                      { categoryId: 3, name: "교통·차량", color: "blue", amount: 186_000, ratio: 14 },
                      { categoryId: 4, name: "구독·디지털", color: "indigo", amount: 54_900, ratio: 4 },
                    ]}
                  />
                </div>
              </Card>
            </div>
          </Step>
        </section>

        <section className={cn(wrap, "mt-18")} aria-labelledby="safety-title">
          <div className="flex items-center gap-4">
            <span className="inline-flex size-16 flex-none items-center justify-center rounded-2xl bg-brand-soft text-primary">
              <ShieldCheck className="size-10" strokeWidth={1.8} aria-hidden="true" />
            </span>
            <div>
              <h2 id="safety-title" className="text-2xl font-bold tracking-tight">
                내 금융 정보는 안전하게 지킵니다
              </h2>
              <p className="mt-1 text-muted-foreground">꼭 필요한 것만 저장하고, 운영자도 내 거래를 볼 수 없습니다.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SAFETY.map(({ icon: Icon, title, body }) => (
              <Card key={title} className="p-[18px]">
                <span className="inline-flex size-10 items-center justify-center rounded-[10px] bg-brand-soft text-primary">
                  <Icon className="size-[22px]" aria-hidden="true" />
                </span>
                <b className="mt-2.5 block">{title}</b>
                <p className="mt-1.5 text-muted-foreground">{body}</p>
              </Card>
            ))}
          </div>
          <p className="mt-3 text-[13px] text-muted-foreground">
            카테고리 자동 분류를 위해 가맹점 이름 같은 거래 내용(금액·날짜·계좌번호 제외)을 AI(Anthropic Claude)에 보냅니다. 자세한 내용은{" "}
            <Link href="/privacy" className="underline">
              개인정보 처리방침
            </Link>
            에 있습니다.
          </p>
        </section>

        <section className={cn(wrap, "mt-16 text-center")}>
          <h2 className="mb-2 text-2xl font-bold tracking-tight">가짜 데이터로 먼저 둘러보세요</h2>
          <div className="mt-7 flex flex-wrap justify-center gap-2.5">
            <DemoButton variant="default" />
            <GoogleButton variant="outline" />
          </div>
        </section>

        <section className={cn(wrap, "mt-16")}>
          <Card className="bg-muted/40 px-[22px] py-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-2xl font-bold tracking-tight">지금은 6개 금융사 파일만 읽을 수 있습니다</h2>
              <span className="text-[13px] text-muted-foreground">2026년 10월 기준</span>
            </div>
            <p className="mt-1.5 mb-3.5 text-muted-foreground">
              아래 금융사에서 내려받은 거래 내역 파일만 자동으로 읽습니다. 다른 금융사 계좌는 수동 계정으로 만들어 직접 입력할 수 있습니다.
            </p>
            <div className="grid justify-start gap-x-10 gap-y-3 sm:grid-cols-[repeat(3,auto)]">
              {SUPPORTED_GROUPS.map((g) => (
                <div key={g.label}>
                  <b>{g.label}</b>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {g.items.map((name) => (
                      <span key={name} className="rounded-full border bg-background px-3 py-1 text-[13px]">
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3.5 text-[13px] text-muted-foreground">
              쓰는 금융사가 없나요? <FeedbackLink className="underline">의견 보내기</FeedbackLink>로 알려 주세요.
            </p>
          </Card>
        </section>
      </main>

      <footer className="mt-18 border-t pt-6 pb-10 text-[13px] text-muted-foreground">
        <div className={cn(wrap, "flex flex-wrap justify-between gap-x-5 gap-y-2")}>
          <span>© 2026 {SITE_NAME}</span>
          <span>
            <FeedbackLink className="hover:underline" /> ·{" "}
            <Link href="/privacy" className="hover:underline">
              개인정보 처리방침
            </Link>{" "}
            ·{" "}
            <a href={REPO_URL} className="hover:underline">
              GitHub
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
