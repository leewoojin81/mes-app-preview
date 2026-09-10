// item_code 순번/정렬 검증 스크립트
// - 카테고리별 건수 / seq_no NULL·중복 확인
// - 카테고리 내에서 item_code 오름차순 정렬이 원본 엑셀 No.(seq_no) 순서와 일치하는지 확인
//
// Usage: node scripts/verify-item-codes.js

const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const DB_PATH = path.join(__dirname, "..", "data", "mes.db");
const db = new DatabaseSync(DB_PATH, { readOnly: true });

console.log("=== 1. 카테고리별 건수 / seq_no 현황 ===");
console.table(
  db
    .prepare(
      `SELECT category,
              COUNT(*) AS total,
              SUM(CASE WHEN seq_no IS NULL THEN 1 ELSE 0 END) AS seq_null,
              MIN(seq_no) AS seq_min,
              MAX(seq_no) AS seq_max
       FROM items GROUP BY category`
    )
    .all()
);

console.log("=== 2. 카테고리 내 seq_no 중복 ===");
const dupSeq = db
  .prepare(
    `SELECT category, seq_no, COUNT(*) AS c, GROUP_CONCAT(item_code) AS codes
     FROM items WHERE seq_no IS NOT NULL
     GROUP BY category, seq_no HAVING c > 1 LIMIT 20`
  )
  .all();
console.log(dupSeq.length ? dupSeq : "없음");

console.log("=== 3. 카테고리 내 seq_no 결번(gap) ===");
for (const { category } of db.prepare("SELECT DISTINCT category FROM items").all()) {
  const seqs = db
    .prepare(
      "SELECT seq_no FROM items WHERE category = ? AND seq_no IS NOT NULL ORDER BY seq_no"
    )
    .all(category)
    .map((r) => r.seq_no);
  const gaps = [];
  for (let i = 1; i < seqs.length; i++) {
    if (seqs[i] - seqs[i - 1] !== 1) gaps.push(`${seqs[i - 1]}→${seqs[i]}`);
  }
  console.log(
    `${category}: ${seqs.length}건, 결번 ${gaps.length}곳${gaps.length ? " — " + gaps.slice(0, 10).join(", ") + (gaps.length > 10 ? " ..." : "") : ""}`
  );
}

console.log("=== 4. item_code 정렬 vs seq_no 정렬 일치 여부 (카테고리별) ===");
for (const { category } of db.prepare("SELECT DISTINCT category FROM items").all()) {
  const rows = db
    .prepare(
      "SELECT item_code, seq_no FROM items WHERE category = ? AND seq_no IS NOT NULL ORDER BY item_code"
    )
    .all(category);
  const mismatches = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].seq_no < rows[i - 1].seq_no) {
      mismatches.push(
        `${rows[i - 1].item_code}(No.${rows[i - 1].seq_no}) 뒤에 ${rows[i].item_code}(No.${rows[i].seq_no})`
      );
    }
  }
  console.log(
    `${category}: item_code 정렬 기준 seq_no 역전 ${mismatches.length}건`
  );
  for (const m of mismatches.slice(0, 5)) console.log("   " + m);
  if (mismatches.length > 5) console.log(`   ... 외 ${mismatches.length - 5}건`);
}

console.log("=== 5. item_code 형식 분포 (접두어별) ===");
console.table(
  db
    .prepare(
      `SELECT category,
              CASE WHEN instr(item_code, '-') > 0
                   THEN substr(item_code, 1, instr(item_code, '-') - 1)
                   ELSE substr(item_code, 1, 3) END AS prefix,
              COUNT(*) AS c
       FROM items GROUP BY category, prefix ORDER BY category, c DESC`
    )
    .all()
);

console.log("=== 6. 공백/대소문자 이상 코드 ===");
const badCodes = db
  .prepare(
    `SELECT item_code FROM items
     WHERE item_code != trim(item_code) OR item_code LIKE '% %' LIMIT 20`
  )
  .all();
console.log(badCodes.length ? badCodes : "없음");
