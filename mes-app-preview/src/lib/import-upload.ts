// 엑셀 업로드 호출 공통 — 서버가 "지워지는 건수가 훨씬 많다"며 409(needsConfirm)로 멈춘 경우 확인창을
// 띄우고, 사용자가 진행을 고르면 force=1을 붙여 다시 보낸다. 취소하면 409 응답을 그대로 돌려줘 호출한
// 화면이 안내 문구(error)를 표시한다. 서버 쪽 기준은 lib/import-guard.ts.
export async function postImport(url: string, fd: FormData): Promise<Response> {
  const res = await fetch(url, { method: "POST", body: fd });
  if (res.status !== 409) return res;
  const data = await res.clone().json().catch(() => null);
  if (!data || data.needsConfirm !== true) return res;
  if (!window.confirm(`${data.error}\n\n그래도 진행할까요?`)) return res;
  const retry = new FormData();
  for (const [k, v] of fd.entries()) retry.append(k, v);
  retry.set("force", "1");
  return fetch(url, { method: "POST", body: retry });
}
