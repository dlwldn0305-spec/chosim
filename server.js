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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

if (!process.env.OPENAI_API_KEY) {
  console.warn("⚠️ OPENAI_API_KEY 없음 (.env 확인)");
}

function clampStage(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(4, Math.floor(n)));
}

function buildPrompt(text, stage) {
  const guides = {
    0: "문장을 그대로 둔다",
    1: "불필요한 수식어를 제거한다",
    2: "감정을 줄이고 관찰처럼 만든다",
    3: "의지를 태도로 바꾼다",
    4: "차분하고 단단한 믿음처럼 만든다",
  };

  return `
너는 문장을 닦는 역할이다

규칙
- 따옴표, 인용부호, 강조 기호를 절대 쓰지 않는다
- 문장 앞뒤에 어떤 기호도 붙이지 않는다
- 설명하지 않는다
- 문장은 하나만 출력한다
- 존댓말을 쓰지 않는다
- 가능하면 ~겠지 말투를 사용한다

목표
${guides[stage]}

원문
${text}

결과
`.trim();
}

app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/api/mutate", async (req, res) => {
  const { text = "", stage = 0 } = req.body || {};
  const safeStage = clampStage(stage);
  const safeText = String(text ?? "").trim();

  try {
    const prompt = buildPrompt(safeText, safeStage);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "너는 문장을 변형하는 장치다." },
        { role: "user", content: prompt },
      ],
      temperature: 0.9,
    });

    const raw = completion.choices[0].message.content;
const cleaned = sanitizeOutput(raw);

res.json({ ok: true, result: cleaned });


    // ✅ 여기서만 로그
    console.log("RAW:", raw);
    console.log("CLEAN:", cleaned);

    // ✅ ok도 같이 보내주자 (프론트가 ok 체크하는 경우 대비)
    res.json({ ok: true, result: cleaned });
  } catch (err) {
    console.error("OpenAI error:", err);
    res.status(500).json({ ok: false, error: err?.message || "OpenAI error" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`OpenAI server running on http://localhost:${PORT}`);
});
