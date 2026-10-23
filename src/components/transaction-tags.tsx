import { Tag } from "@/components/tag";
import type { TransactionKind, TransactionSource } from "@/db/schema";
import { TRANSACTION_KIND_LABELS } from "@/lib/labels";

type TaggedTransaction = {
  kind: TransactionKind;
  source: TransactionSource;
  amount: number;
  editedAt: string | null;
  deletedAt: string | null;
  peerAccountName: string | null;
};

// 내용 옆 작은 표시. 수동·수정함·삭제 표시가 붙은 거래가 3단계 덮어쓰기에서 확인을 받는 손댄 거래다(2단계 파일 2.3).
// 거래 목록과 업로드의 손댄 거래 확인 대화상자(3단계 파일 7.2)가 같이 쓴다.
export function TransactionTags({ row }: { row: TaggedTransaction }) {
  const transfer = TRANSACTION_KIND_LABELS.transfer;
  return (
    <>
      {row.kind === "transfer" && (
        <Tag>
          {row.peerAccountName == null
            ? `${transfer}(반대쪽 없음)`
            : `${transfer} ${row.amount < 0 ? "→" : "←"} ${row.peerAccountName}`}
        </Tag>
      )}
      {row.kind === "normal" && row.source === "manual" && <Tag>수동</Tag>}
      {row.editedAt && <Tag>수정함</Tag>}
      {row.kind === "adjustment" && <Tag>{TRANSACTION_KIND_LABELS.adjustment}</Tag>}
      {row.deletedAt && <Tag>삭제함</Tag>}
    </>
  );
}
