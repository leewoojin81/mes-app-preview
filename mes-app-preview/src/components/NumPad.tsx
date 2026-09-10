"use client";

const KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "clear", "0", "back"];

export default function NumPad({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  function press(key: string) {
    if (key === "clear") {
      onChange("");
      return;
    }
    if (key === "back") {
      onChange(value.slice(0, -1));
      return;
    }
    if (key === "." && value.includes(".")) return;
    if (value.length >= 9) return;
    onChange(value === "0" && key !== "." ? key : value + key);
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => press(key)}
          className={`h-14 rounded-lg text-lg font-semibold active:scale-95 transition-transform ${
            key === "clear"
              ? "bg-red-50 text-red-600 border border-red-200"
              : key === "back"
              ? "bg-slate-100 text-slate-600 border border-slate-200"
              : "bg-white text-navy border border-slate-200 hover:bg-slate-50"
          }`}
        >
          {key === "clear" ? "지움" : key === "back" ? "←" : key}
        </button>
      ))}
    </div>
  );
}
