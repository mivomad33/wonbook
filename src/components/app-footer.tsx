import Link from "next/link";
import { FeedbackLink } from "./feedback-link";

// 로그인 뒤 화면·데모 맨 아래의 작은 푸터(4.6-9).
export function AppFooter() {
  return (
    <footer className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-2 pb-6 text-xs text-muted-foreground md:px-7">
      <FeedbackLink className="hover:underline" />
      <Link href="/privacy" className="hover:underline">
        개인정보 처리방침
      </Link>
    </footer>
  );
}
