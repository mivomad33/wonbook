// 화면 문구가 합니다체인지 검사한다(4.6-7). 소스에서 문자열·템플릿·JSX 글자만 뽑아 본다(주석은 보지 않는다).
// 검사 범위: 화면(src/app, src/components)과 화면에 돌려주는 오류·안내 문구를 만드는 코드(src/lib, src/auth, src/secrets).
// 제외: 테스트, 분류 프롬프트(lib/categorize/claude.ts), 시드·데모 데이터(db/), 카테고리 이름(db/default-categories.ts),
//       개발자용 오류(console 출력, new Error, throw new Error).
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { findHaera } from "./tone";

const SRC = path.resolve(import.meta.dirname);
const DIRS = ["app", "components", "lib", "auth", "secrets"].map((d) => path.join(SRC, d));
const EXCLUDE = [/\.test\.tsx?$/, /lib[/\\]categorize[/\\]claude\.ts$/];

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.tsx?$/.test(e.name) && !EXCLUDE.some((x) => x.test(p)) ? [p] : [];
  });
}

/** 개발자용 문구인지: console.*(...)의 인자나 new Error(...)의 인자 */
function developerOnly(node: ts.Node): boolean {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression) && ts.isIdentifier(p.expression.expression) && p.expression.expression.text === "console") return true;
    if (ts.isNewExpression(p) && ts.isIdentifier(p.expression) && ["Error", "RangeError", "TypeError"].includes(p.expression.text)) return true;
  }
  return false;
}

function texts(file: string): { text: string; line: number }[] {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: { text: string; line: number }[] = [];
  const add = (node: ts.Node, text: string) => {
    if (/[가-힣]/.test(text) && !developerOnly(node)) out.push({ text, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
  };
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node, node.text);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) add(node, node.text);
    else if (ts.isJsxText(node)) add(node, node.text.trim());
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("말투", () => {
  it("해라체 판별 규칙", () => {
    for (const bad of ["다시 제출할 수 있다.", "이 거래를 지울까?", "끝냈다", "하자.", "보라."]) expect(findHaera(bad).length, bad).not.toBe(0);
    for (const good of ["다시 제출할 수 있습니다.", "다 썼습니다", "예상보다 많습니다.", "달마다 다릅니다.", "다시 시도", "지우시겠습니까?", "둘러보세요", "쓰는 금융사가 없나요?", "끌어다 놓거나"]) {
      expect(findHaera(good), good).toEqual([]);
    }
  });

  it("화면 문구에 해라체 종결이 없다", () => {
    const issues: string[] = [];
    for (const dir of DIRS) {
      for (const f of files(dir)) for (const t of texts(f)) for (const i of findHaera(t.text)) issues.push(`${path.relative(SRC, f)}:${t.line} …${i.snippet}`);
    }
    expect(issues).toEqual([]);
  });
});
