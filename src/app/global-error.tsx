"use client";

// 루트 레이아웃까지 실패했을 때의 오류 화면(4.10-6). 전역 스타일이 없으므로 모양을 직접 정한다.
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#fafafa", color: "#0a0a0a", display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div style={{ background: "#fff", border: "1px solid #e5e5e5", borderRadius: 14, padding: 28, maxWidth: 480, width: "100%", display: "flex", flexDirection: "column", gap: 14 }}>
          <h1 style={{ margin: 0, fontSize: 20 }}>문제가 생겼습니다</h1>
          <p style={{ margin: 0, color: "#737373" }}>잠시 연결이 원활하지 않았습니다. 다시 시도해 주세요.</p>
          <button onClick={() => retry()} style={{ height: 44, borderRadius: 10, border: 0, background: "#171717", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
            다시 시도
          </button>
        </div>
      </body>
    </html>
  );
}
