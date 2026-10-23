// 가짜 업로드 파일을 만든다(test-results 아래, 저장소에 커밋하지 않는다).
import fs from "node:fs";
import officeCrypto from "officecrypto-tool";
import * as XLSX from "xlsx";
import { hanaBankSheets, kakaoBankSheets } from "../../src/lib/parsers/test-sheets";
import type { Cell } from "../../src/lib/parsers/types";
import { FAKE_KAKAO_PASSWORD, FILES_DIR, HANA_1, HANA_2, KAKAO, UNSUPPORTED, file, thisMonth } from "./files";

function xlsx(rows: Cell[][]): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  return Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
}

export default async function globalSetup() {
  fs.mkdirSync(FILES_DIR, { recursive: true });
  const m = thisMonth();
  const dot = m.replace("-", ".");
  fs.writeFileSync(
    file(HANA_1),
    xlsx(
      hanaBankSheets(
        [
          [`${m}-05 12:00:00`, "체크", "가짜마트", 30_000, 0, 70_000, ""],
          [`${m}-03 09:00:00`, "대체", "가짜급여", 0, 100_000, 100_000, ""],
        ],
        `${m}-01 ~ ${m}-10`,
      )[0],
    ),
  );
  // 기간이 겹치는 다음 파일(되돌리기 확인용)
  fs.writeFileSync(
    file(HANA_2),
    xlsx(
      hanaBankSheets(
        [
          [`${m}-12 08:00:00`, "체크", "가짜카페", 5_000, 0, 65_000, ""],
          [`${m}-05 12:00:00`, "체크", "가짜마트", 30_000, 0, 70_000, ""],
          [`${m}-03 09:00:00`, "대체", "가짜급여", 0, 100_000, 100_000, ""],
        ],
        `${m}-01 ~ ${m}-15`,
      )[0],
    ),
  );
  const kakao = xlsx(kakaoBankSheets([[`${dot}.06 12:00:00`, "출금", "-7,000", "93,000", "", "가짜분식", ""]], `${dot}.01 - ${dot}.10`)[0]);
  fs.writeFileSync(file(KAKAO), officeCrypto.encrypt(kakao, { password: FAKE_KAKAO_PASSWORD }));
  fs.writeFileSync(file(UNSUPPORTED), xlsx([["이름", "점수"], ["가짜", 1]]));
}
