import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const maxDuration = 120;

// 입고검사의뢰서 사진 읽기 — 대시보드의 "의뢰서 사진으로 로트 추가"와 같은 프롬프트로 Claude에게 표를 읽게 한다.
// 서버에 ANTHROPIC_API_KEY(환경변수 또는 .env.local)가 있어야 동작한다. 키가 없으면 안내 메시지만 돌려준다.
// 사진은 이 요청 동안 Anthropic API로 전송되며 MES DB에는 저장되지 않는다(저장은 로트 저장 때 따로).
const MODEL = "claude-opus-5-5";

const PROMPT =
  '이 사진은 한국어 "입고검사의뢰서" 양식입니다. 표의 순번 줄 중 자재코드가 적힌 줄만 모두 읽어 주세요. 글자는 보이는 그대로 옮기고 추측하지 마세요(자재코드는 영문 대문자+숫자, 예: BFS0723A, BIP1375A). 읽기 어려우면 빈 문자열("")로 두세요.\n' +
  'JSON 한 개만 답하세요(설명·코드블록 없이). 형식: {"supplier":"납품업체(납품 업체명) 칸에 적힌 글자","receiptDate":"YYYY-MM-DD(입고일)","requestDate":"YYYY-MM-DD(검사 의뢰일)","receiptType":"표 위쪽 「입고 구분」 칸 아래에 인쇄된 「발주품( 국내 / 해외 ), 사급품( 국내 / 해외 ), 샘플」 중 펜으로 동그라미가 그려진 것. 괄호 안의 국내/해외에 동그라미가 있으면 품목과 합쳐 발주품(국내)|발주품(해외)|사급품(국내)|사급품(해외) 중 하나, 샘플에 동그라미가 있으면 샘플, 동그라미가 없으면 빈 문자열","items":[{"code":"자재코드","name":"품명","spec":"규격","qty":입고수량(숫자),"design":"이 줄의 「디자인 구분」 칸(표 오른쪽 열)에 인쇄된 「신규 / 변경 / 재발주」 중 펜으로 동그라미가 그려진 단어 하나(신규|변경|재발주), 동그라미가 없으면 빈 문자열","customer":"고객사 칸에 적힌 글자(납품업체와 다른 칸), 없으면 빈 문자열"}]}\n' +
  "규칙: 동그라미는 손으로 그린 원이고 인쇄 글자를 둘러싼 형태입니다. 줄마다 신규/변경/재발주의 동그라미를 따로 확인하고 서로 섞지 마세요. 규격 칸 문장은 spec에 그대로, qty는 쉼표 없이 숫자만, 순번 1~20 중 비어 있는 줄은 넣지 마세요.";

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "사진 자동 입력을 쓰려면 서버에 ANTHROPIC_API_KEY가 설정되어 있어야 합니다. 관리자에게 문의하거나 아래에서 직접 입력해 주세요." },
      { status: 503 }
    );
  }
  const body = (await req.json().catch(() => null)) as { image?: string } | null;
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([\s\S]+)$/.exec(body?.image ?? "");
  if (!m) return NextResponse.json({ error: "사진 형식이 올바르지 않습니다." }, { status: 400 });
  if (m[2].length > 8 * 1024 * 1024) return NextResponse.json({ error: "사진 용량이 너무 큽니다." }, { status: 413 });

  try {
    const client = new Anthropic();
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort: "medium" },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: m[1] as "image/jpeg" | "image/png" | "image/webp", data: m[2] } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });
    if (res.stop_reason === "refusal") {
      return NextResponse.json({ error: "이 사진은 처리할 수 없습니다. 아래에서 직접 입력해 주세요." }, { status: 422 });
    }
    let text = "";
    for (const b of res.content) if (b.type === "text") text += b.text;
    const s = text.indexOf("{");
    const e = text.lastIndexOf("}");
    if (s < 0 || e <= s) return NextResponse.json({ error: "사진 내용을 표로 정리하지 못했습니다. 더 선명한 사진으로 다시 시도해 주세요." }, { status: 422 });
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.slice(s, e + 1));
    } catch {
      return NextResponse.json({ error: "사진 내용을 표로 정리하지 못했습니다. 더 선명한 사진으로 다시 시도해 주세요." }, { status: 422 });
    }
    return NextResponse.json({ ok: true, data: parsed });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return NextResponse.json({ error: "요청이 많아 잠시 후 다시 시도해 주세요." }, { status: 429 });
    if (err instanceof Anthropic.AuthenticationError) return NextResponse.json({ error: "ANTHROPIC_API_KEY가 올바르지 않습니다. 관리자에게 문의해 주세요." }, { status: 502 });
    if (err instanceof Anthropic.BadRequestError) return NextResponse.json({ error: "이 사진을 읽을 수 없습니다. 다른 사진(JPG/PNG)으로 시도해 주세요." }, { status: 422 });
    if (err instanceof Anthropic.APIConnectionError) return NextResponse.json({ error: "AI 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요." }, { status: 502 });
    return NextResponse.json({ error: "사진을 읽지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 502 });
  }
}
