import ExcelJS from "exceljs";
import { expiryOf, type PackingList } from "@/lib/packing-list";

// Packing List(SALES-04) 엑셀 — 공유폴더 "05 패킹리스트" 2026.10 파일 두 가지 모양을 따랐다(고객사 양식은 추후 추가).
//  std: 표준 DPL — "DPL_(Uria M-2608-239)_MO260902-02" 모양. 모델마다 시트, 한 줄 = 소박스
//       (Carton Box · Small Box · Model · Power · Q'ty(pack) · 제조일 · 유효기간 · LOT · NW · GW, 중량은 카톤 첫 줄)
//  cn : 중국 라벨형 — "DPL+Shipping_MO260901-04 CLB_소흑군" 모양. 모델마다 시트, 카톤 1개 = 블록 1개
//       (제목 · Label # · Ctn No. · Total(Ctn) · Small Box · 有效期 · 国际条形码 · 生产批号 · Power · Sub Total),
//       블록은 가로 2개씩, 오른쪽에 제조일자·차수·LOT·모델명·Label #·유효기간·팩수·도수별 JAN 표

const THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};
const HEAD_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };

/** 엑셀 날짜 셀 값(로컬 자정) */
const dateCell = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : iso || null;
};

function sheetName(wb: ExcelJS.Workbook, base: string): string {
  const clean = base.replace(/[\\/?*[\]:]/g, " ").slice(0, 28) || "Sheet";
  let name = clean;
  for (let i = 2; wb.getWorksheet(name); i++) name = `${clean} (${i})`;
  return name;
}

function buildStd(wb: ExcelJS.Workbook, pl: PackingList) {
  for (const m of pl.models) {
    const boxes = pl.boxes.filter((b) => b.model === m.model);
    if (!boxes.length) continue;
    const ws = wb.addWorksheet(sheetName(wb, `${m.title || m.model} (${m.model.slice(0, 5)})`));
    ws.columns = [10, 10, 12, 10, 11, 15, 15, 16, 14, 14].map((width) => ({ width }));
    ws.getCell("A1").value = "관리번호 :";
    ws.getCell("B1").value = pl.mo_no ?? "";
    ws.getCell("E1").value = "MES수주번호 :";
    ws.getCell("F1").value = pl.so_no;
    ws.getCell("H1").value = pl.pl_no + (pl.revision ? ` Rev.${pl.revision}` : "");
    ws.getCell("A2").value = "Detailed packing list";
    ws.getCell("A2").font = { bold: true, size: 14 };
    ws.getCell("E2").value = `Model: ${m.title}`;
    ws.getCell("J2").value = pl.remark;
    ws.getCell("D3").value = "PO No. :";
    ws.getCell("F3").value = pl.customer_po;
    ws.getCell("H3").value = pl.customer ?? "";
    const head = ["Carton Box", "Small Box", "Model", "Power", "Q'ty(pack)", "Date of Manfacture", "Date of Expiry", "Lot Number", "Net weight (kg)", "Gross Weight (kg)"];
    const hr = ws.getRow(4);
    head.forEach((h, i) => {
      const c = hr.getCell(i + 1);
      c.value = h;
      c.font = { bold: true };
      c.fill = HEAD_FILL;
      c.border = THIN;
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    });
    hr.height = 30;
    const exp = expiryOf(pl.mfg_date, m.shelf_years);
    let r = 5;
    let prevCtn = -1;
    for (const b of boxes) {
      const first = b.ctn_no !== prevCtn;
      prevCtn = b.ctn_no;
      const w = pl.cartons.find((c) => c.ctn_no === b.ctn_no);
      const row = ws.getRow(r++);
      row.values = [
        first ? b.ctn_no : null,
        b.small_no,
        m.model.slice(0, 5),
        b.power,
        b.qty,
        dateCell(pl.mfg_date),
        dateCell(exp),
        b.lot_no,
        first ? (w?.net_kg ?? null) : null,
        first ? (w?.gross_kg ?? null) : null,
      ];
      row.eachCell({ includeEmpty: true }, (c, col) => {
        if (col > 10) return;
        c.border = THIN;
        c.alignment = { horizontal: "center" };
      });
      row.getCell(4).numFmt = "0.00";
      row.getCell(6).numFmt = "yyyy.mm.dd";
      row.getCell(7).numFmt = "yyyy.mm.dd";
    }
    const tr = ws.getRow(r);
    tr.getCell(1).value = "Total";
    tr.getCell(5).value = boxes.reduce((s, b) => s + b.qty, 0);
    const ctns = [...new Set(boxes.map((b) => b.ctn_no))];
    const sumKg = (k: "net_kg" | "gross_kg") => pl.cartons.filter((c) => ctns.includes(c.ctn_no)).reduce((s, c) => s + (c[k] ?? 0), 0);
    tr.getCell(9).value = sumKg("net_kg") || null;
    tr.getCell(10).value = sumKg("gross_kg") || null;
    tr.eachCell({ includeEmpty: true }, (c, col) => {
      if (col > 10) return;
      c.border = THIN;
      c.font = { bold: true };
      c.alignment = { horizontal: "center" };
    });
    ws.getCell(`B${r}`).value = `${ctns.length} ctn`;
    ws.views = [{ state: "frozen", ySplit: 4 }];
  }
}

