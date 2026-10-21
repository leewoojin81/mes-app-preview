import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { BlisterLot, NcrRecord, QcPhotoMeta, SupplyLot } from "@/lib/qc-incoming-shared";
import { DESIGN_OPTIONS, NCR_STATUS, RECV_TYPE_OPTIONS, RESULT_OPTIONS, SUPPLY_PARTS } from "@/lib/qc-incoming-shared";

// 품질관리 "수입검사(QC-03)" 저장소 — 입고검사 대시보드의 부자재관리대장·부적합관리대장을 MES DB로 옮긴 것(2026-10-21).
// 테이블은 CREATE만 한다(DROP/ALTER 없음). 처음 만들어질 때 대시보드에 들어 있던 데이터(seed/qc-incoming-seed.json)를 한 번만 넣는다.
//   qc_supply_lots   부자재 로트(대시보드 "LG" 한 줄) — 엑셀 원본 값은 orig(JSON)에 남겨 "원래대로"를 지원
//   qc_supply_photos 로트 사진(엑셀에 들어 있던 사진 + 화면에서 올린 사진)
//   qc_blister_lots  블리스터 로트 — 부적합 대장의 입력원(블리스터 탭은 만들지 않아 읽기 전용). 대시보드 번호(no)가 겹치는 줄이 있어 별도 id를 키로 쓴다
//   qc_ncr           부적합 처리 기록(처리구분·상태·조치일·담당자·원인·조치내용) + 직접 추가한 부적합 로트
//   qc_incoming_meta 초기 데이터 적재 여부

const ensured = new WeakSet<DatabaseSync>();

