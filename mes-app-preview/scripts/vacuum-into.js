// 살아있는 SQLite DB를 안전하게 다른 파일로 스냅샷 복사한다(2026-09-10 사용자 요청,
// 3000->3001 DB 야간 동기화용). 원본이 그 순간 쓰기 중이어도 SQLite의 VACUUM INTO가
// 항상 트랜잭션 일관성 있는 스냅샷을 만들어주므로, 단순 파일 복사(Copy-Item)와 달리
// 원본 서버(3000)를 멈출 필요가 없다. 대상 파일은 미리 없어야 한다(있으면 SQLite가
// 에러를 낸다 — 호출부(PowerShell)가 지우고 부른다).
//
// 사용법: node vacuum-into.js <원본.db> <대상.db>

const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");

const [, , srcArg, destArg] = process.argv;
if (!srcArg || !destArg) {
  console.error("사용법: node vacuum-into.js <원본.db> <대상.db>");
  process.exit(1);
}

const src = path.resolve(srcArg);
const dest = path.resolve(destArg).replace(/\\/g, "/");

const db = new DatabaseSync(src, { readOnly: true });
db.exec(`VACUUM INTO '${dest}';`);
db.close();
console.log(`VACUUM INTO 완료: ${src} -> ${dest}`);
