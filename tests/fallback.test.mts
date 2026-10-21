// Regression test for AI model fallback, with fetch stubbed to behave like the Gemini API.
//   node --import ./tests/ts-resolve.mjs --experimental-strip-types --no-warnings tests/fallback.test.mts
import { DEFAULT_SETTINGS, type Settings } from "../src/types.ts";

type Behaviour = Record<string, "ok" | "retired" | "quota" | "busy-once">;
const MODELS = ["gemini-2.5-flash", "gemini-flash-latest", "gemini-3.8-flash", "gemini-3.5-flash", "gemini-flash-lite-latest", "gemini-3.1-flash-lite", "gemini-3.5-flash-tts"];

function stub(behaviour: Behaviour) {
  const calls: string[] = [];
  const busy = new Set<string>();
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes("/models?")) return new Response(JSON.stringify({ models: MODELS.map((m) => ({ name: "models/" + m, supportedGenerationMethods: ["generateContent"] })) }), { status: 200 });
    const model = decodeURIComponent(u.match(/models\/([^:]+):generateContent/)![1]);
    calls.push(model);
    const b = behaviour[model] ?? "retired";
    if (b === "retired") return new Response(JSON.stringify({ error: { message: `This model models/${model} is no longer available to new users.` } }), { status: 404 });
    if (b === "quota") return new Response(JSON.stringify({ error: { message: "You exceeded your current quota", details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }, { retryDelay: "68000s" }] } }), { status: 429 });
    if (b === "busy-once" && !busy.has(model)) { busy.add(model); return new Response(JSON.stringify({ error: { message: "high demand" } }), { status: 503 }); }
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: `OK từ ${model}` }] }, finishReason: "STOP" }] }), { status: 200 });
  }) as typeof fetch;
  return calls;
}

let n = 0;
async function scenario(name: string, model: string, behaviour: Behaviour, check: (r: { out?: string; err?: string; switches: string[]; calls: string[]; second?: string; secondCalls?: string[] }) => string | true) {
  // Fresh module instance per scenario so session caches start empty.
  const ai = await import(`../src/ai.ts?case=${++n}`);
  const calls = stub(behaviour);
  const switches: string[] = [];
  ai.onModelSwitch((_p: string, from: string, to: string, why: string) => switches.push(`${from}→${to}(${why})`));
  const s: Settings = { ...DEFAULT_SETTINGS, provider: "gemini", geminiKey: "test", geminiModel: model };
  const r: any = { switches, calls };
  try { r.out = await ai.callAI(s, [{ role: "user", content: "hi" }]); } catch (e: any) { r.err = e.message; }
  // A second call in the same session must go straight to the working model.
  const before = calls.length;
  try { r.second = await ai.callAI(s, [{ role: "user", content: "hi" }]); } catch (e: any) { r.second = "ERR " + e.message; }
  r.secondCalls = calls.slice(before);
  const verdict = check(r);
  console.log(`${verdict === true ? "✅" : "❌"} ${name}${verdict === true ? "" : " — " + verdict + " | " + JSON.stringify(r)}`);
  return verdict === true;
}

const results = [
  await scenario(
    "Model cũ bị ngừng + model kế tiếp hết lượt → dùng model thứ ba (đúng lỗi người dùng gặp)",
    "gemini-2.5-flash",
    { "gemini-flash-latest": "quota", "gemini-3.8-flash": "quota", "gemini-3.5-flash": "ok" },
    (r) => (r.out === "OK từ gemini-3.5-flash" && r.switches[0] === "gemini-2.5-flash→gemini-flash-latest(retired)" && r.secondCalls!.join() === "gemini-3.5-flash") || "sai model",
  ),
  await scenario(
    "Model cũ bị ngừng, model mới còn lượt → chuyển hẳn sang model mới",
    "gemini-2.5-flash",
    { "gemini-flash-latest": "ok" },
    (r) => (r.out === "OK từ gemini-flash-latest" && r.switches.join() === "gemini-2.5-flash→gemini-flash-latest(retired)") || "không chuyển",
  ),
  await scenario(
    "Hết lượt mọi model → báo rõ 'hết lượt miễn phí', không báo 404",
    "gemini-2.5-flash",
    { "gemini-flash-latest": "quota", "gemini-3.8-flash": "quota", "gemini-3.5-flash": "quota", "gemini-flash-lite-latest": "quota", "gemini-3.1-flash-lite": "quota" },
    (r) => (!!r.err && r.err.includes("hết lượt AI miễn phí") && !r.err.includes("404")) || "thông báo sai: " + r.err,
  ),
  await scenario(
    "Máy chủ quá tải 1 lần (503) → tự thử lại thành công",
    "gemini-flash-latest",
    { "gemini-flash-latest": "busy-once" },
    (r) => (r.out === "OK từ gemini-flash-latest" && r.calls.filter((c) => c === "gemini-flash-latest").length >= 2) || "không thử lại",
  ),
];
console.log(`\n${results.filter(Boolean).length}/${results.length} tình huống chuyển model đúng`);
