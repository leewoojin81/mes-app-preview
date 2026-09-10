const STYLES: Record<string, string> = {
  대기: "bg-slate-100 text-slate-600 border-slate-300",
  발행: "bg-blue-50 text-blue-700 border-blue-300",
  확정: "bg-blue-50 text-blue-700 border-blue-300",
  진행: "bg-amber-50 text-amber-700 border-amber-300",
  완료: "bg-emerald-50 text-emerald-700 border-emerald-300",
};

export default function StatusBadge({ status }: { status: string }) {
  const style = STYLES[status] ?? "bg-slate-100 text-slate-600 border-slate-300";
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${style}`}
    >
      {status}
    </span>
  );
}
