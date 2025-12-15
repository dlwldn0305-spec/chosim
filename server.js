// server.js (DROP-IN)
// - /api/mutate 안정화: temperature 낮춤, 단계별 규칙 구체화, 출력 흔들림 방지
// - 따옴표/기호 제거 sanitizeOutput 유지
// - res.headersSent 안전망 포함

import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";

function sanitizeOutput(text) {
  return String(text ?? "")
    .replace(/["'`“”‘’「」『』《》〈〉]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

if (!process.env.OPENAI_API_KEY) {
  console.warn("⚠️ OPENAI_API_KEY 없음 (.env 확인)");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// OPENAI_MODEL=gpt-4o-mini 같은 식으로 .env에서 바꿀 수 있음
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

function clampStage(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(4, Math.floor(n)));
}

function buildPrompt(text, stage) {
  const guides = {
    0: "원문을 그대로 둔다",
    1: "작은 핑계를 섞어 초심이 약간 느슨해진 문장으로 바꾼다",
    2: "바쁨, 피곤함, 일정 같은 이유로 자기합리화가 뚜렷해진 문장으로 바꾼다",
    3: "기준을 낮추고 미루며 남들도 다 그렇다는 식의 합리화가 강해진 문장으로 바꾼다",
    4: "초심과 거의 반대에 가까운 결론까지 가되 말은 자연스럽고 일상적인 자기합리화로 만든다",
  };

  return `
너는 초심을 닦지 않으면 초심이 변질되는 과정을 문장으로 보여주는 역할이다

규칙
- 따옴표, 인용부호, 괄호, 강조 기호를 절대 쓰지 않는다
- 이모지, 해시태그, 특수문자, 말줄임표를 쓰지 않는다
- 설명하지 않는다
- 문장은 하나만 출력한다
- 존댓말을 쓰지 않는다
- 원문에 없던 새로운 목표를 만들어내지 않는다
- 의미가 너무 튀지 않게 일상적인 말투로 쓴다
- 15자에서 35자 사이로 유지한다
- 원문이 명령형이면, 합리화된 명령형 또는 자기변명형으로 바꾼다

변형 방향
${guides[stage]}

변형 예시(형태만 참고)
- 매일 6시 기상 -> 늦게 자면 늦게 일어나도 되지
- 매일 운동하기 -> 오늘은 피곤하니까 쉬고 내일부터 하자
- 다이어트 성공하기 -> 오늘은 그냥 먹고 내일부터 조절하면 돼

원문
${text}

결과
`.trim();
}

async function mutateTextSomehow(text, stage) {
  const s = clampStage(stage);
  const input = String(text || "").trim();
  if (!input) return "";

  if (s === 0) return sanitizeOutput(input);

  const prompt = buildPrompt(input, s);

  const resp = await openai.responses.create({
    model: MODEL,
    input: prompt,
    temperature: 0.2,
    max_output_tokens: 80,
  });

  const out = resp.output_text || "";
  return sanitizeOutput(out) || sanitizeOutput(input);
}

app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/api/mutate", async (req, res) => {
  try {
    const { text, stage } = req.body || {};

    if (!text || typeof text !== "string") {
      return res.status(400).json({ ok: false, error: "text is required" });
    }

    const s = Number(stage);
    if (!Number.isFinite(s)) {
      return res.status(400).json({ ok: false, error: "stage must be a number" });
    }

    const result = await mutateTextSomehow(text, s);
    return res.json({ ok: true, result });
  } catch (err) {
    console.error("[/api/mutate] error:", err);
    if (res.headersSent) return;
    return res.status(500).json({ ok: false, error: "mutate failed" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`OpenAI server running on http://localhost:${PORT}`);
});
