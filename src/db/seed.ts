// 확인용 시드 데이터(design.md 4.5). 사용자 한 명에게 실행한 날(한국 시간)을 기준으로 이번 달과 앞의 다섯 달 치(6개월)를 넣는다.
// 월별 화면의 최근 6개월 추이에 막대가 모두 보이게 한다(design-refresh 명세서 4.7).
// 개발 DB의 테스트 사용자와 읽기 전용 데모 사용자(4.5)가 같이 쓴다.
// 앱 규칙을 따르도록 lib/의 입력 함수를 거친다. 업로드 거래는 브라우저가 보내는 값(UploadedFile)을 만들어 업로드 코드(applyImport)로 넣는다(3단계 파일 8.1).
// 계좌 식별값은 누가 봐도 가짜인 번호(0으로 채운 번호)로 만든다.
import { and, asc, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { categories, categoryRules, type Institution, transactions } from "@/db/schema";
import { createAccount } from "@/lib/accounts";
import { matchKeyOf } from "@/lib/categorize";
import { shiftMonth, today } from "@/lib/format";
import { applyImport, type UploadedFile, type UploadedTransaction } from "@/lib/import";
import { type AccountKeyRef, toAccountKeyRef } from "@/lib/privacy/account-key";
import { createTransaction, createTransfer, setTransactionDeleted, updateTransaction } from "@/lib/transactions";

// 시드 내용이 바뀌면 올린다. 데모는 이 값이 바뀌면 데이터를 다시 만든다(auth/demo.ts, design-refresh 명세서 4.7-2).
export const SEED_VERSION = 3;

const MONTH_COUNT = 6;
type MonthIndex = 0 | 1 | 2 | 3 | 4 | 5;

// amount를 여섯 값으로 주면 달마다(첫 달 … 이번 달) 다른 금액이다. month를 주면 그 달(0~5, 5가 이번 달)에만 넣는다(6단계 파일 6장).
type Upload = {
  day: number;
  time?: string;
  amount: number | readonly [number, number, number, number, number, number];
  description: string;
  method?: string;
  cardLabel?: string;
  month?: MonthIndex;
};

export async function seed(db: DbOrTx, userId: number, options: { now?: Date } = {}) {
  const now = today(options.now);
  const thisMonth = now.slice(0, 7);
  const months = Array.from({ length: MONTH_COUNT }, (_, i) => shiftMonth(thisMonth, i - MONTH_COUNT + 1));
  const firstMonth = months[0];
  // 이번 달 거래는 오늘까지만 넣는다.
  const dateOf = (month: string, day: number) => {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    return date <= now ? date : null;
  };

  // 기초 잔액 기준일은 첫 달 전날(앞 달 말일)로 둔다. 기준일 당일까지의 거래는 기초 잔액에 들어 있다.
  const beforeFirst = `${shiftMonth(firstMonth, -1)}-28`;
  const salaryKey = await toAccountKeyRef("hana_bank", "000-000000-00001");
  const savingsKey = await toAccountKeyRef("kakao_bank", "0000-00-0000001");

  const salary = await createAccount(db, userId, {
    name: "하나 급여통장",
    kind: "asset",
    institution: "hana_bank",
    accountKey: salaryKey,
    openingBalance: 2_400_000,
    openingDate: beforeFirst,
  });
  const savings = await createAccount(db, userId, {
    name: "카카오 비상금",
    kind: "asset",
    institution: "kakao_bank",
    accountKey: savingsKey,
    openingBalance: 5_000_000,
    openingDate: null,
  });
  const loan = await createAccount(db, userId, {
    name: "학자금 대출",
    kind: "liability",
    institution: null,
    accountKey: null,
    openingBalance: -8_000_000,
    openingDate: beforeFirst,
  });
  const card = await createAccount(db, userId, {
    name: "하나카드",
    kind: "card",
    institution: "hana_card",
    accountKey: null,
    openingBalance: 0,
    openingDate: null,
  });

  // 계정마다 여섯 달 치를 파일 하나로 넣는다. 기간은 첫 달 1일 ~ 오늘, 파일 이름은 `시드-<계정>`. 넣은 거래 id를 넣은 순서(seq)대로 돌려준다.
  // actualStart를 주면 그 값에서 시작해 거래 후 잔액(balance_after)을 채운다. 기초 잔액과 다르면 보정 거래가 생긴다(4단계 파일 7장).
  const upload = async (
    accountId: number,
    institution: Institution,
    accountKey: AccountKeyRef | null,
    name: string,
    uploads: Upload[],
    actualStart?: number,
  ) => {
    let actual = actualStart ?? 0;
    const rows = months.flatMap((month, monthIndex) =>
      uploads.flatMap((u): UploadedTransaction[] => {
        const date = dateOf(month, u.day);
        if (!date || (u.month != null && u.month !== monthIndex)) return [];
        const { time = null, description, method = null, cardLabel = null } = u;
        const amount = typeof u.amount === "number" ? u.amount : u.amount[monthIndex];
        actual += amount;
        const balanceAfter = actualStart == null ? null : actual;
        return [{ date, time, amount, description, method, memo: null, cardLabel, balanceAfter }];
      }),
    );
    const file: UploadedFile = {
      fileName: `시드-${name}`,
      institution,
      accountKey,
      period: { start: `${firstMonth}-01`, end: now },
      transactions: rows,
    };
    const result = await applyImport(db, userId, { accountId, fileName: file.fileName, file, confirmedIds: [] });
    if (result.status !== "applied") throw new Error("시드 업로드가 손댄 거래에 걸렸습니다.");
    const inserted = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.importId, result.importId)))
      .orderBy(asc(transactions.seq));
    return inserted.map((r) => r.id);
  };

  const salaryUploads: Upload[] = [
    { day: 1, time: "09:12", amount: -650_000, description: "월세", method: "자동이체" },
    { day: 10, time: "08:30", amount: 3_200_000, description: "(주)원북 급여", method: "급여" },
    { day: 15, time: "10:05", amount: [-356_100, -471_900, -503_200, -412_300, -655_800, -298_400], description: "하나카드 결제", method: "자동이체" },
    { day: 17, time: "11:20", amount: 450_000, description: "크몽 정산", method: "타행입금", month: 4 },
    { day: 20, time: "18:44", amount: [-37_400, -40_100, -38_800, -38_000, -41_500, -39_200], description: "통신요금", method: "자동이체" },
    { day: 22, time: "20:10", amount: -300_000, description: "홍길동", method: "스마트출금" },
    // 비상금으로 보내는 돈. 비상금 업로드의 "하나 급여통장" 입금과 짝이다(이동 표의 나감·들어옴).
    { day: 23, time: "09:30", amount: -200_000, description: "카카오 비상금", method: "스마트출금" },
  ];
  // 이번 달 인터파크 환불은 앞 달 결제의 환불이라, 이번 달 여가·여행이 음수가 된다. 이번 달 거래는 오늘까지만 들어가므로 월초(2일)에 둔다.
  // 1일 주유는 환불보다 커서, 월초에도 이번 달 카드 사용이 0보다 크다(design-refresh 명세서 4.7-1).
  const cardUploads: Upload[] = [
    { day: 1, time: "08:40", amount: [-92_000, -98_500, -95_300, -101_200, -93_700, -96_400], description: "동네주유소", cardLabel: "본인 1234" },
    { day: 2, time: "10:12", amount: 88_000, description: "인터파크 티켓 취소", cardLabel: "본인 1234", month: 5 },
    { day: 3, time: "12:31", amount: [-11_200, -7_600, -10_400, -9_800, -12_500, -8_900], description: "김밥천국", cardLabel: "본인 1234" },
    { day: 7, time: "19:02", amount: [-61_800, -49_900, -66_400, -54_200, -71_300, -48_600], description: "이마트", cardLabel: "본인 1234" },
    { day: 9, time: "07:50", amount: -3_000, description: "GS25", method: "포인트리", cardLabel: "본인 1234", month: 4 },
    { day: 12, time: "08:15", amount: -4_500, description: "스타벅스", cardLabel: "본인 1234" },
    { day: 16, time: "22:05", amount: -320_000, description: "야놀자", cardLabel: "본인 1234", month: 3 },
    { day: 18, time: "21:40", amount: -129_000, description: "쿠팡", cardLabel: "본인 1234" },
    { day: 19, time: "10:00", amount: 129_000, description: "쿠팡 취소", cardLabel: "본인 1234" },
    { day: 25, time: "13:20", amount: -32_000, description: "올리브영", cardLabel: "가족 5678" },
    { day: 26, time: "17:30", amount: -25_000, description: "별빛헤어", cardLabel: "본인 1234" },
    { day: 27, time: "14:00", amount: -88_000, description: "인터파크 티켓", cardLabel: "본인 1234", month: 4 },
  ];

  // 저장된 분류(5단계 파일 9장). 업로드 거래는 applyImport로 들어가 규칙이 있으면 saved로 붙는다.
  // AI가 분류한 셈인 규칙과, 사람 이름을 사용자가 고친 규칙 하나를 넣는다. 올리브영은 규칙이 없어 미분류로 남아 "다시 분류" 버튼이 보인다.
  // 별빛헤어는 맞는 칸이 없어 AI가 기타 지출로 둔 셈이라 카테고리 화면에 "기타 다시 분류"가 보인다(8장, 결정 F9).
  const categoryIds = new Map(
    (await db.select({ id: categories.id, name: categories.name }).from(categories).where(eq(categories.userId, userId))).map((c) => [c.name, c.id]),
  );
  const categoryId = (name: string) => {
    const found = categoryIds.get(name);
    if (found == null) throw new Error(`카테고리 ${name}이(가) 없습니다.`);
    return found;
  };
  const rules: [string, string, "ai" | "user"][] = [
    ["월세", "주거·관리비", "ai"],
    ["(주)원북 급여", "급여", "ai"],
    ["하나카드 결제", "카드대금", "ai"],
    ["통신요금", "통신", "ai"],
    ["홍길동", "육아·교육", "user"],
    ["김밥천국", "외식·배달", "ai"],
    ["이마트", "장보기", "ai"],
    ["동네주유소", "교통·차량", "ai"],
    ["스타벅스", "카페·간식", "ai"],
    ["쿠팡", "쇼핑·의류", "ai"],
    ["쿠팡 취소", "쇼핑·의류", "ai"],
    ["이자", "이자·배당", "ai"],
    ["별빛헤어", "기타 지출", "ai"],
    // 6단계 확인용(6단계 파일 6장)
    ["크몽 정산", "부수입", "ai"],
    ["카카오 비상금", "내 계좌·페이 이동", "ai"],
    ["하나 급여통장", "내 계좌·페이 이동", "ai"],
    ["GS25", "카페·간식", "ai"],
    ["야놀자", "여가·여행", "ai"],
    ["인터파크 티켓", "여가·여행", "ai"],
    ["인터파크 티켓 취소", "여가·여행", "ai"],
  ];
  await db.insert(categoryRules).values(
    rules.map(([description, name, source]) => ({
      userId,
      matchKey: matchKeyOf({ description, method: null })!.key,
      categoryId: categoryId(name),
      source,
      updatedAt: `${firstMonth}-01T00:00:00.000Z`,
    })),
  );

  // 수동 거래·이체가 업로드 기간에 걸려 확인을 묻지 않도록 업로드를 먼저 넣는다.
  await upload(salary, "hana_bank", salaryKey, "하나 급여통장", salaryUploads);
  const cardIds = await upload(card, "hana_card", null, "하나카드", cardUploads);
  // 비상금 이자와 급여통장에서 받는 돈. 실제 잔액은 기록 안 된 입금 1만 원만큼 커서, 첫 이자 날에 +1만 원 보정 거래가 생긴다.
  // 받는 돈을 이자보다 뒤(23일)에 두는 것은, 앞에 두면 보정이 그 날로 옮겨가기 때문이다(보정은 잔액이 있는 첫 거래 날에 생긴다).
  await upload(
    savings,
    "kakao_bank",
    savingsKey,
    "카카오 비상금",
    [
      { day: 21, amount: 4_100, description: "이자", method: "이자" },
      { day: 23, amount: 200_000, description: "하나 급여통장", method: "입금" },
    ],
    5_010_000,
  );

  for (const month of months) {
    const date = (day: number) => dateOf(month, day);
    // 대출 상환: 급여통장 → 대출 이체
    const repay = date(25);
    if (repay) {
      await createTransfer(db, userId, {
        fromAccountId: salary,
        toAccountId: loan,
        date: repay,
        time: null,
        amount: 300_000,
        description: "학자금 상환",
        memo: null,
      });
    }
    // 현금으로 쓴 수동 거래
    const cash = date(14);
    if (cash) {
      // 수동 거래는 폼에서 고른 카테고리가 user로 붙는다(5단계 파일 2장).
      await createTransaction(db, userId, {
        accountId: salary,
        date: cash,
        time: null,
        amount: -20_000,
        description: "경조사 현금",
        memo: "직접 입력",
        categoryId: categoryId("경조사·기부"),
      });
    }
  }

  // 비상금으로 옮기는 이체(첫 달)
  await createTransfer(db, userId, {
    fromAccountId: salary,
    toAccountId: savings,
    date: `${firstMonth}-11`,
    time: "09:00",
    amount: 500_000,
    description: "비상금 적립",
    memo: null,
  });

  // 손댄 거래: 첫 달 업로드 거래 하나는 내용을 고치고(수정함), 하나는 삭제 표시한다.
  // 첫 달은 오늘보다 앞이라 카드 거래가 모두 들어가 있다. 첫 달 둘째·셋째 거래는 이마트·스타벅스다.
  const edited = cardIds[1];
  if (edited) {
    await updateTransaction(db, userId, edited, {
      accountId: card,
      date: `${firstMonth}-07`,
      time: "19:02",
      amount: -54_200,
      description: "이마트 장보기",
      memo: "주말 장보기",
    });
  }
  const deleted = cardIds[2];
  if (deleted) await setTransactionDeleted(db, userId, deleted, true);

  return { accounts: { salary, savings, loan, card } };
}

