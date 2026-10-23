// 로고(확정 파비콘 시안 B "W와 초록 선", 4.6-8). 소개 화면·사이드바·아이콘이 같은 모양을 쓴다.
export function LogoMark({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <rect x="2" y="2" width="60" height="60" rx="14" fill="#171717" />
      <path d="M14 20 L22 46 L32 26 L42 46 L50 20" fill="none" stroke="#fafafa" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="16" y="30" width="32" height="4" rx="2" fill="#15803d" />
    </svg>
  );
}
