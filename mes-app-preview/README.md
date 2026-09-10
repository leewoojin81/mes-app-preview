# 메디오스 MES

메디오스(콘택트렌즈 제조)가 자체 개발 중인 MES(제조실행시스템) 프로토타입입니다. 1단계 목표는 기준정보(품목·BOM·공정·설비·거래처·창고)와 생산관리(작업지시·실적입력) 핵심 흐름을 실제 원본 엑셀 데이터 기준으로 구현하는 것입니다.

## 기술 스택

- **프레임워크**: Next.js 16 (App Router) + React 19 + TypeScript
- **스타일**: Tailwind CSS 4
- **DB**: SQLite — Node.js 내장 `node:sqlite` 모듈(`DatabaseSync`) 사용, 별도 ORM/드라이버 없음
- **데이터 임포트**: `xlsx` 패키지로 원본 엑셀(품목등록, BOM, 공정코드등록, 설비등록 등)을 SQLite로 적재

## 실행 방법

```bash
npm install
npm run dev
```

[http://localhost:3000](http://localhost:3000) 에서 확인합니다.

DB 파일(`data/mes.db`)은 저장소에 포함되지 않습니다(`.gitignore`). 최초 실행 시 `src/lib/db.ts`가 스키마를 자동 생성하며, 실제 데이터는 `scripts/import-*.js` 스크립트로 원본 엑셀(`../BOM.xlsx`, 품목·공정·설비·거래처·창고 등록 엑셀)을 읽어 적재합니다.

```bash
node scripts/import-items.js
node scripts/import-bom.js
node scripts/import-processes.js
node scripts/import-equipments.js
node scripts/import-customers.js
node scripts/import-warehouses.js
```

## 구현된 화면

### 기준정보 (BASE)
| 코드 | 화면 | 설명 |
| --- | --- | --- |
| BASE-01 | 제품등록 | 완제품/반제품 품목 마스터 |
| BASE-02 | 자재등록 | 원자재/부자재 품목 마스터 |
| BASE-03 | BOM관리 | 완제품코드로 다단계 BOM 트리(완제품→반제품→원자재) 조회, 단계별 접기/펼치기 |
| BASE-04 | 공정등록 | 공정코드 마스터 |
| BASE-05 | 설비등록 | 설비 마스터 |
| BASE-06 | 거래처등록 | 매입/외주/매출 거래처 마스터 |
| BASE-07 | 창고등록 | 창고 마스터 |
| BASE-08 | 생산캘린더 | 날짜별 근무구분(평일/휴일/특근)·근무여부 관리, 월별 달력 UI, 토/일요일·공휴일 일괄 등록 |

### 생산관리 (PROD)
| 코드 | 화면 | 설명 |
| --- | --- | --- |
| PROD-01 | 작업지시발행 | 작업지시(WO) 생성·발행 |
| PROD-02 | POP 실적입력 | 생산 실적·불량·자재투입 현장 입력 |

### 재고관리 (INV)
| 코드 | 화면 | 설명 |
| --- | --- | --- |
| INV-01 | 실시간 재고 | 품목·로트별 재고 현황 |

### 경영정보 (MGMT)
| 코드 | 화면 | 설명 |
| --- | --- | --- |
| MGMT-01 | 실시간 대시보드 | 생산 현황 요약 |

### 준비 중
영업관리, 생산계획, 품질관리, 구매관리는 메뉴만 있고 화면은 아직 없습니다.
