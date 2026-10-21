import { useEffect, useState, type ReactNode } from "react";
import type { DraftQuestion, Difficulty } from "./types";
import { letter, compressImage } from "./parsers";

export function useHashRoute(): [string[], (path: string) => void] {
  const read = () => location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const on = () => {
      setParts(read());
      window.scrollTo(0, 0);
    };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return [parts, (p: string) => (location.hash = "#/" + p.replace(/^\//, ""))];
}

export const go = (p: string) => (location.hash = "#/" + p.replace(/^\//, ""));

export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={"modal" + (wide ? " wide" : "")} role="dialog" aria-label={title}>
        <header>
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Đóng">✕</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function confirmBox(msg: string) {
  return window.confirm(msg);
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Progress({ value, color }: { value: number; color?: string }) {
  return (
    <div className="bar">
      <span style={{ width: `${Math.max(0, Math.min(100, value * 100))}%`, background: color }} />
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className={"stat " + (tone ?? "")}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

const DIFF_LABEL: Record<Difficulty, string> = { easy: "Dễ", medium: "Vừa", hard: "Khó" };
export const DiffBadge = ({ d }: { d?: Difficulty }) => (d ? <span className={"badge diff-" + d}>{DIFF_LABEL[d]}</span> : null);

/** Tiny, safe Markdown renderer (headings, bold, italic, code, lists, tables-less). */
export function Markdown({ text }: { text: string }) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  const html: string[] = [];
  let list: "ul" | "ol" | null = null;
  let code = false;
  const close = () => {
    if (list) html.push(`</${list}>`);
    list = null;
  };
  for (const raw of text.split("\n")) {
    if (raw.trim().startsWith("```")) {
      close();
      html.push(code ? "</pre>" : "<pre>");
      code = !code;
      continue;
    }
    if (code) { html.push(esc(raw) + "\n"); continue; }
    const line = raw.trimEnd();
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,4})\s+(.*)/))) { close(); html.push(`<h${m[1].length + 2}>${inline(m[2])}</h${m[1].length + 2}>`); }
    else if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { if (list !== "ul") { close(); html.push("<ul>"); list = "ul"; } html.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== "ol") { close(); html.push("<ol>"); list = "ol"; } html.push(`<li>${inline(m[1])}</li>`); }
    else if (!line.trim()) close();
    else { close(); html.push(`<p>${inline(line)}</p>`); }
  }
  close();
  if (code) html.push("</pre>");
  return <div className="md" dangerouslySetInnerHTML={{ __html: html.join("") }} />;
}

export function Spinner() {
  return <span className="spinner" aria-hidden />;
}

/** Editable form for one question (used by manual add, AI review and edit). */
export function QuestionForm({ value, onChange }: { value: DraftQuestion; onChange: (q: DraftQuestion) => void }) {
  const set = (patch: Partial<DraftQuestion>) => onChange({ ...value, ...patch });
  const setOpt = (i: number, text: string) => set({ options: value.options.map((o, j) => (j === i ? text : o)) });
  const toggleAns = (i: number) => {
    const has = value.answers.includes(i);
    set({ answers: has ? value.answers.filter((a) => a !== i) : [...value.answers, i].sort() });
  };
  const removeOpt = (i: number) =>
    set({
      options: value.options.filter((_, j) => j !== i),
      answers: value.answers.filter((a) => a !== i).map((a) => (a > i ? a - 1 : a)),
    });
  return (
    <div className="qform">
      <label>Câu hỏi</label>
      <textarea rows={3} value={value.question} onChange={(e) => set({ question: e.target.value })} placeholder="Nội dung câu hỏi…" />
      {value.image ? (
        <div className="qimg">
          <img src={value.image} alt="" />
          <button className="btn ghost sm" onClick={() => set({ image: undefined })}>Bỏ ảnh</button>
        </div>
      ) : (
        <label className="btn ghost sm file-btn">
          🖼️ Thêm ảnh minh hoạ
          <input type="file" accept="image/*" hidden onChange={async (e) => e.target.files?.[0] && set({ image: await compressImage(e.target.files[0]) })} />
        </label>
      )}
      <label>Phương án <span className="muted">(tick ô bên trái = đáp án đúng; có thể chọn nhiều)</span></label>
      {value.options.map((o, i) => (
        <div className="opt-row" key={i}>
          <button type="button" className={"ans-toggle" + (value.answers.includes(i) ? " on" : "")} onClick={() => toggleAns(i)} title="Đánh dấu đáp án đúng">
            {letter(i)}
          </button>
          <input value={o} onChange={(e) => setOpt(i, e.target.value)} placeholder={`Phương án ${letter(i)}`} />
          {value.options.length > 2 && (
            <button type="button" className="icon-btn" onClick={() => removeOpt(i)} aria-label="Xoá phương án">✕</button>
          )}
        </div>
      ))}
      {value.options.length < 8 && (
        <button type="button" className="btn ghost sm" onClick={() => set({ options: [...value.options, ""] })}>+ Thêm phương án</button>
      )}
      <label>Giải thích</label>
      <textarea rows={3} value={value.explanation ?? ""} onChange={(e) => set({ explanation: e.target.value })} placeholder="Vì sao đáp án đúng…" />
      <div className="grid3">
        <div>
          <label>Chủ đề</label>
          <input value={value.topic ?? ""} onChange={(e) => set({ topic: e.target.value })} placeholder="VD: Chương 2" />
        </div>
        <div>
          <label>Độ khó</label>
          <select value={value.difficulty ?? ""} onChange={(e) => set({ difficulty: (e.target.value || undefined) as Difficulty | undefined })}>
            <option value="">—</option>
            <option value="easy">Dễ</option>
            <option value="medium">Vừa</option>
            <option value="hard">Khó</option>
          </select>
        </div>
        <div>
          <label>Nguồn</label>
          <input value={value.source ?? ""} onChange={(e) => set({ source: e.target.value })} placeholder="Trang / slide" />
        </div>
      </div>
    </div>
  );
}

export const blankQuestion = (): DraftQuestion => ({ question: "", options: ["", "", "", ""], answers: [0] });

export function QuestionPreview({ q, index }: { q: DraftQuestion; index?: number }) {
  return (
    <div className="qpreview">
      <div className="qtext">
        {index != null && <b>Câu {index + 1}. </b>}
        {q.question}
      </div>
      {q.image && <img className="qimg-small" src={q.image} alt="" />}
      <ol className="opts" type="A">
        {q.options.map((o, i) => (
          <li key={i} className={q.answers.includes(i) ? "correct" : ""}>{o}</li>
        ))}
      </ol>
      {q.explanation && <div className="explain-mini">💡 {q.explanation}</div>}
    </div>
  );
}

export function timeAgo(ts: number) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return "vừa xong";
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} ngày trước`;
  return new Date(ts).toLocaleDateString("vi-VN");
}

export const fmtDuration = (sec: number) => {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return m >= 60 ? `${Math.floor(m / 60)}g ${m % 60}p` : `${m}:${String(s).padStart(2, "0")}`;
};

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
