// 일회성 마이그레이션: 수동/일괄등록으로 만든 수주(detail.상태 없음)만 대상으로,
// 예전 내부 워크플로 상태(대기/확정)를 새 5단계 상태(수주/Packing/출고/완료/중단)로 옮긴다.
// 엑셀 업로드분(detail.상태 존재)은 건드리지 않는다 — 화면에는 항상 detail.상태가 우선
// 표시되므로 그 status 컬럼은 원래도 화면에 영향이 없다.
//
// Usage: node scripts/migrate-legacy-status.js

const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const DB_PATH = path.join(__dirname, "..", "data", "mes.db");
const db = new DatabaseSync(DB_PATH);

const MAP = { 대기: "수주", 확정: "Packing" };

for (const [from, to] of Object.entries(MAP)) {
  const before = db
    .prepare(
      `SELECT COUNT(*) as c FROM sales_orders
       WHERE status = ? AND (detail IS NULL OR json_extract(detail, '$.상태') IS NULL)`
    )
    .get(from).c;
  db.prepare(
    `UPDATE sales_orders SET status = ?
     WHERE status = ? AND (detail IS NULL OR json_extract(detail, '$.상태') IS NULL)`
  ).run(to, from);
  console.log(`${from} -> ${to}: ${before}건 변환`);
}

db.close();
