// 개인정보 처리방침(4.6-2). Google OAuth 브랜딩에 등록한 주소(/privacy)다. 정적 페이지다.
import type { Metadata } from "next";
import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { CONTACT_EMAIL, SITE_NAME } from "@/config";
import { pageMetadata, PRIVACY_TITLE } from "../site-meta";

export const metadata: Metadata = pageMetadata("/privacy", PRIVACY_TITLE);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-lg font-bold">{title}</h2>
      <div className="space-y-2 text-[15px] leading-relaxed [&_li]:ml-5 [&_li]:list-disc">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-[760px] px-5 pt-6 pb-16">
      <Link href="/" className="flex items-center gap-2 text-[17px] font-extrabold">
        <LogoMark />
        {SITE_NAME}
      </Link>
      <main>
        <h1 className="mt-10 text-3xl font-bold tracking-tight">개인정보 처리방침</h1>
        <p className="mt-3 text-muted-foreground">
          {SITE_NAME}은 금융사에서 내려받은 거래 내역 파일을 정리하는 개인 웹 가계부입니다. 어떤 정보를 저장하고 어디에 쓰는지 아래에 적습니다. 시행일: 2026년 10월 23일
        </p>

        <Section title="저장하는 정보">
          <ul>
            <li>구글 계정의 이메일, 이름, 프로필 사진(로그인에 씁니다)</li>
            <li>가계부 데이터: 계정(이름, 종류, 금융사, 기초 잔액), 거래(날짜, 시각, 금액, 내용, 거래 방식, 메모, 카테고리), 업로드 기록, 카테고리와 저장된 분류, 설정</li>
            <li>계좌번호는 파일과 계정을 맞추는 데 쓸 해시(서버 비밀 키로 만든 값)와 화면에 보일 끝 4자리만 저장합니다.</li>
            <li>거래 내용·메모·업로드 파일 이름에 들어 있는 계좌번호처럼 긴 숫자는 끝 4자리만 남기고 가려서 저장합니다.</li>
            <li>카카오뱅크 파일 암호를 저장하면 서버 키로 암호화해 둡니다. 화면에 다시 보여 주지 않습니다.</li>
          </ul>
        </Section>

        <Section title="저장하지 않는 정보">
          <ul>
            <li>금융사에서 받은 원본 파일. 파일은 내 브라우저에서 읽고, 읽은 거래 내역만 서버로 보냅니다.</li>
            <li>계좌번호 전체</li>
            <li>파일의 원본 행(화면에 쓰지 않는 칸)</li>
          </ul>
        </Section>

        <Section title="쓰는 곳">
          <ul>
            <li>가계부 기능(입력, 분류, 잔액 보정, 자산 현황, 월별 수입·지출)에 씁니다.</li>
            <li>
              카테고리 자동 분류를 위해 거래 내용(가맹점 이름, 송금 상대 이름 등), 입출금 방향, 거래 방식, 계정 종류를 Anthropic의 Claude API(미국)로 보냅니다. 금액·날짜·메모·계좌번호는
              보내지 않습니다.
            </li>
            <li>서버는 Vercel, 데이터베이스는 Neon(싱가포르 리전)에 있습니다.</li>
            <li>사용 분석: Vercel Web Analytics로 쿠키 없이 익명 방문 통계(페이지 주소, 브라우저 종류, 나라 등)를 모읍니다. 주소의 쿼리(거르기 조건)는 보내지 않습니다.</li>
          </ul>
        </Section>

        <Section title="운영자가 볼 수 있는 것">
          <p>운영자는 관리자 화면에서 가입자 수와 그날의 자동 분류 사용량(사용자별 횟수)만 봅니다. 다른 사용자의 계정·거래·금액은 어느 화면에도 보이지 않습니다.</p>
        </Section>

        <Section title="보관과 삭제">
          <ul>
            <li>설정 화면에서 탈퇴하면 계정과 가계부 데이터를 바로 지웁니다. 탈퇴하기 전에 거래 내역을 CSV로 내려받을 수 있습니다.</li>
            <li>운영자가 만드는 데이터베이스 백업(암호화)에는 최근 백업 몇 개만큼 남을 수 있고, 오래된 백업부터 지워집니다.</li>
          </ul>
        </Section>

        <Section title="연락처">
          <p>
            개인정보에 관한 문의와 삭제 요청은{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
              {CONTACT_EMAIL}
            </a>
            으로 보내 주세요.
          </p>
        </Section>
      </main>
    </div>
  );
}
