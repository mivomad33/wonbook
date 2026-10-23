// 화면 문구 말투 검사(4.6-7). 사용자에게 보이는 문구는 합니다체로 쓴다.
// 해라체 종결: "다"로 끝나는데 "니다"가 아닌 것, 의문·청유·명령형 "까?" "자." "라."(합니다체 "습니까?"·"십시오"는 제외).
// 부사 "다"("다 썼습니다")와 조사 "보다"·"마다"는 종결이 아니다.

export interface ToneIssue {
  index: number;
  snippet: string;
}

const ENDING = /다(?=[."`'<)}\s]|$)/g;
const QUESTION = /(?<!니)까\?|(?<=[가-힣])자\.|(?<=[가-힣])라\./g;

export function findHaera(text: string): ToneIssue[] {
  const out: ToneIssue[] = [];
  for (const m of text.matchAll(ENDING)) {
    const i = m.index;
    const prev = text[i - 1] ?? "";
    if (prev === "니") continue;
    if (prev === "보" || prev === "마") continue; // 조사 "보다", "마다"
    if (prev === "" || /\s/.test(prev)) continue; // 부사 "다"
    if ((prev === "어" || prev === "아") && /\s/.test(text[i + 1] ?? "")) continue; // 연결 어미 "-어다/-아다"("끌어다 놓거나")
    out.push({ index: i, snippet: text.slice(Math.max(0, i - 12), i + 2) });
  }
  for (const m of text.matchAll(QUESTION)) out.push({ index: m.index, snippet: text.slice(Math.max(0, m.index - 12), m.index + 2) });
  return out;
}
