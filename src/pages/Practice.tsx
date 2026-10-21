import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalize, useStore } from "../store";
import type { Difficulty, PracticeMode, Question } from "../types";
import { aiReady, explainQuestion } from "../ai";
import { letter } from "../parsers";
import { DiffBadge, Empty, fmtDuration, go, Markdown, shuffle, Spinner } from "../ui";
import { formatInterval, grade } from "../srs";

interface RunItem { q: Question; order: number[] }
interface Run {
  mode: PracticeMode;
  deckIds: string[];
  items: RunItem[];
  timeLimitSec: number;
  title: string;
}

let pendingRun: Run | null = null;
export function startRun(run: Run) {
  pendingRun = run;
  go("play");
}

type Source = "smart" | "all" | "unseen" | "wrong" | "due" | "flagged";
const CFG_KEY = "quizforge-practice-cfg";

export function PracticeSetup({ deckId, preset }: { deckId?: string; preset?: string }) {
  const store = useStore();
  const saved = JSON.parse(localStorage.getItem(CFG_KEY) || "{}");
  const initialDecks = deckId && deckId !== "all" ? [deckId] : store.decks.map((d) => d.id);
  const [decks, setDecks] = useState<Set<string>>(new Set(initialDecks));
  const [mode, setMode] = useState<PracticeMode>(preset === "exam" ? "exam" : preset === "flash" ? "flash" : saved.mode ?? "practice");
  const [source, setSource] = useState<Source>(preset === "wrong" ? "wrong" : preset === "due" ? "due" : saved.source ?? "smart");
  const [count, setCount] = useState<number>(saved.count ?? 20);
  const [shuffleQ, setShuffleQ] = useState<boolean>(saved.shuffleQ ?? true);
  const [shuffleO, setShuffleO] = useState<boolean>(saved.shuffleO ?? true);
  const [minutes, setMinutes] = useState<number>(saved.minutes ?? 0);
  const [topics, setTopics] = useState<Set<string>>(new Set());
  const [diff, setDiff] = useState<"" | Difficulty>("");
  const selIds = preset?.startsWith("sel:") ? new Set(preset.slice(4).split(",")) : null;

  useEffect(() => localStorage.setItem(CFG_KEY, JSON.stringify({ mode, source, count, shuffleQ, shuffleO, minutes })), [mode, source, count, shuffleQ, shuffleO, minutes]);

  const pool = useMemo(() => store.questions.filter((q) => (selIds ? selIds.has(q.id) : decks.has(q.deckId))), [store.questions, decks, preset]); // eslint-disable-line
  const allTopics = useMemo(() => [...new Set(pool.map((q) => q.topic).filter(Boolean))] as string[], [pool]);

  const filtered = useMemo(() => {
    const now = Date.now();
    return pool.filter((q) => {
      const p = store.progress[q.id];
      if (topics.size && !topics.has(q.topic ?? "")) return false;
      if (diff && q.difficulty !== diff) return false;
      if (source === "unseen") return !p?.attempts;
      if (source === "wrong") return !!p?.attempts && !p.lastCorrect;
      if (source === "due") return !!p?.attempts && p.due <= now;
      if (source === "flagged") return !!p?.flagged;
      return true;
    });
  }, [pool, store.progress, topics, diff, source]);

  const begin = () => {
    let list = filtered;
    if (source === "smart") {
      // Smart mix: due & wrong first, then unseen, then the rest ordered by weakness.
      const now = Date.now();
      const score = (q: Question) => {
        const p = store.progress[q.id];
        if (!p?.attempts) return 2 + Math.random();
        if (!p.lastCorrect) return 4 + Math.random();
        if (p.due <= now) return 3 + Math.random();
        return 1 - p.correct / p.attempts + Math.random() * 0.5;
      };
      list = [...list].sort((a, b) => score(b) - score(a));
      list = list.slice(0, count);
      if (shuffleQ) list = shuffle(list);
    } else {
      if (shuffleQ) list = shuffle(list);
      list = list.slice(0, count);
    }
    if (!list.length) return store.toast("Không có câu nào phù hợp bộ lọc", "err");
    const names = store.decks.filter((d) => decks.has(d.id)).map((d) => d.name);
    startRun({
      mode,
      deckIds: [...new Set(list.map((q) => q.deckId))],
      items: list.map((q) => ({ q, order: shuffleO && !/all of the above|none of the above|tất cả các|cả [abcd] và|không có (đáp án|phương án)/i.test(q.options.join(" ")) ? shuffle(q.options.map((_, i) => i)) : q.options.map((_, i) => i) })),
      timeLimitSec: mode === "exam" ? (minutes > 0 ? minutes * 60 : list.length * store.settings.examSecondsPerQuestion) : 0,
      title: names.length === 1 ? names[0] : `${names.length} bộ đề`,
    });
  };

  if (!store.questions.length) {
    return (
      <div className="page">
        <Empty icon="🎯" title="Chưa có câu hỏi để luyện">
          <div className="row gap center">
            <button className="btn primary" onClick={() => go("studio")}>✨ Tạo bằng AI</button>
            <button className="btn" onClick={() => go("import")}>📥 Nhập câu hỏi</button>
          </div>
        </Empty>
      </div>
    );
  }

  const MODES: { id: PracticeMode; icon: string; title: string; desc: string }[] = [
    { id: "practice", icon: "🎯", title: "Luyện tập", desc: "Biết đúng/sai ngay, xem giải thích từng câu" },
    { id: "exam", icon: "📝", title: "Thi thử", desc: "Bấm giờ, làm hết rồi mới chấm điểm" },
    { id: "flash", icon: "🃏", title: "Thẻ ghi nhớ", desc: "Lật thẻ, tự chấm Quên/Khó/Tốt/Dễ (SRS)" },
  ];

  return (
    <div className="page narrow">
      <h1>🎯 Luyện tập</h1>
      {selIds && <div className="callout">Đang luyện {selIds.size} câu đã chọn.</div>}
      <div className="mode-grid">
        {MODES.map((m) => (
          <button key={m.id} className={"mode" + (mode === m.id ? " on" : "")} onClick={() => setMode(m.id)}>
            <span>{m.icon}</span>
            <b>{m.title}</b>
            <small>{m.desc}</small>
          </button>
        ))}
      </div>

      {!selIds && (
        <div className="card stack">
          <div className="row between">
            <h3>Bộ đề</h3>
            <div className="row gap">
              <button className="btn sm ghost" onClick={() => setDecks(new Set(store.decks.map((d) => d.id)))}>Tất cả</button>
              <button className="btn sm ghost" onClick={() => setDecks(new Set())}>Bỏ hết</button>
            </div>
          </div>
          <div className="deck-checks">
            {store.decks.map((d) => (
              <label key={d.id} className="check">
                <input type="checkbox" checked={decks.has(d.id)} onChange={() => setDecks((s) => { const n = new Set(s); n.has(d.id) ? n.delete(d.id) : n.add(d.id); return n; })} />
                {d.emoji} {d.name} <span className="muted small">({store.questions.filter((q) => q.deckId === d.id).length})</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="card stack">
        <h3>Chọn câu</h3>
        <div className="chips">
          {([
            ["smart", "🧠 Thông minh (ưu tiên câu yếu)"],
            ["all", "Tất cả"],
            ["unseen", "Chưa học"],
            ["wrong", "Đang sai"],
            ["due", "Đến hạn ôn"],
            ["flagged", "Đã đánh dấu"],
          ] as [Source, string][]).map(([id, label]) => (
            <button key={id} className={"chip" + (source === id ? " on" : "")} onClick={() => setSource(id)}>{label}</button>
          ))}
        </div>
        {allTopics.length > 1 && (
          <>
            <label>Chủ đề {topics.size > 0 && <a onClick={() => setTopics(new Set())}>(bỏ lọc)</a>}</label>
            <div className="chips">
              {allTopics.map((t) => (
                <button key={t} className={"chip" + (topics.has(t) ? " on" : "")} onClick={() => setTopics((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n; })}>{t}</button>
              ))}
            </div>
          </>
        )}
        <div className="grid3">
          <div>
            <label>Số câu (có {filtered.length})</label>
            <input type="number" min={1} value={count} onChange={(e) => setCount(Math.max(1, +e.target.value || 1))} />
            <div className="chips tight">
              {[10, 20, 40, 60].map((n) => <button key={n} className="chip" onClick={() => setCount(n)}>{n}</button>)}
              <button className="chip" onClick={() => setCount(filtered.length || 1)}>Hết</button>
            </div>
          </div>
          <div>
            <label>Độ khó</label>
            <select value={diff} onChange={(e) => setDiff(e.target.value as any)}>
              <option value="">Mọi mức</option>
              <option value="easy">Dễ</option>
              <option value="medium">Trung bình</option>
              <option value="hard">Khó</option>
            </select>
          </div>
          {mode === "exam" && (
            <div>
              <label>Thời gian (phút, 0 = tự động)</label>
              <input type="number" min={0} value={minutes} onChange={(e) => setMinutes(Math.max(0, +e.target.value || 0))} />
            </div>
          )}
        </div>
        <label className="check"><input type="checkbox" checked={shuffleQ} onChange={(e) => setShuffleQ(e.target.checked)} /> Trộn thứ tự câu hỏi</label>
        <label className="check"><input type="checkbox" checked={shuffleO} onChange={(e) => setShuffleO(e.target.checked)} /> Trộn phương án (tự giữ nguyên với câu “All/None of the above”)</label>
      </div>
      <button className="btn primary big" disabled={!filtered.length} onClick={begin}>
        Bắt đầu {Math.min(count, filtered.length)} câu →
      </button>
      <p className="muted small center">Phím tắt: 1–9 hoặc A–H chọn đáp án · Enter kiểm tra/tiếp · F đánh dấu · ←/→ chuyển câu · Space lật thẻ</p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function relevantContext(docsText: string[], q: Question) {
  if (!docsText.length) return "";
  const words = new Set(normalize(q.question + " " + q.options.join(" ")).split(" ").filter((w) => w.length > 3));
  const paras = docsText.join("\n\n").split(/\n{2,}/);
  const scored = paras.map((p) => {
    const n = normalize(p).split(" ");
    let s = 0;
    for (const w of n) if (words.has(w)) s++;
    return { p, s: s / Math.sqrt(n.length + 5) };
  });
  scored.sort((a, b) => b.s - a.s);
  let out = "";
  for (const { p, s } of scored) {
    if (s <= 0 || out.length + p.length > 9000) break;
    out += p + "\n\n";
  }
  return out;
}

function AIExplain({ q, chosen }: { q: Question; chosen: number[] }) {
  const store = useStore();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { setText(""); setErr(""); }, [q.id]);
  if (!aiReady(store.settings)) return <a className="small" href="#/settings">Kết nối AI để nhận giải thích chi tiết →</a>;
  const run = async () => {
    setBusy(true);
    setErr("");
    try {
      const ctx = relevantContext(store.docs.filter((d) => d.deckId === q.deckId).map((d) => d.text), q);
      setText(await explainQuestion(store.settings, q, chosen, ctx));
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  };
  return (
    <div className="ai-explain">
      {!text && (
        <button className="btn sm" disabled={busy} onClick={run}>{busy ? <><Spinner /> AI đang phân tích…</> : "🤖 AI giải thích chi tiết"}</button>
      )}
      {err && <div className="callout bad small">{err}</div>}
      {text && <Markdown text={text} />}
    </div>
  );
}

export function Player() {
  const store = useStore();
  const [run] = useState<Run | null>(() => pendingRun);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number[]>>({}); // displayed indices
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [flipped, setFlipped] = useState(false);
  const [flashRes, setFlashRes] = useState<Record<number, number>>({});
  const [finished, setFinished] = useState(false);
  const [startAt] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [showPalette, setShowPalette] = useState(false);
  const recorded = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const items = run?.items ?? [];
  const item = items[idx];
  const isMulti = (it: RunItem) => it.q.answers.length > 1;
  const correctDisplayed = (it: RunItem) => it.order.map((orig, disp) => (it.q.answers.includes(orig) ? disp : -1)).filter((x) => x >= 0);
  const isCorrect = (i: number) => {
    const a = [...(answers[i] ?? [])].sort().join(",");
    return a === correctDisplayed(items[i]).sort().join(",");
  };
  const elapsed = Math.floor((now - startAt) / 1000);
  const remaining = run?.timeLimitSec ? run.timeLimitSec - elapsed : 0;

  const finish = useCallback(async () => {
    if (!run || recorded.current) return;
    recorded.current = true;
    let total = 0, correct = 0;
    const wrongIds: string[] = [];
    if (run.mode === "flash") {
      for (const [i, quality] of Object.entries(flashRes)) {
        total++;
        if (quality > 0) correct++;
        else wrongIds.push(items[+i].q.id);
      }
    } else {
      for (let i = 0; i < items.length; i++) {
        const answered = run.mode === "exam" ? !!answers[i]?.length : checked[i];
        if (!answered && run.mode === "practice") continue;
        total++;
        const ok = isCorrect(i);
        if (ok) correct++;
        else wrongIds.push(items[i].q.id);
        if (run.mode === "exam") await store.recordAnswer(items[i].q.id, ok);
      }
    }
    if (total) await store.addSession({ deckIds: run.deckIds, mode: run.mode, total, correct, durationSec: Math.floor((Date.now() - startAt) / 1000), at: Date.now(), wrongIds });
    setFinished(true);
  }, [run, items, answers, checked, flashRes, store, startAt]); // eslint-disable-line

  useEffect(() => {
    if (run?.mode === "exam" && run.timeLimitSec && remaining <= 0 && !finished) {
      store.toast("Hết giờ! Bài đã được nộp.", "info");
      finish();
    }
  }, [remaining]); // eslint-disable-line

  const choose = (disp: number) => {
    if (!item || finished) return;
    if (run!.mode === "practice" && checked[idx]) return;
    const cur = answers[idx] ?? [];
    const next = isMulti(item) ? (cur.includes(disp) ? cur.filter((x) => x !== disp) : [...cur, disp]) : [disp];
    setAnswers({ ...answers, [idx]: next });
    if (run!.mode === "practice" && !isMulti(item)) check(next);
  };

  const check = (ans = answers[idx]) => {
    if (!ans?.length || checked[idx]) return;
    setChecked((c) => ({ ...c, [idx]: true }));
    const ok = [...ans].sort().join(",") === correctDisplayed(item).sort().join(",");
    store.recordAnswer(item.q.id, ok);
  };

  const next = () => {
    if (idx < items.length - 1) {
      setIdx(idx + 1);
      setFlipped(false);
    } else finish();
  };

  const rateFlash = (quality: number) => {
    setFlashRes((r) => ({ ...r, [idx]: quality }));
    store.recordAnswer(item.q.id, quality > 0, quality);
    next();
  };

  useEffect(() => {
    if (!run || finished) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName?.match(/INPUT|TEXTAREA|SELECT/)) return;
      const k = e.key.toLowerCase();
      if (run.mode === "flash") {
        if (k === " " || k === "enter") { e.preventDefault(); if (!flipped) setFlipped(true); else rateFlash(2); }
        else if (flipped && ["1", "2", "3", "4"].includes(k)) rateFlash(+k - 1);
        return;
      }
      const n = /^[1-9]$/.test(k) ? +k - 1 : /^[a-h]$/.test(k) ? k.charCodeAt(0) - 97 : -1;
      if (n >= 0 && n < item.order.length) choose(n);
      else if (k === "enter") {
        e.preventDefault();
        if (run.mode === "practice") checked[idx] ? next() : check();
        else next();
      } else if (k === "arrowright" && (run.mode === "exam" || checked[idx])) next();
      else if (k === "arrowleft" && idx > 0) setIdx(idx - 1);
      else if (k === "f") store.toggleFlag(item.q.id);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  if (!run) {
    return (
      <div className="page">
        <Empty icon="🎯" title="Không có lượt làm bài đang mở">
          <button className="btn primary" onClick={() => go("practice")}>Bắt đầu luyện tập</button>
        </Empty>
      </div>
    );
  }

  if (finished) return <Results run={run} answers={answers} checked={checked} flashRes={flashRes} isCorrect={isCorrect} elapsed={elapsed} />;

  const deck = store.decks.find((d) => d.id === item.q.deckId);
  const p = store.progress[item.q.id];
  const answeredCount = run.mode === "flash" ? Object.keys(flashRes).length : run.mode === "exam" ? Object.values(answers).filter((a) => a.length).length : Object.keys(checked).length;
  const correctSoFar = Object.keys(checked).filter((i) => isCorrect(+i)).length;
  const isChecked = run.mode === "practice" && checked[idx];
  const showAnswer = isChecked || (run.mode === "flash" && flipped);
  const cd = correctDisplayed(item);
  const mine = answers[idx] ?? [];

  return (
    <div className="player">
      <div className="player-top">
        <button className="btn ghost sm" onClick={() => {
          if (answeredCount && !confirm("Kết thúc lượt làm bài? Kết quả các câu đã làm vẫn được lưu.")) return;
          answeredCount ? finish() : history.back();
        }}>✕ {answeredCount ? "Kết thúc" : "Thoát"}</button>
        <div className="grow center">
          <b>{run.title}</b>
          <div className="muted small">{run.mode === "exam" ? "Thi thử" : run.mode === "flash" ? "Thẻ ghi nhớ" : "Luyện tập"} · Câu {idx + 1}/{items.length}{run.mode === "practice" && answeredCount > 0 && ` · Đúng ${correctSoFar}/${answeredCount}`}</div>
        </div>
        {run.mode === "exam" ? (
          <div className={"timer" + (remaining < 60 ? " low" : "")}>⏱ {fmtDuration(Math.max(0, remaining))}</div>
        ) : (
          <div className="timer muted">⏱ {fmtDuration(elapsed)}</div>
        )}
      </div>
      <div className="bar thin"><span style={{ width: `${(answeredCount / items.length) * 100}%` }} /></div>

      <div className="player-body">
        <div className={"qcard" + (run.mode === "flash" ? " flash" + (flipped ? " flipped" : "") : "")} onClick={() => run.mode === "flash" && !flipped && setFlipped(true)}>
          <div className="row between small muted">
            <span>{deck?.emoji} {deck?.name}{item.q.topic && ` · ${item.q.topic}`}</span>
            <span className="row gap">
              <DiffBadge d={item.q.difficulty} />
              {p?.attempts ? <span>{p.correct}/{p.attempts} đúng trước đó</span> : <span>Câu mới</span>}
              <button className={"icon-btn" + (p?.flagged ? " flag-on" : "")} title="Đánh dấu (F)" onClick={(e) => { e.stopPropagation(); store.toggleFlag(item.q.id); }}>⚑</button>
            </span>
          </div>
          <div className="qbig">{item.q.question}</div>
          {isMulti(item) && run.mode !== "flash" && <div className="pill">Chọn {item.q.answers.length} đáp án</div>}
          {item.q.image && <img className="qimg" src={item.q.image} alt="" />}

          <div className="choices">
            {item.order.map((orig, disp) => {
              const sel = mine.includes(disp);
              const ok = cd.includes(disp);
              const cls = showAnswer ? (ok ? " right" : sel ? " wrong" : " dim") : sel ? " sel" : "";
              return (
                <button key={disp} className={"choice" + cls} onClick={(e) => { e.stopPropagation(); if (run.mode !== "flash") choose(disp); }} disabled={run.mode === "flash"}>
                  <span className="key">{letter(disp)}</span>
                  <span className="grow">{item.q.options[orig]}</span>
                  {showAnswer && ok && <span>✓</span>}
                  {showAnswer && sel && !ok && <span>✗</span>}
                </button>
              );
            })}
          </div>

          {run.mode === "flash" && !flipped && <div className="flip-hint">Nhấn để lật thẻ (Space)</div>}

          {showAnswer && (
            <div className={"feedback" + (run.mode === "practice" ? (isCorrect(idx) ? " ok" : " no") : "")}>
              {run.mode === "practice" && <b>{isCorrect(idx) ? "🎉 Chính xác!" : `❌ Chưa đúng — đáp án: ${cd.map(letter).join(", ")}`}</b>}
              {run.mode === "flash" && <b>Đáp án: {cd.map(letter).join(", ")}</b>}
              {item.q.explanation && <p>{item.q.explanation}</p>}
              {item.q.source && <div className="muted small">Nguồn: {item.q.source}</div>}
              {p && run.mode === "practice" && <div className="muted small">Ôn lại sau: {formatInterval(p.interval)}</div>}
              <AIExplain q={item.q} chosen={mine.map((d) => item.order[d])} />
            </div>
          )}
        </div>

        <div className="player-actions">
          {run.mode === "flash" ? (
            flipped ? (
              <div className="rate">
                {[["Quên", 0, "bad"], ["Khó", 1, "warn"], ["Tốt", 2, "good"], ["Dễ", 3, "accent"]].map(([label, q, tone]) => (
                  <button key={label as string} className={"btn " + tone} onClick={() => rateFlash(q as number)}>
                    {label as string}
                    <small>{formatInterval(grade(p, item.q.id, (q as number) > 0, q as number).interval)}</small>
                  </button>
                ))}
              </div>
            ) : (
              <button className="btn primary big" onClick={() => setFlipped(true)}>Lật thẻ</button>
            )
          ) : run.mode === "practice" ? (
            <>
              <button className="btn ghost" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>← Trước</button>
              {isChecked ? (
                <button className="btn primary big" onClick={next}>{idx === items.length - 1 ? "Xem kết quả" : "Câu tiếp →"}</button>
              ) : (
                <button className="btn primary big" disabled={!mine.length} onClick={() => check()}>Kiểm tra</button>
              )}
              {!isChecked && <button className="btn ghost" onClick={next}>Bỏ qua</button>}
            </>
          ) : (
            <>
              <button className="btn ghost" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>← Trước</button>
              <button className="btn" onClick={() => setShowPalette(!showPalette)}>☰ {answeredCount}/{items.length}</button>
              {idx < items.length - 1 ? (
                <button className="btn primary" onClick={next}>Tiếp →</button>
              ) : (
                <button className="btn primary" onClick={() => {
                  const left = items.length - answeredCount;
                  if (left && !confirm(`Còn ${left} câu chưa làm. Nộp bài?`)) return;
                  finish();
                }}>Nộp bài</button>
              )}
            </>
          )}
        </div>

        {(run.mode === "exam" && showPalette) || (run.mode === "exam" && items.length <= 60) ? (
          <div className="palette">
            {items.map((it, i) => (
              <button key={i} className={(i === idx ? "cur " : "") + (answers[i]?.length ? "done " : "") + (store.progress[it.q.id]?.flagged ? "flag" : "")} onClick={() => setIdx(i)}>{i + 1}</button>
            ))}
            <button className="btn primary sm" onClick={() => {
              const left = items.length - answeredCount;
              if (left && !confirm(`Còn ${left} câu chưa làm. Nộp bài?`)) return;
              finish();
            }}>Nộp bài</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Results({ run, answers, checked, flashRes, isCorrect, elapsed }: {
  run: Run;
  answers: Record<number, number[]>;
  checked: Record<number, boolean>;
  flashRes: Record<number, number>;
  isCorrect: (i: number) => boolean;
  elapsed: number;
}) {
  const [filter, setFilter] = useState<"all" | "wrong">("wrong");
  const rows = run.items.map((it, i) => {
    const done = run.mode === "flash" ? i in flashRes : run.mode === "exam" ? !!answers[i]?.length : !!checked[i];
    const ok = run.mode === "flash" ? (flashRes[i] ?? 0) > 0 : done && isCorrect(i);
    return { it, i, done, ok };
  });
  const done = rows.filter((r) => r.done || run.mode === "exam");
  const correct = rows.filter((r) => r.ok).length;
  const total = run.mode === "exam" ? rows.length : done.length;
  const pct = total ? correct / total : 0;
  const wrongItems = rows.filter((r) => !r.ok && (r.done || run.mode === "exam")).map((r) => r.it);
  const score10 = Math.round(pct * 100) / 10;
  const shown = rows.filter((r) => (filter === "wrong" ? !r.ok && (r.done || run.mode === "exam") : true));

  const again = (items: RunItem[]) => startRun({ ...run, items: shuffle(items).map((x) => ({ ...x, order: shuffle(x.order) })) });

  return (
    <div className="page narrow">
      <div className="result-hero">
        <div className="score-ring" style={{ ["--p" as any]: pct, ["--tone" as any]: pct >= 0.8 ? "var(--good)" : pct >= 0.5 ? "var(--warn)" : "var(--bad)" }}>
          <div><b>{Math.round(pct * 100)}%</b><small>{correct}/{total}</small></div>
        </div>
        <div>
          <h1>{pct >= 0.9 ? "Xuất sắc! 🏆" : pct >= 0.7 ? "Làm tốt lắm! 👏" : pct >= 0.5 ? "Khá ổn, cố thêm chút! 💪" : "Cần ôn thêm 📚"}</h1>
          <p className="muted">
            {run.mode === "exam" && <>Điểm thang 10: <b>{score10}</b> · </>}Thời gian {fmtDuration(elapsed)} · TB {total ? Math.round(elapsed / total) : 0}s/câu
          </p>
          <div className="row gap wrap">
            {wrongItems.length > 0 && <button className="btn primary" onClick={() => again(wrongItems)}>🩹 Làm lại {wrongItems.length} câu sai</button>}
            <button className="btn" onClick={() => again(run.items)}>↻ Làm lại cả bộ</button>
            <button className="btn ghost" onClick={() => go(run.deckIds.length === 1 ? "deck/" + run.deckIds[0] : "practice")}>Xong</button>
          </div>
        </div>
      </div>
      <div className="row between">
        <h3>Xem lại bài</h3>
        <div className="seg">
          <button className={filter === "wrong" ? "on" : ""} onClick={() => setFilter("wrong")}>Câu sai ({wrongItems.length})</button>
          <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>Tất cả</button>
        </div>
      </div>
      <div className="stack">
        {shown.map(({ it, i, ok, done }) => {
          const mine = answers[i] ?? [];
          return (
            <div key={i} className={"card review " + (ok ? "ok" : "no")}>
              <div className="qtext"><b>{i + 1}.</b> {it.q.question} {!done && run.mode !== "flash" && <span className="pill">Bỏ trống</span>}</div>
              {it.q.image && <img className="qimg-small" src={it.q.image} alt="" />}
              <ol type="A" className="opts">
                {it.order.map((orig, disp) => (
                  <li key={disp} className={(it.q.answers.includes(orig) ? "correct " : "") + (mine.includes(disp) && !it.q.answers.includes(orig) ? "picked-wrong" : "")}>
                    {it.q.options[orig]} {mine.includes(disp) && <span className="muted">← bạn chọn</span>}
                  </li>
                ))}
              </ol>
              {it.q.explanation && <div className="explain-mini">💡 {it.q.explanation}</div>}
              {!ok && <AIExplain q={it.q} chosen={mine.map((d) => it.order[d])} />}
            </div>
          );
        })}
        {shown.length === 0 && <p className="muted center">Không có câu sai 🎉</p>}
      </div>
    </div>
  );
}
