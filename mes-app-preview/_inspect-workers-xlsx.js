const XLSX = require("xlsx");
const path = "C:\\Users\\Administrator\\Desktop\\mes-system\\작업자등록.xlsx";
const wb = XLSX.readFile(path);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
const header = rows[1];
console.log("HEADER:", JSON.stringify(header));
const data = rows.slice(3).filter((r) => r.some((c) => c != null));
console.log("DATA ROWS:", data.length);

function col(name) {
  return header.indexOf(name);
}

const distinct = (name) => {
  const i = col(name);
  const set = new Map();
  for (const r of data) {
    const v = r[i];
    set.set(v, (set.get(v) || 0) + 1);
  }
  return set;
};

console.log("상태 distinct:", [...distinct("상태").entries()]);
console.log("조 distinct:", [...distinct("조").entries()]);
console.log("부서 distinct:", [...distinct("부서").entries()]);
console.log("직무 distinct:", [...distinct("직무").entries()]);
console.log("도급사 distinct:", [...distinct("도급사").entries()]);
console.log("방진복&조끼 distinct:", [...distinct("방진복&조끼").entries()]);
console.log("방진화&안전화 distinct:", [...distinct("방진화&안전화").entries()]);

// duplicate 사번 check
const iEmp = col("사번");
const seen = new Map();
for (const r of data) {
  const v = r[iEmp];
  seen.set(v, (seen.get(v) || 0) + 1);
}
const dups = [...seen.entries()].filter(([, c]) => c > 1);
console.log("dup 사번:", dups);

// last few rows sample (resigned ones)
const iStatus = col("상태");
const resigned = data.filter((r) => r[iStatus] !== "정상");
console.log("non-정상 rows sample:", JSON.stringify(resigned.slice(0, 5)));
console.log("non-정상 count:", resigned.length);
