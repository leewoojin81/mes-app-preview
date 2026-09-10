// Import 거래처등록.xlsx into the customers table.
//
// Usage:
//   node scripts/import-customers.js
//
// Run from the mes-app directory (paths are resolved relative to this file).

const path = require("node:path");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const XLSX = require("xlsx");

const ROOT = path.join(__dirname, "..", ".."); // mes-system/
const DB_PATH = path.join(__dirname, "..", "data", "mes.db");
const SOURCE_FILE = path.join(ROOT, "거래처등록.xlsx");

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      customer_code TEXT PRIMARY KEY,
      customer_name TEXT NOT NULL,
      customer_type TEXT,
      biz_reg_no TEXT,
      ceo_name TEXT,
      zip_code TEXT,
      address TEXT,
      phone TEXT,
      fax TEXT,
      biz_type TEXT,
      biz_item TEXT,
      manager_name TEXT,
      settle_customer_code TEXT,
      settle_customer_name TEXT,
      trade_start_date TEXT,
      trade_end_date TEXT,
      category_large TEXT,
      category_mid TEXT,
      category_small TEXT,
      bank_name TEXT,
      bank_account TEXT,
      account_holder TEXT,
      website TEXT,
      is_purchase TEXT NOT NULL DEFAULT 'N',
      is_outsourcing TEXT NOT NULL DEFAULT 'N',
      is_sales TEXT NOT NULL DEFAULT 'N',
      country TEXT,
      seq INTEGER NOT NULL DEFAULT 0,
      use_yn TEXT NOT NULL DEFAULT 'Y',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `);
}

// 원본 시트의 빈 값은 "  -  -     ", "   .  .  ", "--" 같은 자리표시 문자열로
// 채워져 있다 (숫자·문자 없이 공백/구분기호만 있으면 실질적으로 빈 값).
function str(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  if (!/[0-9A-Za-z가-힣]/.test(s)) return null;
  return s;
}
function num(v) {
  return typeof v === "number" ? v : null;
}
function ynFlag(v) {
  return str(v) === "Y" ? "Y" : "N";
}

function main() {
  if (!fs.existsSync(SOURCE_FILE)) {
    throw new Error(`파일을 찾을 수 없습니다: ${SOURCE_FILE}`);
  }
  if (!fs.existsSync(path.dirname(DB_PATH))) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  }
  const db = new DatabaseSync(DB_PATH);
  ensureSchema(db);

  const wb = XLSX.readFile(SOURCE_FILE);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const header = rows[0];
  const idx = (name) => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`Column not found: ${name}`);
    return i;
  };

  const iNo = idx("No.");
  const iCode = idx("코드");
  const iName = idx("거래처명");
  const iType = idx("구분");
  const iBizRegNo = idx("사업자번호");
  const iCeo = idx("대표자");
  const iZip = idx("우편번호");
  const iAddress = idx("주소");
  const iPhone = idx("전화번호");
  const iFax = idx("팩스번호");
  const iBizType = idx("업태");
  const iBizItem = idx("종목");
  const iManager = idx("담당자");
  const iStatus = idx("상태");
  const iSettleCode = idx("정산거래처");
  const iSettleName = idx("정산거래처명");
  const iTradeStart = idx("거래일자(시작)");
  const iTradeEnd = idx("거래일자(종료)");
  const iCatLarge = idx("대분류");
  const iCatMid = idx("중분류");
  const iCatSmall = idx("소분류");
  const iBank = idx("결제은행");
  const iAccount = idx("계좌번호");
  const iHolder = idx("예금주");
  const iWebsite = idx("홈페이지");
  const iPurchase = idx("구매");
  const iOutsourcing = idx("외주");
  const iSales = idx("판매");
  const iCountry = idx("국가정보");

  const insert = db.prepare(
    `INSERT INTO customers
       (customer_code, customer_name, customer_type, biz_reg_no, ceo_name, zip_code, address,
        phone, fax, biz_type, biz_item, manager_name, settle_customer_code, settle_customer_name,
        trade_start_date, trade_end_date, category_large, category_mid, category_small,
        bank_name, bank_account, account_holder, website, is_purchase, is_outsourcing, is_sales,
        country, seq, use_yn)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(customer_code) DO UPDATE SET
       customer_name = excluded.customer_name,
       customer_type = excluded.customer_type,
       biz_reg_no = excluded.biz_reg_no,
       ceo_name = excluded.ceo_name,
       zip_code = excluded.zip_code,
       address = excluded.address,
       phone = excluded.phone,
       fax = excluded.fax,
       biz_type = excluded.biz_type,
       biz_item = excluded.biz_item,
       manager_name = excluded.manager_name,
       settle_customer_code = excluded.settle_customer_code,
       settle_customer_name = excluded.settle_customer_name,
       trade_start_date = excluded.trade_start_date,
       trade_end_date = excluded.trade_end_date,
       category_large = excluded.category_large,
       category_mid = excluded.category_mid,
       category_small = excluded.category_small,
       bank_name = excluded.bank_name,
       bank_account = excluded.bank_account,
       account_holder = excluded.account_holder,
       website = excluded.website,
       is_purchase = excluded.is_purchase,
       is_outsourcing = excluded.is_outsourcing,
       is_sales = excluded.is_sales,
       country = excluded.country,
       seq = excluded.seq,
       use_yn = excluded.use_yn`
  );

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  db.exec("BEGIN");
  try {
    for (const r of rows.slice(1)) {
      const code = str(r[iCode]);
      if (!code) {
        skipped++;
        continue;
      }
      const exists = db.prepare("SELECT 1 FROM customers WHERE customer_code=?").get(code);
      // "상태" 컬럼: "사용"=Y, 그 외(빈 값 등)=N
      const useYn = str(r[iStatus]) === "사용" ? "Y" : "N";

      insert.run(
        code,
        str(r[iName]) ?? code,
        str(r[iType]),
        str(r[iBizRegNo]),
        str(r[iCeo]),
        str(r[iZip]),
        str(r[iAddress]),
        str(r[iPhone]),
        str(r[iFax]),
        str(r[iBizType]),
        str(r[iBizItem]),
        str(r[iManager]),
        str(r[iSettleCode]),
        str(r[iSettleName]),
        str(r[iTradeStart]),
        str(r[iTradeEnd]),
        str(r[iCatLarge]),
        str(r[iCatMid]),
        str(r[iCatSmall]),
        str(r[iBank]),
        str(r[iAccount]),
        str(r[iHolder]),
        str(r[iWebsite]),
        ynFlag(r[iPurchase]),
        ynFlag(r[iOutsourcing]),
        ynFlag(r[iSales]),
        str(r[iCountry]),
        num(r[iNo]) ?? 0,
        useYn
      );
      if (exists) updated++;
      else inserted++;
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  console.log(`신규 ${inserted}건, 갱신 ${updated}건, 건너뜀(거래처코드 없음) ${skipped}건`);
  const totals = db.prepare("SELECT use_yn, COUNT(*) c FROM customers GROUP BY use_yn").all();
  console.log("사용여부별 건수:", totals);
}

main();
