// Claude API로 키를 분류한다(5단계 파일 4장). classifyPending이 Classifier로 받아 쓰고, 테스트는 mock으로 바꾼다.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { CategoryGroup } from "@/db/schema";

// 바꾸고 싶으면 이 상수만 고친다(4.1).
export const CLASSIFY_MODEL = "claude-opus-5-5";

// 보내는 칸(4.2). 금액·날짜·메모·카드 번호·계좌번호·raw는 보내지 않는다.
export type ClassifyItem = {
  id: string;
  // 키를 method로 만든 거래는 description 원문을 보내지 않는다(null).
  description: string | null;
  direction: "in" | "out";
  method: string | null;
  account: "bank" | "card" | "securities";
};

export type CategoryInfo = { name: string; group: CategoryGroup };

// id → 카테고리 이름. 답이 없는 id는 빠진다. 실패하면 던진다.
export type Classifier = (items: ClassifyItem[], categories: CategoryInfo[]) => Promise<Map<string, string>>;

const GROUP_LABELS: Record<CategoryGroup, string> = {
  expense: "지출",
  income: "수입",
  move: "이동(수입·지출이 아닌 돈의 이동)",
};

// 처음 카테고리(1.2 버전 B)의 설명. 사용자가 더하거나 이름을 바꾼 카테고리는 설명 없이 이름만 보낸다.
const CATEGORY_HINTS: Record<string, string> = {
  장보기: "마트·슈퍼·편의점·시장에서 산 식료품 (이마트, 홈플러스, GS25, 쿠팡프레시)",
  "외식·배달": "식당, 배달 앱 (김밥천국, 배달의민족·우아한형제들, 쿠팡이츠)",
  "카페·간식": "커피, 빵, 디저트 (스타벅스, 파리바게뜨, 배스킨라빈스)",
  생활용품: "생필품·살림살이 (다이소, 올리브영, 생활용품점)",
  "쇼핑·의류": "옷·잡화·온라인 쇼핑몰, 무엇을 샀는지 알 수 없는 쇼핑몰 결제 (쿠팡, 에이블리, 무신사)",
  "주거·관리비": "월세, 관리비, 전기·가스·수도, 렌탈",
  통신: "휴대폰·인터넷 요금",
  "교통·차량": "버스·지하철·택시, 주유, 주차, 통행료, 차량 정비 (티머니)",
  "의료·건강": "병원, 약국, 운동",
  "육아·교육": "어린이집, 학원, 교재, 키즈카페, 아이 용품",
  "여가·여행": "숙박, 항공, 공연·영화, 놀이 (에어비앤비, 야놀자)",
  "구독·디지털": "정기 구독, 앱·소프트웨어·AI 서비스 (넷플릭스, Adobe, Anthropic, 애플)",
  "세금·공과금": "세금, 과태료, 각종 수수료",
  보험: "보험료",
  "경조사·기부": "축의금·조의금, 선물, 기부·후원",
  "기타 지출": "어느 지출 카테고리에도 맞지 않거나 무엇에 쓴 돈인지 모르는 지출",
  급여: "회사에서 받은 급여·상여",
  "정부 지원": "정부·지자체 수당, 육아휴직 급여, 각종 지원금",
  부수입: "급여 말고 일해서 번 돈, 중고 판매",
  "이자·배당": "예금 이자, 배당금, 분배금",
  "환급·캐시백": "세금 환급, 캐시백, 포인트 적립, 본인 인증용 소액 입금",
  "기타 수입": "어느 수입 카테고리에도 맞지 않는 들어온 돈",
  카드대금: "은행 계좌에서 나간 카드값 (KB카드출금, 하나카드 결제)",
  "내 계좌·페이 이동": "내 다른 계좌·증권 계좌로 보내거나 받은 돈, 카카오페이·네이버페이 충전",
  "개인 송금": "사람 이름으로 주고받은 돈",
};

