import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import type { DraftQuestion } from "../types";
import { aiReady, extractQuestionsAI } from "../ai";
import { compressImage, download, extractText, fileToQuestions, isImage, parseQuestionText, questionsToCSV } from "../parsers";
import { go, Spinner } from "../ui";
import { DraftReview } from "./Studio";

const SAMPLE_TEXT = `Câu 1: Thủ đô của Việt Nam là?
A. Hà Nội
B. Huế
C. TP. Hồ Chí Minh
D. Đà Nẵng
Đáp án: A
Giải thích: Hà Nội là thủ đô từ năm 1976 (thống nhất).

Câu 2: Những số nào là số nguyên tố? (Chọn tất cả)
A. 2
B. 4
*C. 7
D. 9
Đáp án: A, C`;

export default function ImportPage({ deckId }: { deckId?: string }) {
  const store = useStore();
  const ready = aiReady(store.settings);
  const [target, setTarget] = useState(deckId && store.decks.some((d) => d.id === deckId) ? deckId : store.decks[0]?.id ?? "__new");
  const [newName, setNewName] = useState("");
  const [tab, setTab] = useState<"file" | "paste" | "ai">("file");
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [solve, setSolve] = useState(true);
  const [drafts, setDrafts] = useState<DraftQuestion[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);

  // Ctrl+V a screenshot anywhere on the page adds it to the AI image list.
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.items ?? []).filter((it) => it.type.startsWith("image/")).map((it) => it.getAsFile()).filter(Boolean) as File[];
      if (!files.length) return;
      e.preventDefault();
      const urls = await Promise.all(files.map((f) => compressImage(f)));
      setImages((im) => [...im, ...urls]);
      setTab("ai");
    };
    addEventListener("paste", onPaste);
    return () => removeEventListener("paste", onPaste);
  }, []);

  const setResult = (qs: DraftQuestion[], source?: string) => {
    const withSrc = source ? qs.map((q) => ({ ...q, source: q.source ?? source })) : qs;
    setDrafts((d) => {
      const start = d.length;
      setPicked((p) => new Set([...p, ...withSrc.map((_, i) => start + i)]));
      return [...d, ...withSrc];
    });
  };

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    setError("");
    for (const f of Array.from(files)) {
      try {
        if (isImage(f.name)) {
          const url = await compressImage(f);
          setImages((im) => [...im, url]);
          setTab("ai");
          continue;
        }
        setBusy(`Đang đọc ${f.name}…`);
        const qs = await fileToQuestions(f);
        if (qs.length) {
          setResult(qs, f.name);
          store.toast(`${f.name}: nhận ${qs.length} câu`);
        } else {
          // Could not parse a structure: hand the raw text to the AI tab.
          const raw = /\.(json|csv|xlsx)$/i.test(f.name) ? "" : await extractText(f);
          if (raw) {
            setText(raw);
            setTab("ai");
            store.toast(`${f.name}: không nhận dạng được định dạng — thử “AI đọc & chuẩn hoá”`, "info");
          } else store.toast(`${f.name}: không tìm thấy câu hỏi`, "err");
        }
      } catch (e: any) {
        store.toast(`${f.name}: ${e.message}`, "err");
      }
    }
    setBusy("");
  };

  const parsePaste = () => {
    const qs = parseQuestionText(text);
    if (!qs.length) return setError("Không nhận dạng được câu hỏi nào. Kiểm tra định dạng mẫu bên dưới hoặc dùng AI.");
    setError("");
    setResult(qs);
  };

  const runAI = async () => {
    setError("");
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(images.length ? `AI đang đọc ${images.length} ảnh…` : "AI đang trích xuất câu hỏi…");
    try {
      // Process images in small batches to stay within request limits.
      const batches: string[][] = [];
      for (let i = 0; i < images.length; i += 4) batches.push(images.slice(i, i + 4));
      if (!batches.length) batches.push([]);
      let total = 0;
      for (let b = 0; b < batches.length; b++) {
        if (ctrl.signal.aborted) break;
        if (batches.length > 1) setBusy(`AI đang đọc ảnh ${b * 4 + 1}–${Math.min(images.length, b * 4 + 4)}/${images.length}…`);
        const qs = await extractQuestionsAI(store.settings, b === 0 ? text : "", batches[b], solve, ctrl.signal);
        // Attach the photo to each question if a single image produced it.
        const withImg = batches[b].length === 1 && qs.length <= 2 ? qs.map((q) => ({ ...q, image: batches[b][0] })) : qs;
        setResult(withImg, "AI");
        total += qs.length;
      }
      store.toast(`AI trích xuất ${total} câu`);
    } catch (e: any) {
      if (e.name !== "AbortError") setError(e.message);
    } finally {
      setBusy("");
    }
  };

  const save = async () => {
    let id = target;
    if (target === "__new") id = (await store.createDeck({ name: newName.trim() || "Bộ đề nhập " + new Date().toLocaleDateString("vi-VN") })).id;
    const chosen = drafts.filter((_, i) => picked.has(i));
    const n = await store.addQuestions(id, chosen);
    store.toast(`Đã lưu ${n} câu${chosen.length - n ? `, bỏ ${chosen.length - n} câu trùng/thiếu` : ""}`);
    go("deck/" + id);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>📥 Nhập câu hỏi</h1>
          <p className="muted">Đưa bất kỳ bộ câu hỏi nào vào: file Excel/CSV/JSON/Word/PDF/TXT, văn bản dán, hoặc ảnh chụp đề thi (AI đọc).</p>
        </div>
      </div>
      <div className="studio">
        <div className="card stack">
          <h3>Lưu vào bộ đề</h3>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {store.decks.map((d) => <option key={d.id} value={d.id}>{d.emoji} {d.name}</option>)}
            <option value="__new">＋ Tạo bộ đề mới</option>
          </select>
          {target === "__new" && <input placeholder="Tên bộ đề mới" value={newName} onChange={(e) => setNewName(e.target.value)} />}

          <div className="seg">
            <button className={tab === "file" ? "on" : ""} onClick={() => setTab("file")}>📁 File</button>
            <button className={tab === "paste" ? "on" : ""} onClick={() => setTab("paste")}>📋 Dán văn bản</button>
            <button className={tab === "ai" ? "on" : ""} onClick={() => setTab("ai")}>🤖 AI đọc ảnh / văn bản lộn xộn</button>
          </div>

          {tab === "file" && (
            <>
              <div className="dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files); }}>
                <div>Kéo thả file câu hỏi vào đây</div>
                <div className="muted small">.xlsx .csv .json .txt .docx .pdf .pptx — hoặc ảnh .png .jpg (chuyển sang AI)</div>
                <label className="btn primary file-btn">
                  Chọn file
                  <input type="file" multiple hidden accept=".json,.csv,.tsv,.xlsx,.txt,.md,.docx,.pdf,.pptx,.html,.png,.jpg,.jpeg,.webp" onChange={(e) => onFiles(e.target.files)} />
                </label>
              </div>
              <details>
                <summary>Định dạng hỗ trợ & file mẫu</summary>
                <ul className="small">
                  <li><b>Excel / CSV</b>: cột <code>question, A, B, C, D, answer, explanation, topic, difficulty</code>. Đáp án ghi chữ cái (B) hoặc nhiều đáp án (A,C).</li>
                  <li><b>Word / PDF / TXT</b>: dạng “Câu 1: … / A. … / Đáp án: B / Giải thích: …”. Có thể đánh dấu đáp án đúng bằng dấu <code>*</code> trước phương án.</li>
                  <li><b>JSON</b>: file xuất từ QuizForge, mảng <code>{`{question, options, answer}`}</code>, hoặc dữ liệu Smart Deck cũ.</li>
                </ul>
                <div className="row gap">
                  <button className="btn sm" onClick={() => download("mau-cau-hoi.csv", questionsToCSV(parseQuestionText(SAMPLE_TEXT)), "text/csv")}>⤓ Mẫu CSV/Excel</button>
                  <button className="btn sm" onClick={() => download("mau-cau-hoi.txt", SAMPLE_TEXT, "text/plain")}>⤓ Mẫu TXT</button>
                </div>
              </details>
            </>
          )}

          {tab === "paste" && (
            <>
              <textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} placeholder={SAMPLE_TEXT} />
              <div className="row gap">
                <button className="btn primary" disabled={!text.trim()} onClick={parsePaste}>Nhận dạng câu hỏi</button>
                {ready && <button className="btn" disabled={!text.trim()} onClick={() => { setTab("ai"); }}>Dùng AI thay thế →</button>}
              </div>
            </>
          )}

          {tab === "ai" && (
            <>
              {!ready && <div className="callout warn">Cần <a href="#/settings">API key</a> để dùng AI.</div>}
              <div className="dropzone sm" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files); }}>
                <span>📸 Thả ảnh chụp đề / ảnh màn hình (hoặc Ctrl+V để dán ảnh)</span>
                <label className="btn sm file-btn">
                  Chọn ảnh
                  <input type="file" multiple hidden accept="image/*" onChange={(e) => onFiles(e.target.files)} />
                </label>
              </div>
              {images.length > 0 && (
                <div className="thumbs">
                  {images.map((src, i) => (
                    <div key={i} className="thumb">
                      <img src={src} alt="" />
                      <button className="icon-btn" onClick={() => setImages(images.filter((_, j) => j !== i))}>✕</button>
                    </div>
                  ))}
                </div>
              )}
              <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="…và/hoặc dán văn bản đề lộn xộn (copy từ web, PDF, Quizlet…)" />
              <label className="check">
                <input type="checkbox" checked={solve} onChange={(e) => setSolve(e.target.checked)} />
                Nếu đề không có đáp án, để AI tự giải và giải thích
              </label>
              {busy ? (
                <div className="gen-status"><Spinner /> {busy} <button className="btn sm" onClick={() => abort.current?.abort()}>Dừng</button></div>
              ) : (
                <button className="btn primary" disabled={!ready || (!text.trim() && !images.length)} onClick={runAI}>🤖 AI trích xuất câu hỏi</button>
              )}
            </>
          )}
          {busy && tab !== "ai" && <div className="muted"><Spinner /> {busy}</div>}
          {error && <div className="callout bad">{error}</div>}
        </div>

        <div className="card stack">
          <div className="row between">
            <h3>Xem trước {drafts.length > 0 && `(${picked.size}/${drafts.length})`}</h3>
            {drafts.length > 0 && (
              <div className="row gap">
                <button className="btn sm ghost" onClick={() => { setDrafts([]); setPicked(new Set()); }}>Xoá</button>
                <button className="btn sm primary" disabled={!picked.size} onClick={save}>💾 Lưu {picked.size} câu</button>
              </div>
            )}
          </div>
          {drafts.length === 0 ? (
            <div className="empty small"><div className="empty-icon">🗂️</div><p className="muted">Câu hỏi nhận dạng được sẽ hiện ở đây để kiểm tra trước khi lưu.</p></div>
          ) : (
            <DraftReview drafts={drafts} setDrafts={setDrafts} picked={picked} setPicked={setPicked} />
          )}
        </div>
      </div>
    </div>
  );
}
