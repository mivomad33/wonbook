// 의견 보내기 메일 링크(4.6-9). 소개 화면 푸터, 로그인 뒤 모든 화면·데모의 푸터, 설정 화면이 같이 쓴다.
import { CONTACT_EMAIL } from "@/config";

export const FEEDBACK_HREF = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Wonbook 의견")}`;

export function FeedbackLink({ className, children = "의견 보내기" }: { className?: string; children?: React.ReactNode }) {
  return (
    <a href={FEEDBACK_HREF} className={className}>
      {children}
    </a>
  );
}