export function ensureQcIncomingTables(db: DatabaseSync): void {
  if (ensured.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS qc_supply_lots (
      no INTEGER PRIMARY KEY,
      month INTEGER NOT NULL DEFAULT 0,
      part TEXT NOT NULL DEFAULT '기타',
      recv_date TEXT NOT NULL DEFAULT '',
      insp_date TEXT NOT NULL DEFAULT '',
      lot_no TEXT NOT NULL DEFAULT '',
      mat_code TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      supplier TEXT NOT NULL DEFAULT '',
      lot_qty INTEGER NOT NULL DEFAULT 0,
      insp_qty INTEGER NOT NULL DEFAULT 0,
      bad_qty INTEGER NOT NULL DEFAULT 0,
      inspector TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '',
      defs TEXT,
      item_code TEXT NOT NULL DEFAULT '',
      customer TEXT NOT NULL DEFAULT '',
      design TEXT NOT NULL DEFAULT '',
      recv_type TEXT NOT NULL DEFAULT '',
      phys_status TEXT NOT NULL DEFAULT '미검사',
      cert_status TEXT NOT NULL DEFAULT '미작성',
      is_added INTEGER NOT NULL DEFAULT 0,
      orig TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_qc_supply_lots_lot ON qc_supply_lots(lot_no);
    CREATE TABLE IF NOT EXISTS qc_supply_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lot_no INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'upload',
      caption TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      ts TEXT NOT NULL DEFAULT '',
      mime TEXT NOT NULL DEFAULT 'image/jpeg',
      data BLOB,
      w INTEGER,
      h INTEGER,
      created_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_qc_supply_photos_lot ON qc_supply_photos(lot_no);
    CREATE TABLE IF NOT EXISTS qc_blister_lots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      no INTEGER NOT NULL DEFAULT 0,
      month INTEGER NOT NULL DEFAULT 0,
      item TEXT NOT NULL DEFAULT '',
      week TEXT NOT NULL DEFAULT '',
      supplier TEXT NOT NULL DEFAULT '',
      mold TEXT NOT NULL DEFAULT '',
      prod_date TEXT NOT NULL DEFAULT '',
      recv_date TEXT NOT NULL DEFAULT '',
      insp_date TEXT NOT NULL DEFAULT '',
      lot_no TEXT NOT NULL DEFAULT '',
      recv_qty INTEGER NOT NULL DEFAULT 0,
      insp_qty INTEGER NOT NULL DEFAULT 0,
      bad_qty INTEGER NOT NULL DEFAULT 0,
      defs TEXT,
      status TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS qc_ncr (
      k TEXT PRIMARY KEY,
      manual INTEGER NOT NULL DEFAULT 0,
      date TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT '',
      lot TEXT NOT NULL DEFAULT '',
      code TEXT NOT NULL DEFAULT '',
      item TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      sup TEXT NOT NULL DEFAULT '',
      insp INTEGER NOT NULL DEFAULT 0,
      bad INTEGER NOT NULL DEFAULT 0,
      defs TEXT NOT NULL DEFAULT '',
      disp TEXT NOT NULL DEFAULT '',
      st TEXT NOT NULL DEFAULT '미처리',
      adate TEXT NOT NULL DEFAULT '',
      who TEXT NOT NULL DEFAULT '',
      cause TEXT NOT NULL DEFAULT '',
      act TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_by TEXT
    );
    CREATE TABLE IF NOT EXISTS qc_incoming_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  seedIfNeeded(db);
  ensured.add(db);
}

// ── 초기 데이터(대시보드에 들어 있던 부자재 장부·블리스터·엑셀 사진) 적재 ─────────────────────
// 대시보드 부자재 줄 = [번호, 월, 자재, 입고일자, 검사일자, Lot No., 자재코드, 품명, 공급자, Lot수량, 검사수량, 부적합수량, 검사자, 결과, 비고, 불량유형[13], 품목코드]
// 블리스터 줄 = [번호, 월, 품목, 주차, 업체, 금형, 생산일자, 입고일자, 검사일자, Lot, 입고수량, 검사수량, 부적합수량, 불량유형[6], 상태, 비고]
function seedIfNeeded(db: DatabaseSync): void {
  const done = db.prepare("SELECT value FROM qc_incoming_meta WHERE key = 'seeded'").get() as { value: string } | undefined;
  if (done) return;
  const file = path.join(process.cwd(), "seed", "qc-incoming-seed.json");
  if (!fs.existsSync(file)) return; // 시드 파일이 없으면 빈 상태로 시작(다음 요청에서 다시 시도)
  const seed = JSON.parse(fs.readFileSync(file, "utf8")) as {
    lots: (string | number | number[])[][];
    blister: (string | number | number[])[][];
    photos: { c: string; s: string; i: [number, string, string][] }[];
    /** 대시보드 이후에 들어온 로트(번호 1370~) — 고객사·디자인 구분·입고 구분과 "화면에서 추가" 여부를 함께 가진다 */
    extra?: { row: (string | number | number[])[]; customer: string; design: string; recv_type: string; is_added: number }[];
  };
  const s = (v: unknown) => (v == null ? "" : String(v));
  const n = (v: unknown) => {
    const x = Math.round(Number(v));
    return Number.isFinite(x) && x > 0 ? x : 0;
  };
  db.exec("BEGIN");
  try {
    const insLot = db.prepare(
      `INSERT OR IGNORE INTO qc_supply_lots
         (no, month, part, recv_date, insp_date, lot_no, mat_code, name, supplier, lot_qty, insp_qty, bad_qty, inspector, result, remark,
          defs, item_code, phys_status, cert_status, is_added, orig)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '검사완료', '작성완료', 0, ?)`
    );
    for (const r of seed.lots) {
      const defs = Array.isArray(r[15]) && (r[15] as number[]).some((x) => x > 0) ? JSON.stringify(r[15]) : null;
      const orig = JSON.stringify(r);
      insLot.run(
        n(r[0]), n(r[1]), s(r[2]), s(r[3]), s(r[4]), s(r[5]), s(r[6]), s(r[7]), s(r[8]), n(r[9]), n(r[10]), n(r[11]), s(r[12]), s(r[13]), s(r[14]),
        defs, s(r[16]), orig
      );
    }
    const insExtra = db.prepare(
      `INSERT OR IGNORE INTO qc_supply_lots
         (no, month, part, recv_date, insp_date, lot_no, mat_code, name, supplier, lot_qty, insp_qty, bad_qty, inspector, result, remark,
          defs, item_code, customer, design, recv_type, phys_status, cert_status, is_added, orig)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, '검사완료', '작성완료', ?, ?)`
    );
    for (const e of seed.extra ?? []) {
      const r = e.row;
      insExtra.run(
        n(r[0]), n(r[1]), s(r[2]), s(r[3]), s(r[4]), s(r[5]), s(r[6]), s(r[7]), s(r[8]), n(r[9]), n(r[10]), n(r[11]), s(r[12]), s(r[13]), s(r[14]),
        s(r[16]), e.customer, e.design, e.recv_type, e.is_added, e.is_added ? null : JSON.stringify(r)
      );
    }
    const insBl = db.prepare(
      `INSERT INTO qc_blister_lots
         (no, month, item, week, supplier, mold, prod_date, recv_date, insp_date, lot_no, recv_qty, insp_qty, bad_qty, defs, status, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const r of seed.blister) {
      insBl.run(
        n(r[0]), n(r[1]), s(r[2]), s(r[3]), s(r[4]), s(r[5]), s(r[6]), s(r[7]), s(r[8]), s(r[9]), n(r[10]), n(r[11]), n(r[12]),
        JSON.stringify(Array.isArray(r[13]) ? r[13] : []), s(r[14]), s(r[15])
      );
    }
    const insPh = db.prepare(
      "INSERT INTO qc_supply_photos (lot_no, source, caption, note, ts, mime, data) VALUES (?, 'excel', ?, '', '', ?, ?)"
    );
    for (const p of seed.photos) {
      const m = /^data:([\w/+.-]+);base64,([\s\S]*)$/.exec(p.s);
      if (!m) continue;
      const buf = Buffer.from(m[2], "base64");
      const nos = Array.from(new Set(p.i.map((x) => Math.round(Number(x[0])))));
      const cap = p.c + p.i.map((x) => ` · No.${x[0]} 입고 ${x[1]}`).join("");
      for (const no of nos) insPh.run(no, cap, m[1], buf);
    }
    db.prepare("INSERT OR REPLACE INTO qc_incoming_meta (key, value) VALUES ('seeded', datetime('now','localtime'))").run();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// ── 행 변환 ─────────────────────────────────────────────────────────────────────────────
interface LotRow {
  no: number;
  month: number;
  part: string;
  recv_date: string;
  insp_date: string;
  lot_no: string;
  mat_code: string;
  name: string;
  supplier: string;
  lot_qty: number;
  insp_qty: number;
  bad_qty: number;
  inspector: string;
  result: string;
  remark: string;
  defs: string | null;
  item_code: string;
  customer: string;
  design: string;
  recv_type: string;
  phys_status: string;
  cert_status: string;
  is_added: number;
  orig: string | null;
  photo_count: number;
}

function parseDefs(s: string | null, len: number): number[] | null {
  if (!s) return null;
  try {
    const a = JSON.parse(s);
    if (Array.isArray(a)) {
      const out = a.slice(0, len).map((x) => Math.max(0, Math.round(Number(x)) || 0));
      while (out.length < len) out.push(0);
      return out;
    }
  } catch {
    /* 깨진 JSON은 없는 것으로 */
  }
  return null;
}

function toLot(r: LotRow, itemFallback: string): SupplyLot {
  return {
    no: r.no,
    month: r.month,
    part: r.part,
    recv_date: r.recv_date,
    insp_date: r.insp_date,
    lot_no: r.lot_no,
    mat_code: r.mat_code,
    name: r.name,
    supplier: r.supplier,
    lot_qty: r.lot_qty,
    insp_qty: r.insp_qty,
    bad_qty: r.bad_qty,
    inspector: r.inspector,
    result: r.result,
    remark: r.remark,
    defs: parseDefs(r.defs, 13),
    item_code: r.item_code || itemFallback,
    customer: r.customer,
    design: r.design,
    recv_type: r.recv_type,
    phys_status: r.phys_status,
    cert_status: r.cert_status,
    is_added: r.is_added,
    has_orig: !!r.orig && !r.is_added,
    photo_count: r.photo_count,
  };
}

const LOT_SELECT = `SELECT l.no, l.month, l.part, l.recv_date, l.insp_date, l.lot_no, l.mat_code, l.name, l.supplier, l.lot_qty, l.insp_qty, l.bad_qty,
       l.inspector, l.result, l.remark, l.defs, l.item_code, l.customer, l.design, l.recv_type, l.phys_status, l.cert_status, l.is_added, l.orig,
       (SELECT COUNT(*) FROM qc_supply_photos p WHERE p.lot_no = l.no) AS photo_count
  FROM qc_supply_lots l`;

/** 자재코드 끝 영문 한 글자(버전)를 뗀 기본 코드 — 같은 기본 코드의 다른 버전이 가진 품목코드로 빈 품목코드를 채운다(대시보드 fillSib) */
function versionBase(code: string): string {
  const m = /^([A-Z0-9]*[0-9])[A-Z]$/.exec(String(code || "").trim().toUpperCase());
  return m ? m[1] : "";
}

/** 품목코드가 비어 있는 로트의 품목코드 추정 — MES BOM(자재코드를 쓰는 품목) → 같은 기본 코드 형제 로트 순서 */
function itemFallbacks(db: DatabaseSync, rows: LotRow[]): Map<string, string> {
  const out = new Map<string, string>(); // 자재코드 → 품목코드
  const bomOf = db.prepare("SELECT MIN(parent_item_code) AS p FROM bom WHERE child_item_code = ?");
  const sib = new Map<string, Set<string>>();
  for (const r of rows) {
    let it = r.item_code;
    if (!it && r.mat_code) {
      if (!out.has(r.mat_code)) {
        const b = bomOf.get(r.mat_code) as { p: string | null } | undefined;
        out.set(r.mat_code, b?.p ?? "");
      }
      it = out.get(r.mat_code) ?? "";
    }
    const vb = versionBase(r.mat_code);
    if (vb && it) (sib.get(vb) ?? sib.set(vb, new Set()).get(vb)!).add(it);
  }
  for (const r of rows) {
    if (r.item_code || out.get(r.mat_code)) continue;
    const vb = versionBase(r.mat_code);
    const set = vb ? sib.get(vb) : undefined;
    if (set && set.size === 1) out.set(r.mat_code, [...set][0]);
  }
  return out;
}

export function listSupplyLots(db: DatabaseSync): SupplyLot[] {
  ensureQcIncomingTables(db);
  const rows = db.prepare(`${LOT_SELECT} ORDER BY l.no DESC`).all() as unknown as LotRow[];
  const fb = itemFallbacks(db, rows);
  return rows.map((r) => toLot(r, fb.get(r.mat_code) ?? ""));
}

export function getSupplyLot(db: DatabaseSync, no: number): SupplyLot | null {
  ensureQcIncomingTables(db);
  const r = db.prepare(`${LOT_SELECT} WHERE l.no = ?`).get(no) as unknown as LotRow | undefined;
  if (!r) return null;
  const fb = itemFallbacks(db, [r]);
  return toLot(r, fb.get(r.mat_code) ?? "");
}

// ── 입력 정리(대시보드 cleanRow/cleanAd와 같은 규칙) ───────────────────────────────────────
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (x: unknown, max: number) => (x == null ? "" : String(x).trim().slice(0, max));
const dateStr = (x: unknown) => (typeof x === "string" && DATE_RE.test(x) ? x : "");
const qty = (x: unknown) => {
  const v = Math.round(Number(x));
  return Number.isFinite(v) && v > 0 ? v : 0;
};

export interface LotInput {
  part: string;
  recv_date: string;
  insp_date: string;
  lot_no: string;
  mat_code: string;
  name: string;
  supplier: string;
  lot_qty: number;
  insp_qty: number;
  bad_qty: number;
  inspector: string;
  result: string;
  remark: string;
  defs: number[] | null;
  item_code: string;
  customer: string;
  design: string;
  recv_type: string;
}

export function cleanLotInput(b: Record<string, unknown>): LotInput {
  const defsRaw = Array.isArray(b.defs) ? (b.defs as unknown[]) : null;
  const defs = defsRaw ? Array.from({ length: 13 }, (_, i) => qty(defsRaw[i])) : null;
  return {
    part: (SUPPLY_PARTS as readonly string[]).includes(String(b.part)) ? String(b.part) : "기타",
    recv_date: dateStr(b.recv_date),
    insp_date: dateStr(b.insp_date),
    lot_no: str(b.lot_no, 40),
    mat_code: str(b.mat_code, 40).toUpperCase(),
    name: str(b.name, 120),
    supplier: str(b.supplier, 40),
    lot_qty: qty(b.lot_qty),
    insp_qty: qty(b.insp_qty),
    bad_qty: qty(b.bad_qty),
    inspector: str(b.inspector, 20),
    result: (RESULT_OPTIONS as readonly string[]).includes(String(b.result)) ? String(b.result) : "",
    remark: str(b.remark, 200),
    defs,
    item_code: str(b.item_code, 40),
    customer: str(b.customer, 40),
    design: (DESIGN_OPTIONS as readonly string[]).includes(String(b.design)) ? String(b.design) : "",
    recv_type: (RECV_TYPE_OPTIONS as readonly string[]).includes(String(b.recv_type)) ? String(b.recv_type) : "",
  };
}

export function monthOf(recvDate: string, fallback = 0): number {
  return recvDate ? Number(recvDate.slice(5, 7)) : fallback;
}

export function insertSupplyLot(db: DatabaseSync, input: LotInput, user: string | null): SupplyLot {
  ensureQcIncomingTables(db);
  const mx = (db.prepare("SELECT MAX(no) AS m FROM qc_supply_lots").get() as { m: number | null }).m ?? 0;
  const no = mx + 1;
  db.prepare(
    `INSERT INTO qc_supply_lots
       (no, month, part, recv_date, insp_date, lot_no, mat_code, name, supplier, lot_qty, insp_qty, bad_qty, inspector, result, remark,
        defs, item_code, customer, design, recv_type, phys_status, cert_status, is_added, orig, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '미검사', '미작성', 1, NULL, ?)`
  ).run(
    no, monthOf(input.recv_date), input.part, input.recv_date, input.insp_date, input.lot_no, input.mat_code, input.name, input.supplier,
    input.lot_qty, input.insp_qty, input.bad_qty, input.inspector, input.result, input.remark,
    input.defs && input.defs.some((x) => x > 0) ? JSON.stringify(input.defs) : null, input.item_code, input.customer, input.design, input.recv_type, user
  );
  return getSupplyLot(db, no)!;
}

/** 로트 전체 수정(수정 창 저장) */
export function updateSupplyLot(db: DatabaseSync, no: number, input: LotInput, user: string | null): SupplyLot | null {
  ensureQcIncomingTables(db);
  const cur = db.prepare("SELECT month, defs FROM qc_supply_lots WHERE no = ?").get(no) as { month: number; defs: string | null } | undefined;
  if (!cur) return null;
  // 불량유형 수량이 하나라도 있거나 원래 값이 있던 로트는 13칸을 그대로 저장, 아니면 비움(대시보드와 같은 규칙)
  const defsToStore = input.defs && (input.defs.some((x) => x > 0) || cur.defs) ? JSON.stringify(input.defs) : null;
  db.prepare(
    `UPDATE qc_supply_lots SET part=?, recv_date=?, insp_date=?, lot_no=?, mat_code=?, name=?, supplier=?, lot_qty=?, insp_qty=?, bad_qty=?, inspector=?,
       result=?, remark=?, defs=?, item_code=?, customer=?, design=?, recv_type=?, updated_at=datetime('now','localtime'), updated_by=? WHERE no=?`
  ).run(
    input.part, input.recv_date, input.insp_date, input.lot_no, input.mat_code, input.name, input.supplier, input.lot_qty, input.insp_qty, input.bad_qty,
    input.inspector, input.result, input.remark, defsToStore,
    input.item_code, input.customer, input.design, input.recv_type, user, no
  );
  return getSupplyLot(db, no);
}

/** 엑셀 원본 값으로 되돌린다(엑셀에서 들어온 로트만). 고객사·디자인 구분·입고 구분은 비운다 */
export function resetSupplyLot(db: DatabaseSync, no: number, user: string | null): SupplyLot | null {
  ensureQcIncomingTables(db);
  const r = db.prepare("SELECT orig FROM qc_supply_lots WHERE no = ? AND is_added = 0").get(no) as { orig: string | null } | undefined;
  if (!r?.orig) return null;
  const o = JSON.parse(r.orig) as (string | number | number[])[];
  const defs = Array.isArray(o[15]) && (o[15] as number[]).some((x) => x > 0) ? JSON.stringify(o[15]) : null;
  db.prepare(
    `UPDATE qc_supply_lots SET month=?, part=?, recv_date=?, insp_date=?, lot_no=?, mat_code=?, name=?, supplier=?, lot_qty=?, insp_qty=?, bad_qty=?, inspector=?,
       result=?, remark=?, defs=?, item_code=?, customer='', design='', recv_type='', updated_at=datetime('now','localtime'), updated_by=? WHERE no=?`
  ).run(
    qty(o[1]), str(o[2], 20), str(o[3], 10), str(o[4], 10), str(o[5], 40), str(o[6], 40), str(o[7], 120), str(o[8], 40), qty(o[9]), qty(o[10]), qty(o[11]),
    str(o[12], 20), str(o[13], 10), str(o[14], 200), defs, str(o[16], 40), user, no
  );
  return getSupplyLot(db, no);
}

export function deleteAddedLot(db: DatabaseSync, no: number): boolean {
  ensureQcIncomingTables(db);
  db.exec("BEGIN");
  try {
    const r = db.prepare("DELETE FROM qc_supply_lots WHERE no = ? AND is_added = 1").run(no);
    if (Number(r.changes) > 0) db.prepare("DELETE FROM qc_supply_photos WHERE lot_no = ?").run(no);
    db.exec("COMMIT");
    return Number(r.changes) > 0;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// ── 사진 ────────────────────────────────────────────────────────────────────────────────
export function listPhotos(db: DatabaseSync, lotNo: number): QcPhotoMeta[] {
  ensureQcIncomingTables(db);
  return db
    .prepare("SELECT id, lot_no, source, caption, note, ts FROM qc_supply_photos WHERE lot_no = ? ORDER BY (source = 'upload') DESC, ts DESC, id DESC")
    .all(lotNo) as unknown as QcPhotoMeta[];
}

// ── 블리스터 ────────────────────────────────────────────────────────────────────────────
export function listBlisterLots(db: DatabaseSync): BlisterLot[] {
  ensureQcIncomingTables(db);
  const rows = db.prepare("SELECT no, month, item, week, supplier, mold, prod_date, recv_date, insp_date, lot_no, recv_qty, insp_qty, bad_qty, defs, status, remark FROM qc_blister_lots ORDER BY id").all() as unknown as (Omit<BlisterLot, "defs"> & { defs: string | null })[];
  return rows.map((r) => ({ ...r, defs: parseDefs(r.defs, 6) ?? [0, 0, 0, 0, 0, 0] }));
}

// ── 부적합 처리 기록 ─────────────────────────────────────────────────────────────────────
export function listNcr(db: DatabaseSync): NcrRecord[] {
  ensureQcIncomingTables(db);
  return db.prepare("SELECT k, manual, date, kind, lot, code, item, name, sup, insp, bad, defs, disp, st, adate, who, cause, act FROM qc_ncr").all() as unknown as NcrRecord[];
}

export interface NcrInput {
  disp: string;
  st: string;
  adate: string;
  who: string;
  cause: string;
  act: string;
}

export function cleanNcrInput(b: Record<string, unknown>): NcrInput {
  return {
    disp: str(b.disp, 10),
    st: (NCR_STATUS as readonly string[]).includes(String(b.st)) ? String(b.st) : "미처리",
    adate: dateStr(b.adate),
    who: str(b.who, 30),
    cause: str(b.cause, 200),
    act: str(b.act, 300),
  };
}

/** 처리 기록이 비어 있고 직접 추가한 로트도 아니면 기록 자체를 지운다(대시보드와 같은 규칙) */
export function isEmptyNcr(m: number, v: NcrInput): boolean {
  return !m && !v.disp && v.st === "미처리" && !v.adate && !v.who && !v.cause && !v.act;
}

export function saveNcr(db: DatabaseSync, k: string, v: NcrInput, user: string | null): void {
  ensureQcIncomingTables(db);
  const cur = db.prepare("SELECT manual FROM qc_ncr WHERE k = ?").get(k) as { manual: number } | undefined;
  const manual = cur?.manual ?? 0;
  if (isEmptyNcr(manual, v)) {
    db.prepare("DELETE FROM qc_ncr WHERE k = ?").run(k);
    return;
  }
  db.prepare(
    `INSERT INTO qc_ncr (k, manual, disp, st, adate, who, cause, act, updated_at, updated_by)
     VALUES (?, 0, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), ?)
     ON CONFLICT(k) DO UPDATE SET disp=excluded.disp, st=excluded.st, adate=excluded.adate, who=excluded.who, cause=excluded.cause, act=excluded.act,
       updated_at=excluded.updated_at, updated_by=excluded.updated_by`
  ).run(k, v.disp, v.st, v.adate, v.who, v.cause, v.act, user);
}

export function insertManualNcr(db: DatabaseSync, b: Record<string, unknown>, user: string | null): string {
  ensureQcIncomingTables(db);
  const k = "M" + Date.now();
  db.prepare(
    `INSERT INTO qc_ncr (k, manual, date, kind, lot, code, item, name, sup, insp, bad, defs, st, updated_by)
     VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '미처리', ?)`
  ).run(k, dateStr(b.date), str(b.kind, 20), str(b.lot, 40), str(b.code, 40), str(b.item, 40), str(b.name, 100), str(b.sup, 40), qty(b.insp), qty(b.bad), str(b.defs, 100), user);
  return k;
}
