// 품질관리 "수입검사(QC-03)" — 서버/화면이 같이 쓰는 상수와 타입.
// 2026-10-21 사용자 요청으로 입고검사 대시보드(입고검사대시보드_보기용_20261021.html)의 "부자재관리대장"과
// "부적합관리대장"을 MES 화면(QC-03의 부자재·부적합 탭)으로 옮겼다. 값/규칙은 대시보드와 같다.

/** 부자재 불량유형 13종 — 로트 한 줄의 defs 배열 순서(대시보드 DEFN과 같음) */
export const SUPPLY_DEFECT_NAMES = [
  "이물 및 유색점",
  "색상",
  "기타",
  "접지 틀어짐",
  "측면 떨어짐(탈리)",
  "눌림자국/찍힘",
  "스크레치",
  "측면터짐",
  "박·형압 틀어짐",
  "인쇄 틀어짐",
  "박 뜯김",
  "톰슨(접힘틀어짐)",
  "기재사항",
] as const;

/** 블리스터 불량유형 6종 */
export const BLISTER_DEFECT_NAMES = ["휨", "Burr", "미성형", "이물(얼룩)", "S/C", "기포"] as const;

export const SUPPLY_PARTS = ["실링지", "단상자", "라벨", "설명서", "기타"] as const;
export const DESIGN_OPTIONS = ["신규", "변경", "재발주"] as const;
export const RECV_TYPE_OPTIONS = ["발주품(국내)", "발주품(해외)", "사급품(국내)", "사급품(해외)", "샘플"] as const;
export const PHYS_STATUS = ["미검사", "검사완료"] as const;
export const CERT_STATUS = ["미작성", "작성완료"] as const;
export const RESULT_OPTIONS = ["적합", "부적합"] as const;
export const NCR_STATUS = ["미처리", "진행중", "완료"] as const;
export const NCR_DISPOSITIONS = ["반품", "특채", "폐기", "재작업", "선별", "교환", "기타"] as const;
export const NCR_MANUAL_KINDS = ["단상자", "실링지", "라벨", "설명서", "블리스터", "기타"] as const;

/** 부자재 로트 한 줄 (화면 표시용 — DB의 qc_supply_lots와 1:1) */
export interface SupplyLot {
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
  /** 불량유형별 수량 13칸(없으면 null) */
  defs: number[] | null;
  item_code: string;
  customer: string;
  design: string;
  recv_type: string;
  phys_status: string;
  cert_status: string;
  is_added: number;
  /** 엑셀 원본으로 되돌릴 수 있는 로트인가(엑셀에서 들어온 로트이고 수정된 적이 있음) */
  has_orig: boolean;
  /** 사진 장수(엑셀 사진 + 올린 사진) */
  photo_count: number;
}

/** 블리스터 로트(부적합 대장의 입력원 — 이 화면에서는 읽기 전용) */
export interface BlisterLot {
  no: number;
  month: number;
  item: string;
  week: string;
  supplier: string;
  mold: string;
  prod_date: string;
  recv_date: string;
  insp_date: string;
  lot_no: string;
  recv_qty: number;
  insp_qty: number;
  bad_qty: number;
  defs: number[];
  status: string;
  remark: string;
}

/** 부적합 처리 기록(qc_ncr) — 키(k)는 대시보드와 같다: 부자재 "L{번호}", 블리스터 "B{번호}_{Lot}", 직접 추가 "M{시각}" */
export interface NcrRecord {
  k: string;
  /** 1이면 "직접 추가"한 부적합 로트(원본 정보도 이 기록에 들어 있음) */
  manual: number;
  date: string;
  kind: string;
  lot: string;
  code: string;
  item: string;
  name: string;
  sup: string;
  insp: number;
  bad: number;
  defs: string;
  disp: string;
  st: string;
  adate: string;
  who: string;
  cause: string;
  act: string;
}

export interface QcPhotoMeta {
  id: number;
  lot_no: number;
  source: "excel" | "upload";
  caption: string;
  note: string;
  ts: string;
}
