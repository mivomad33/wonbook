// 확인용 시드 데이터(design.md 4.5). 실행한 날을 기준으로 이번 달과 앞의 두 달 치를 넣는다.
// 앱 규칙을 따르도록 lib/의 입력 함수를 거친다. 업로드 거래는 가짜 파일을 만들어 업로드 코드(applyImport)로 넣는다(3단계 파일 8.1).
import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, categories, categoryRules, type Institution, transactions } from "@/db/schema";
import { matchKeyOf } from "@/lib/categorize";
import { shiftMonth, today } from "@/lib/format";
import { applyImport } from "@/lib/import";
import type { ParsedTransaction } from "@/lib/parsers";
import { createTransaction, createTransfer, setTransactionDeleted, updateTransaction } from "@/lib/transactions";

// amount를 세 값으로 주면 달마다(첫 달, 가운데 달, 이번 달) 다른 금액이다. month를 주면 그 달(0~2)에만 넣는다(6단계 파일 6장).
type Upload = {
  day: number;
  time?: string;
  amount: number | readonly [number, number, number];
  description: string;
  method?: string;
  cardLabel?: string;
  month?: 0 | 1 | 2;
};

export function seedDevData(db: Db, now = today()) {
  const thisMonth = now.slice(0, 7);
  const months = [shiftMonth(thisMonth, -2), shiftMonth(thisMonth, -1), thisMonth];
  const firstMonth = months[0];
  // 이번 달 거래는 오늘까지만 넣는다.
  const dateOf = (month: string, day: number) => {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    return date <= now ? date : null;
  };

  const addAccount = (values: typeof accounts.$inferInsert) =>
    db.insert(accounts).values(values).returning({ id: accounts.id }).get().id;
  // 기초 잔액 기준일은 첫 달 전날(앞 달 말일)로 둔다. 기준일 당일까지의 거래는 기초 잔액에 들어 있다.
  const beforeFirst = `${shiftMonth(firstMonth, -1)}-28`;

  const salary = addAccount({
    name: "하나 급여통장",
    kind: "asset",
    institution: "hana_bank",
    externalKey: "12345678901234",
    openingBalance: 2_400_000,
    openingDate: beforeFirst,
    sortOrder: 1,
  });
  const savings = addAccount({
    name: "카카오 비상금",
    kind: "asset",
    institution: "kakao_bank",
    externalKey: "1234",
    openingBalance: 5_000_000,
    sortOrder: 2,
  });
  const loan = addAccount({
    name: "학자금 대출",
    kind: "liability",
    openingBalance: -8_000_000,
    openingDate: beforeFirst,
    sortOrder: 1,
  });
  const card = addAccount({ name: "하나카드", kind: "card", institution: "hana_card", sortOrder: 1 });

  // 계정마다 석 달 치를 파일 하나로 넣는다. 기간은 첫 달 1일 ~ 오늘, 파일 이름은 `시드-<계정>`.
  // 시드 DB는 매번 새로 만들어 백업하지 않는다. 넣은 거래 id를 넣은 순서(seq)대로 돌려준다.
  // actualStart를 주면 그 값에서 시작해 거래 후 잔액(balance_after)을 채운다. 기초 잔액과 다르면 보정 거래가 생긴다(4단계 파일 7장).
  const upload = (accountId: number, institution: Institution, name: string, uploads: Upload[], actualStart?: number) => {
    let actual = actualStart ?? 0;
    const rows = months.flatMap((month, monthIndex) =>
      uploads.flatMap((u): ParsedTransaction[] => {
        const date = dateOf(month, u.day);
        if (!date || (u.month != null && u.month !== monthIndex)) return [];
        const { time = null, description, method = null, cardLabel = null } = u;
        const amount = typeof u.amount === "number" ? u.amount : u.amount[monthIndex];
        actual += amount;
        const balanceAfter = actualStart == null ? null : actual;
        return [{ date, time, amount, description, method, memo: null, cardLabel, balanceAfter, raw: {} }];
      }),
    );
    const result = applyImport(db, {
      accountId,
      fileName: `시드-${name}`,
      parsed: { institution, accountKey: null, period: { start: `${firstMonth}-01`, end: now }, transactions: rows },
      confirmedIds: [],
      backupPath: null,
    });
    if (result.status !== "applied") throw new Error("시드 업로드가 손댄 거래에 걸렸습니다.");
    return db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.importId, result.importId))
      .orderBy(asc(transactions.seq))
      .all()
      .map((r) => r.id);
  };

  const salaryUploads: Upload[] = [
    { day: 1, time: "09:12", amount: -650_000, description: "월세", method: "자동이체" },
    { day: 10, time: "08:30", amount: 3_200_000, description: "(주)원북 급여", method: "급여" },
    { day: 15, time: "10:05", amount: [-412_300, -655_800, -298_400], description: "하나카드 결제", method: "자동이체" },
    { day: 17, time: "11:20", amount: 450_000, description: "크몽 정산", method: "타행입금", month: 1 },
    { day: 20, time: "18:44", amount: [-38_000, -41_500, -39_200], description: "통신요금", method: "자동이체" },
    { day: 22, time: "20:10", amount: -300_000, description: "홍길동", method: "스마트출금" },
    // 비상금으로 보내는 돈. 비상금 업로드의 "하나 급여통장" 입금과 짝이다(이동 표의 나감·들어옴).
    { day: 23, time: "09:30", amount: -200_000, description: "카카오 비상금", method: "스마트출금" },
  ];
  // 이번 달 인터파크 환불은 앞 달 결제의 환불이라, 이번 달 여가·여행이 음수가 된다. 이번 달 거래는 오늘까지만 들어가므로 1일에 둔다.
  const cardUploads: Upload[] = [
    { day: 1, time: "10:12", amount: 88_000, description: "인터파크 티켓 취소", cardLabel: "본인 1234", month: 2 },
    { day: 3, time: "12:31", amount: [-9_800, -12_500, -8_900], description: "김밥천국", cardLabel: "본인 1234" },
    { day: 7, time: "19:02", amount: [-54_200, -71_300, -48_600], description: "이마트", cardLabel: "본인 1234" },
    { day: 9, time: "07:50", amount: -3_000, description: "GS25", method: "포인트리", cardLabel: "본인 1234", month: 1 },
    { day: 12, time: "08:15", amount: -4_500, description: "스타벅스", cardLabel: "본인 1234" },
    { day: 16, time: "22:05", amount: -320_000, description: "야놀자", cardLabel: "본인 1234", month: 0 },
    { day: 18, time: "21:40", amount: -129_000, description: "쿠팡", cardLabel: "본인 1234" },
    { day: 19, time: "10:00", amount: 129_000, description: "쿠팡 취소", cardLabel: "본인 1234" },
    { day: 25, time: "13:20", amount: -32_000, description: "올리브영", cardLabel: "가족 5678" },
    { day: 26, time: "17:30", amount: -25_000, description: "별빛헤어", cardLabel: "본인 1234" },
    { day: 27, time: "14:00", amount: -88_000, description: "인터파크 티켓", cardLabel: "본인 1234", month: 1 },
  ];

  // 저장된 분류(5단계 파일 9장). 업로드 거래는 applyImport로 들어가 규칙이 있으면 saved로 붙는다.
  // AI가 분류한 셈인 규칙과, 사람 이름을 사용자가 고친 규칙 하나를 넣는다. 올리브영은 규칙이 없어 미분류로 남아 "다시 분류" 버튼이 보인다.
  // 별빛헤어는 맞는 칸이 없어 AI가 기타 지출로 둔 셈이라 카테고리 화면에 "기타 다시 분류"가 보인다(8장, 결정 F9).
  const categoryId = (name: string) => {
    const found = db.select({ id: categories.id }).from(categories).where(eq(categories.name, name)).get();
    if (!found) throw new Error(`카테고리 ${name}이(가) 없습니다.`);
    return found.id;
  };
  const rules: [string, string, "ai" | "user"][] = [
    ["월세", "주거·관리비", "ai"],
    ["(주)원북 급여", "급여", "ai"],
    ["하나카드 결제", "카드대금", "ai"],
    ["통신요금", "통신", "ai"],
    ["홍길동", "육아·교육", "user"],
    ["김밥천국", "외식·배달", "ai"],
    ["이마트", "장보기", "ai"],
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
  for (const [description, name, source] of rules) {
    const key = matchKeyOf({ description, method: null })!.key;
    db.insert(categoryRules).values({ matchKey: key, categoryId: categoryId(name), source, updatedAt: `${firstMonth}-01T00:00:00.000Z` }).run();
  }

  // 수동 거래·이체가 업로드 기간에 걸려 확인을 묻지 않도록 업로드를 먼저 넣는다.
  upload(salary, "hana_bank", "하나 급여통장", salaryUploads);
  const cardIds = upload(card, "hana_card", "하나카드", cardUploads);
  // 비상금 이자와 급여통장에서 받는 돈. 실제 잔액은 기록 안 된 입금 1만 원만큼 커서, 첫 이자 날에 +1만 원 보정 거래가 생긴다.
  // 받는 돈을 이자보다 뒤(23일)에 두는 것은, 앞에 두면 보정이 그 날로 옮겨가기 때문이다(보정은 잔액이 있는 첫 거래 날에 생긴다).
  upload(
    savings,
    "kakao_bank",
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
      createTransfer(db, {
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
      createTransaction(db, {
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
  createTransfer(db, {
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
    updateTransaction(db, edited, {
      accountId: card,
      date: `${firstMonth}-07`,
      time: "19:02",
      amount: -54_200,
      description: "이마트 장보기",
      memo: "주말 장보기",
    });
  }
  const deleted = cardIds[2];
  if (deleted) setTransactionDeleted(db, deleted, true);

  return { accounts: { salary, savings, loan, card } };
}
