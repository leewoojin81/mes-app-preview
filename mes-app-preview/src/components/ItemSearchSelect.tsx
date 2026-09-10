"use client";

import { useMemo, useState } from "react";
import type { Item } from "@/lib/types";

export default function ItemSearchSelect({
  items,
  value,
  onChange,
  placeholder = "품목코드 또는 품목명 검색",
}: {
  items: Item[];
  value: string;
  onChange: (item_code: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = items.find((i) => i.item_code === value);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return items
      .filter(
        (i) =>
          i.item_code.toLowerCase().includes(q) ||
          i.item_name.toLowerCase().includes(q) ||
          (i.spec ?? "").toLowerCase().includes(q)
      )
      .slice(0, 20);
  }, [items, query]);

  return (
    <div className="relative">
      <input
        type="text"
        className="border border-slate-300 rounded-md px-3 py-2 text-sm w-full"
        placeholder={placeholder}
        value={
          open ? query : selected ? `${selected.item_code} · ${selected.item_name}` : ""
        }
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (value) onChange("");
        }}
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && query.trim() && (
        <ul className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-md shadow-lg">
          {results.length === 0 && (
            <li className="px-3 py-2 text-sm text-slate-400">검색 결과가 없습니다.</li>
          )}
          {results.map((i) => (
            <li
              key={i.item_code}
              className="px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer"
              onMouseDown={() => {
                onChange(i.item_code);
                setQuery("");
                setOpen(false);
              }}
            >
              <div className="font-medium">{i.item_name}</div>
              <div className="text-xs text-slate-400 font-mono">{i.item_code}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