function buildCn(wb: ExcelJS.Workbook, pl: PackingList) {
  const totalCtn = new Set(pl.boxes.map((b) => b.ctn_no)).size;
  const HEAD = ["Ctn No. ", "Total (Ctn)", "Small Box", "有效期", "国际条形码", "生产批号", "Power", "Sub Total"];
  for (const m of pl.models) {
    const boxes = pl.boxes.filter((b) => b.model === m.model);
    if (!boxes.length) continue;
    const ws = wb.addWorksheet(sheetName(wb, m.model.slice(0, 5)));
    // A~H 블록1, I 빈칸, J~Q 블록2, R 빈칸, S~T 정보
    ws.columns = [7, 9, 8, 11, 15, 13, 7, 9, 2, 7, 9, 8, 11, 15, 13, 7, 9, 3, 10, 16].map((width) => ({ width }));
    const exp = expiryOf(pl.mfg_date, m.shelf_years);
    const ctns = [...new Set(boxes.map((b) => b.ctn_no))];
    const rowsPerBlock = 3 + Math.max(...ctns.map((c) => boxes.filter((b) => b.ctn_no === c).length)) + 2;
    ctns.forEach((ctn, i) => {
      const top = 1 + Math.floor(i / 2) * rowsPerBlock;
      const left = i % 2 === 0 ? 1 : 10;
      const cell = (r: number, c: number) => ws.getCell(top + r, left + c);
      cell(0, 0).value = m.title;
      cell(0, 0).font = { bold: true };
      cell(1, 0).value = "Label #";
      cell(1, 3).value = m.label_name;
      HEAD.forEach((h, k) => {
        const c = cell(2, k);
        c.value = h;
        c.font = { bold: true };
        c.fill = HEAD_FILL;
        c.border = THIN;
        c.alignment = { horizontal: "center" };
      });
      const list = boxes.filter((b) => b.ctn_no === ctn);
      list.forEach((b, k) => {
        const vals: ExcelJS.CellValue[] = [k === 0 ? ctn : null, k === 0 ? totalCtn : null, b.small_no, dateCell(exp), pl.jan[b.item_code] ?? "", b.lot_no, b.power, b.qty];
        vals.forEach((v, c) => {
          const x = cell(3 + k, c);
          x.value = v;
          x.border = THIN;
          x.alignment = { horizontal: "center" };
        });
        cell(3 + k, 3).numFmt = "yyyy.mm.dd";
        cell(3 + k, 6).numFmt = "0.00";
      });
      const tr = 3 + list.length;
      for (let c = 0; c < 8; c++) {
        cell(tr, c).border = THIN;
        cell(tr, c).font = { bold: true };
      }
      cell(tr, 2).value = "Total";
      cell(tr, 7).value = list.reduce((s, b) => s + b.qty, 0);
    });
    // 오른쪽 정보 — 라벨 출력 때 보던 칸
    const info: [string, ExcelJS.CellValue][] = [
      [m.title, null],
      ["제조일자", dateCell(pl.mfg_date)],
      ["차수", pl.lot_prefix],
      ["LOT", pl.lot_prefix],
      ["모델명", m.model.slice(0, 5)],
      ["Label #", m.label_name],
      ["유효기간", m.shelf_years],
      ["팩수", m.per_small],
      ["MES", `${pl.pl_no}${pl.revision ? ` Rev.${pl.revision}` : ""}`],
    ];
    info.forEach(([k, v], i) => {
      ws.getCell(1 + i, 19).value = k;
      ws.getCell(1 + i, 20).value = v;
      if (k === "제조일자") ws.getCell(1 + i, 20).numFmt = "yyyy.mm.dd";
    });
    const pr = info.length + 2;
    ws.getCell(pr, 19).value = "Power";
    ws.getCell(pr, 20).value = "JAN CODE";
    ws.getCell(pr, 19).font = ws.getCell(pr, 20).font = { bold: true };
    const seen = new Set<string>();
    let r = pr + 1;
    for (const b of boxes) {
      if (seen.has(b.item_code)) continue;
      seen.add(b.item_code);
      ws.getCell(r, 19).value = b.power;
      ws.getCell(r, 19).numFmt = "0.00";
      ws.getCell(r, 20).value = pl.jan[b.item_code] ?? "";
      r++;
    }
  }
}

export async function packingListExcel(pl: PackingList): Promise<{ buffer: ArrayBuffer; filename: string }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MES";
  if (pl.form === "cn") buildCn(wb, pl);
  else buildStd(wb, pl);
  if (!wb.worksheets.length) wb.addWorksheet("Sheet1");
  const packs = pl.boxes.reduce((s, b) => s + b.qty, 0);
  const base = `DPL_${pl.mo_no ?? pl.so_no}_${pl.customer ?? ""}_${pl.brand ?? ""}_${packs.toLocaleString("en-US")}packs${pl.revision ? `_Rev${pl.revision}` : ""}`;
  return { buffer: (await wb.xlsx.writeBuffer()) as ArrayBuffer, filename: `${base.replace(/[\\/:*?"<>|]/g, " ").trim()}.xlsx` };
}
