// 소개 화면·업로드 화면의 지원 금융사 안내(4.3-6, 4.6-1). 파서가 지원하는 금융사와 같아야 한다(supported.test.ts).
export const SUPPORTED_GROUPS = [
  { label: "은행", items: ["하나은행", "국민은행", "카카오뱅크"] },
  { label: "카드", items: ["하나카드", "국민카드"] },
  { label: "증권", items: ["한국투자증권 (일반·ISA)"] },
] as const;
