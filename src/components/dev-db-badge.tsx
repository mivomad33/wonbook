// 개발 서버에서 개발 DB를 쓰고 있다는 표시(4.8-2). 운영 빌드에는 나오지 않는다.
export function DevDbBadge() {
  if (process.env.NODE_ENV !== "development") return null;
  return (
    <div className="pointer-events-none fixed right-2 bottom-2 z-50 rounded bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white" aria-label="개발 DB">
      개발 DB
    </div>
  );
}
