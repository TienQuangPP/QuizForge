import { useMemo, useState } from "react";
import { useStore } from "../store";
import type { DraftQuestion } from "../types";
import { QUESTION_TYPES, type GenOptions } from "../ai";
import { parsePasted, parseTheoryMarkdown } from "../parsers";
import { buildQuestionPrompt, buildTheoryPrompt, EXTERNAL_AIS, type MaterialMode } from "../externalPrompt";
import { go } from "../ui";

const OPTS_KEY = "quizforge-external-opts";
const MAX_MATERIAL = 60000;

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export default function ExternalAI({ target, ensureDeck, onQuestions, initialKind = "questions" }: {
  target: string;
  ensureDeck: () => Promise<string>;
  onQuestions: (qs: DraftQuestion[], source: string) => void;
  initialKind?: "questions" | "theory";
}) {
  const store = useStore();
  const saved = JSON.parse(localStorage.getItem(OPTS_KEY) || "{}");
  const [kind, setKind] = useState<"questions" | "theory">(initialKind);
  const docs = useMemo(() => store.docs.filter((d) => d.deckId === target), [store.docs, target]);
  const [mode, setMode] = useState<MaterialMode>(docs.length ? "docs" : "attach");
  const [topic, setTopic] = useState("");
  const [opts, setOpts] = useState<GenOptions & { depth: "brief" | "detailed" }>({
    count: 20, language: "vi", difficulty: "mixed", optionCount: 4, types: ["definition", "understanding", "application", "negative"], instructions: "", withExplanation: true, depth: "detailed", ...saved,
  });
  const set = (p: Partial<typeof opts>) => setOpts((o) => { const n = { ...o, ...p }; localStorage.setItem(OPTS_KEY, JSON.stringify(n)); return n; });
  const [copied, setCopied] = useState(false);
  const [answer, setAnswer] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [notes, setNotes] = useState<{ title: string; summary?: string; content: string; on: boolean }[]>([]);

  const materialFull = docs.map((d) => `### ${d.name}\n${d.text}`).join("\n\n");
  const material = materialFull.slice(0, MAX_MATERIAL);
  const prompt = useMemo(
    () => kind === "questions"
      ? buildQuestionPrompt({ ...opts, mode, material, topic })
      : buildTheoryPrompt({ language: opts.language, depth: opts.depth, instructions: opts.instructions, mode, material, topic }),
    [kind, opts, mode, material, topic],
  );

  const copy = async () => {
    const ok = await copyText(prompt);
    setCopied(ok);
    store.toast(ok ? "Đã sao chép câu lệnh — dán vào khung chat AI" : "Không sao chép được, hãy bôi đen câu lệnh và Ctrl+C", ok ? "ok" : "err");
    if (ok) setTimeout(() => setCopied(false), 4000);
  };

  const parse = () => {
    setMsg(null);
    if (kind === "questions") {
      const qs = parsePasted(answer);
      if (!qs.length) return setMsg({ ok: false, text: "Chưa nhận ra câu hỏi nào. Hãy dán TOÀN BỘ câu trả lời của AI (kể cả khối ```json). Nếu AI trả lời sai định dạng, hãy nhắc nó: “Trả lời lại đúng định dạng JSON như yêu cầu”." });
      const missing = qs.filter((q) => !q.answers.length).length;
      onQuestions(qs, "AI bên ngoài");
      setMsg({ ok: true, text: `Nhận được ${qs.length} câu — xem lại ở cột bên phải rồi bấm Lưu.${missing ? ` ⚠️ ${missing} câu chưa có đáp án, cần chọn tay.` : ""} AI dừng giữa chừng? Gõ “tiếp tục” cho nó, rồi dán phần mới vào đây và bấm Nhận dạng lần nữa.` });
      setAnswer("");
    } else {
      const ns = parseTheoryMarkdown(answer);
      if (!ns.length) {
        if (answer.trim().length > 200) {
          setNotes([{ title: topic.trim() || "Lý thuyết dán vào", content: answer.trim(), on: true }]);
          return setMsg({ ok: true, text: "Không thấy các tiêu đề “## …” nên sẽ lưu thành một chủ đề. Bạn có thể đổi tên ở dưới." });
        }
        return setMsg({ ok: false, text: "Chưa nhận ra chủ đề nào. Mỗi chủ đề cần bắt đầu bằng dòng “## Tên chủ đề”." });
      }
      setNotes(ns.map((n) => ({ ...n, on: true })));
      setMsg({ ok: true, text: `Nhận được ${ns.length} chủ đề lý thuyết.` });
    }
  };

  const saveNotes = async () => {
    const chosen = notes.filter((n) => n.on && n.title.trim());
    if (!chosen.length) return;
    const id = await ensureDeck();
    await store.addNotes(id, chosen.map(({ on, ...n }) => { void on; return { ...n, source: "ai" as const }; }));
    store.unlock("theory_first");
    store.toast(`Đã thêm ${chosen.length} chủ đề vào sổ tay`);
    go(`deck/${id}/theory`);
  };

  return (
    <div className="ext stack">
      <div className="callout good small">
        💡 <b>Không cần API key.</b> Dùng ChatGPT, Gemini, Claude… bản web miễn phí (hoặc gói trả phí bạn đang có). Các model mạnh thường cho đề chất lượng cao hơn.
      </div>
      <div className="seg">
        <button className={kind === "questions" ? "on" : ""} onClick={() => { setKind("questions"); setMsg(null); }}>❓ Câu hỏi trắc nghiệm</button>
        <button className={kind === "theory" ? "on" : ""} onClick={() => { setKind("theory"); setMsg(null); }}>📖 Sổ tay lý thuyết</button>
      </div>

      <h4 className="step"><span>1</span> Chọn nội dung & yêu cầu</h4>
      <div className="seg wrap">
        <button className={mode === "attach" ? "on" : ""} onClick={() => setMode("attach")}>📎 Tôi sẽ đính kèm file</button>
        <button className={mode === "docs" ? "on" : ""} disabled={!docs.length} onClick={() => setMode("docs")} title={docs.length ? "" : "Bộ đề này chưa có tài liệu"}>📄 Tài liệu trong bộ đề ({docs.length})</button>
        <button className={mode === "topic" ? "on" : ""} onClick={() => setMode("topic")}>💡 Chỉ nhập chủ đề</button>
      </div>
      {mode === "topic" && <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="VD: Hệ tuần hoàn ở người; Thì quá khứ đơn; Luật lao động 2019…" />}
      {mode === "docs" && materialFull.length > MAX_MATERIAL && (
        <p className="muted small">⚠️ Tài liệu dài ({Math.round(materialFull.length / 1000)}k ký tự), câu lệnh chỉ kèm {MAX_MATERIAL / 1000}k ký tự đầu. Nên chọn “đính kèm file” để AI đọc đủ.</p>
      )}
      {mode === "attach" && <p className="muted small">Ở bước 2, bấm nút 📎 hoặc ＋ trong khung chat của AI để đính kèm file PDF/Word/PowerPoint.</p>}

      {kind === "questions" ? (
        <>
          <div className="grid2">
            <div>
              <label>Số câu</label>
              <input type="number" min={1} max={200} value={opts.count} onChange={(e) => set({ count: Math.max(1, Math.min(200, +e.target.value || 1)) })} />
            </div>
            <div>
              <label>Số phương án</label>
              <select value={opts.optionCount} onChange={(e) => set({ optionCount: +e.target.value })}>{[3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select>
            </div>
            <div>
              <label>Ngôn ngữ</label>
              <select value={opts.language} onChange={(e) => set({ language: e.target.value as GenOptions["language"] })}>
                <option value="vi">Tiếng Việt</option><option value="en">English</option><option value="source">Giống tài liệu</option><option value="bilingual">Song ngữ Anh–Việt</option>
              </select>
            </div>
            <div>
              <label>Độ khó</label>
              <select value={opts.difficulty} onChange={(e) => set({ difficulty: e.target.value as GenOptions["difficulty"] })}>
                <option value="mixed">Trộn</option><option value="easy">Dễ</option><option value="medium">Trung bình</option><option value="hard">Khó</option>
              </select>
            </div>
          </div>
          <div className="chips">
            {QUESTION_TYPES.map((t) => (
              <button key={t.id} className={"chip" + (opts.types.includes(t.id) ? " on" : "")} onClick={() => set({ types: opts.types.includes(t.id) ? opts.types.filter((x) => x !== t.id) : [...opts.types, t.id] })}>{t.label}</button>
            ))}
          </div>
        </>
      ) : (
        <div className="grid2">
          <div>
            <label>Ngôn ngữ</label>
            <select value={opts.language} onChange={(e) => set({ language: e.target.value as GenOptions["language"] })}>
              <option value="vi">Tiếng Việt</option><option value="en">English</option><option value="source">Giống tài liệu</option><option value="bilingual">Song ngữ Anh–Việt</option>
            </select>
          </div>
          <div>
            <label>Mức độ</label>
            <select value={opts.depth} onChange={(e) => set({ depth: e.target.value as "brief" | "detailed" })}>
              <option value="detailed">Chi tiết, dễ hiểu</option><option value="brief">Ngắn gọn</option>
            </select>
          </div>
        </div>
      )}
      <input value={opts.instructions} onChange={(e) => set({ instructions: e.target.value })} placeholder="Yêu cầu thêm (tuỳ chọn): VD bám sát chương 3, giống đề thi FE…" />

      <h4 className="step"><span>2</span> Sao chép câu lệnh và gửi cho AI</h4>
      <button className={"btn big " + (copied ? "good" : "primary")} disabled={mode === "topic" && !topic.trim()} onClick={copy}>
        {copied ? "✓ Đã sao chép! Giờ mở AI và dán vào (Ctrl+V)" : "📋 Sao chép câu lệnh"}
      </button>
      <div className="ai-links">
        {EXTERNAL_AIS.map((a) => (
          <a key={a.name} className="btn" href={a.url} target="_blank" rel="noreferrer">{a.icon} Mở {a.name}</a>
        ))}
      </div>
      <details>
        <summary className="small">Xem câu lệnh ({Math.round(prompt.length / 100) / 10}k ký tự)</summary>
        <pre className="doc-text prompt-view">{prompt}</pre>
      </details>

      <h4 className="step"><span>3</span> Dán câu trả lời của AI vào đây</h4>
      <textarea rows={8} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={kind === "questions" ? "Bấm nút “Copy” ở khối code của AI rồi dán vào đây. Văn bản kiểu “Câu 1… A. … Đáp án: B” cũng được." : "Dán toàn bộ sổ tay lý thuyết AI vừa viết (các chủ đề bắt đầu bằng ## …)"} />
      <button className="btn primary" disabled={!answer.trim()} onClick={parse}>{kind === "questions" ? "Nhận dạng câu hỏi →" : "Nhận dạng lý thuyết →"}</button>
      {msg && <div className={"callout " + (msg.ok ? "good" : "bad")}>{msg.text}</div>}

      {kind === "theory" && notes.length > 0 && (
        <div className="stack">
          {notes.map((n, i) => (
            <div key={i} className={"draft" + (n.on ? "" : " off")}>
              <input type="checkbox" checked={n.on} onChange={() => setNotes(notes.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))} />
              <div className="grow">
                <input value={n.title} onChange={(e) => setNotes(notes.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                <div className="muted small">{n.summary ?? n.content.slice(0, 120)} · {Math.round(n.content.length / 100) / 10}k ký tự</div>
              </div>
            </div>
          ))}
          <button className="btn primary" onClick={saveNotes}>💾 Lưu {notes.filter((n) => n.on).length} chủ đề vào sổ tay</button>
        </div>
      )}
    </div>
  );
}
