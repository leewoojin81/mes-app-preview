// 대용량 조회 결과 캐시. 네임스페이스(화면/테이블)별로 데이터 버전(예: 마지막 업로드 시각)이
// 바뀌면 그 네임스페이스만 무효화된다. 키가 무한정 늘지 않도록 최대 개수를 넘으면
// 가장 오래된 항목부터 버린다.
const MAX_ENTRIES = 200;
type Bucket = { version: string; map: Map<string, unknown> };
const g = globalThis as unknown as { __mesQueryCache?: Map<string, Bucket> };

export function cachedQuery<T>(ns: string, version: string, key: string, compute: () => T): T {
  const all = (g.__mesQueryCache ??= new Map());
  let b = all.get(ns);
  if (!b || b.version !== version) {
    b = { version, map: new Map() };
    all.set(ns, b);
  }
  if (b.map.has(key)) return b.map.get(key) as T;
  const v = compute();
  if (b.map.size >= MAX_ENTRIES) b.map.delete(b.map.keys().next().value as string);
  b.map.set(key, v);
  return v;
}
