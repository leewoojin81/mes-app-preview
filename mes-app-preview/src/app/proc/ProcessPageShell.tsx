// 공정관리(PROC-xx) 공정별 페이지 공통 틀 — 각 공정에서 쓰던 업무관리를 옮겨오기 전까지는
// 제목과 "준비중" 안내만 보여준다.
export default function ProcessPageShell({ title, code }: { title: string; code: string }) {
  return (
    <div className="w-full px-4 sm:px-6 pt-6">
      <h1 className="text-xl font-bold text-navy">{title}</h1>
      <p className="text-sm text-slate-500 mt-1">{code} · 공정 업무관리</p>
      <div className="mt-6 rounded-lg border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-400">
        준비중입니다.
      </div>
    </div>
  );
}
