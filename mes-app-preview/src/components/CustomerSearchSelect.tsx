"use client";

import { useMemo, useState } from "react";
import type { Customer } from "@/lib/types";

export default function CustomerSearchSelect({
  customers,
  value,
  onChange,
  placeholder = "거래처코드 또는 거래처명 검색",
}: {
  customers: Customer[];
  value: string;
  onChange: (customer_code: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = customers.find((c) => c.customer_code === value);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return customers
      .filter(
        (c) =>
          c.customer_code.toLowerCase().includes(q) ||
          c.customer_name.toLowerCase().includes(q)
      )
      .slice(0, 20);
  }, [customers, query]);

  return (
    <div className="relative">
      <input
        type="text"
        className="border border-slate-300 rounded-md px-3 py-2 text-sm w-full"
        placeholder={placeholder}
        value={
          open ? query : selected ? `${selected.customer_code} · ${selected.customer_name}` : ""
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
          {results.map((c) => (
            <li
              key={c.customer_code}
              className="px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer"
              onMouseDown={() => {
                onChange(c.customer_code);
                setQuery("");
                setOpen(false);
              }}
            >
              <div className="font-medium">{c.customer_name}</div>
              <div className="text-xs text-slate-400 font-mono">{c.customer_code}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