// 시스템 프롬프트. 같은 카테고리 목록이면 같은 글자가 되게 해 프롬프트 캐시가 걸리게 한다(4.1).
export function systemPrompt(categories: CategoryInfo[]): string {
  const sections = (Object.keys(GROUP_LABELS) as CategoryGroup[])
    .map((group) => {
      const lines = categories
        .filter((c) => c.group === group)
        .map((c) => (CATEGORY_HINTS[c.name] ? `- ${c.name}: ${CATEGORY_HINTS[c.name]}` : `- ${c.name}`));
      return lines.length ? `## ${GROUP_LABELS[group]}\n${lines.join("\n")}` : "";
    })
    .filter(Boolean);
  return `한국 개인 가계부 앱에서 은행·카드·증권 거래 내역을 카테고리로 분류한다.
거래마다 아래 목록에서 카테고리 하나를 고른다. 목록에 없는 이름은 쓰지 않는다.

${sections.join("\n\n")}

## 규칙
- 거래 칸: text는 상대방·가맹점 이름(없을 수 있다), direction은 in(들어온 돈)·out(나간 돈), method는 금융사가 적은 거래 방식, account는 bank(은행)·card(카드)·securities(증권)이다.
- 사람 이름으로 주고받은 돈은 "개인 송금"이다.
- 카카오페이·네이버페이 같은 페이 충전과 내 다른 계좌·증권 계좌로 옮긴 돈은 "내 계좌·페이 이동"이다.
- 은행에서 카드사로 나간 돈은 "카드대금"이다.
- 카드 환불·취소(in)도 결제와 같은 카테고리를 고른다. 지출 카테고리에 붙어 그 지출을 줄인다.
- 확실하지 않으면 지출은 "기타 지출", 수입은 "기타 수입"을 고른다.`;
}

export function createClaudeClassifier(client = new Anthropic()): Classifier {
  return async (items, categories) => {
    const names = categories.map((c) => c.name);
    if (names.length === 0) throw new Error("카테고리가 없습니다.");
    // 스키마가 목록 밖의 답을 막는다(4.1).
    const schema = z.object({
      results: z.array(z.object({ id: z.string(), category: z.enum(names as [string, ...string[]]) })),
    });
    const lines = items.map((it) =>
      JSON.stringify({
        id: it.id,
        ...(it.description == null ? {} : { text: it.description }),
        direction: it.direction,
        ...(it.method ? { method: it.method } : {}),
        account: it.account,
      }),
    );
    const response = await client.messages.parse({
      model: CLASSIFY_MODEL,
      max_tokens: 16000,
      cache_control: { type: "ephemeral" },
      system: systemPrompt(categories),
      output_config: { effort: "low", format: zodOutputFormat(schema) },
      messages: [{ role: "user", content: `다음 거래들을 분류해 모든 id에 답한다.\n${lines.join("\n")}` }],
    });
    if (response.stop_reason !== "end_turn") throw new Error(`응답이 끝까지 오지 않았습니다(${response.stop_reason}).`);
    if (!response.parsed_output) throw new Error("응답을 읽지 못했습니다.");
    return new Map(response.parsed_output.results.map((r) => [r.id, r.category]));
  };
}

// 앱이 쓰는 분류기. API 키(.env.local의 ANTHROPIC_API_KEY)가 없으면 null이라 저장된 분류만 붙는다(5.2).
export function classifierFromEnv(): Classifier | null {
  // E2E 테스트용 가짜 분류(비용 없음). 개발 서버에서만 켜진다(운영 빌드는 NODE_ENV=production).
  if (process.env.WONBOOK_FAKE_CLASSIFIER === "1" && process.env.NODE_ENV !== "production") return fakeClassifier;
  return process.env.ANTHROPIC_API_KEY ? createClaudeClassifier() : null;
}

// 들어온 돈은 "기타 수입", 나간 돈은 "기타 지출"로 둔다.
const fakeClassifier: Classifier = async (items) => new Map(items.map((it) => [it.id, it.direction === "in" ? "기타 수입" : "기타 지출"]));
