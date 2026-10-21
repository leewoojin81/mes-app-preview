import * as XLSX from "xlsx";

export const n = (x: number | null | undefined): string => (x == null ? "0" : Number(x).toLocaleString("ko-KR"));

/** 부적합률 표시 — 검사수량이 없으면 0.00% */
export const pct = (bad: number, insp: number): string => (insp ? ((bad / insp) * 100).toFixed(2) + "%" : "0.00%");

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 시트 목록을 엑셀(.xlsx)로 내려받는다. 첫 줄은 머리글(굵게는 못 주지만 고정), 열 너비는 내용 길이로 맞춘다 */
export function downloadXlsx(baseName: string, sheets: [string, (string | number | null)[][]][]): void {
  const wb = XLSX.utils.book_new();
  sheets.forEach(([name, rows], k) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const widths: number[] = [];
    rows.forEach((r) =>
      r.forEach((v, j) => {
        const len = v == null ? 0 : String(v).length * (/[^\x00-\x7f]/.test(String(v)) ? 2 : 1);
        widths[j] = Math.min(50, Math.max(widths[j] ?? 8, len + 2));
      })
    );
    ws["!cols"] = widths.map((w) => ({ wch: w }));
    ws["!freeze"] = { xSplit: 0, ySplit: 1 } as unknown as XLSX.WorkSheet["!freeze"];
    XLSX.utils.book_append_sheet(wb, ws, (name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || `Sheet${k + 1}`));
  });
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  XLSX.writeFile(wb, `${baseName}_${stamp}.xlsx`);
}

/** 사진 파일을 긴 변 1600px JPEG로 줄여 data URL로 돌려준다(대시보드 shrink와 같은 설정) */
export function shrinkImage(file: File, maxSide = 1600, quality = 0.82): Promise<{ dataUrl: string; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const draw = (src: CanvasImageSource, w: number, h: number) => {
      const s = Math.min(1, maxSide / Math.max(w, h));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(w * s));
      c.height = Math.max(1, Math.round(h * s));
      c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
      resolve({ dataUrl: c.toDataURL("image/jpeg", quality), w: c.width, h: c.height });
    };
    const fallback = () => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => {
        draw(im, im.naturalWidth, im.naturalHeight);
        URL.revokeObjectURL(url);
      };
      im.onerror = () => reject(new Error("읽을 수 없는 사진"));
      im.src = url;
    };
    if (typeof createImageBitmap === "function") {
      createImageBitmap(file, { imageOrientation: "from-image" }).then((bm) => draw(bm, bm.width, bm.height), fallback);
    } else fallback();
  });
}
