// Postgres 쿼리에서 여러 모듈이 같이 쓰는 조각(design.md 2.3).
import { type SQLWrapper, sql } from "drizzle-orm";

// SQLite에서는 null이 가장 작은 값이라 오름차순이면 맨 앞, 내림차순이면 맨 뒤였다. Postgres는 반대라 같은 순서를 명시한다.
export const ascNullsFirst = (column: SQLWrapper) => sql`${column} asc nulls first`;
export const descNullsLast = (column: SQLWrapper) => sql`${column} desc nulls last`;

// Postgres의 count(*)·sum(bigint)는 문자열로 온다. 화면과 계산은 number로 쓴다(안전한 정수 범위 안, design.md 1.1).
export const countAll = () => sql<number>`count(*)`.mapWith(Number);
