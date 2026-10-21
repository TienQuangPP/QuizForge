// End-to-end tests for QuizForge, driving headless Edge over the DevTools protocol.
// Needs: `npm run build // Needs: `vite preview` on :4173 and the mock AI (mock.mjs) on :3199.// Needs: `vite preview` on :4173 and the mock AI (mock.mjs) on :3199. npx vite preview --port 4173` and `node tests/mock-ai.mjs` (port 3199).
// Run: node tests/e2e.mjs [filter]
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:4173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const only = process.argv[2];

const profile = process.env.TEMP + "\\qf-e2e-profile";
rmSync(profile, { recursive: true, force: true });
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`, "--remote-debugging-port=9334", "about:blank"], { stdio: "ignore" });
await sleep(2500);
const page = (await (await fetch("http://127.0.0.1:9334/json")).json()).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") errors.push("EXCEPTION " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).split("\n")[0]);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push("console.error " + m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 200));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

// Helpers available inside every page as window.T
const HELPERS = `
window.T = {
  sleep: (ms) => new Promise(r => setTimeout(r, ms)),
  btn: (t, root = document) => [...root.querySelectorAll('button, a.btn, label.btn')].find(b => b.textContent.includes(t) && !b.disabled),
  click: async (t, root) => { const b = T.btn(t, root); if (!b) throw new Error('Không thấy nút: ' + t); b.click(); await T.sleep(250); },
  set: (el, v) => { const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); },
  text: (s) => document.querySelector(s)?.innerText ?? null,
  all: (s) => [...document.querySelectorAll(s)].map(e => e.innerText),
  db: (store) => new Promise(res => { const r = indexedDB.open('quizforge'); r.onsuccess = () => { const q = r.result.transaction(store).objectStore(store).getAll(); q.onsuccess = () => { res(q.result); r.result.close(); }; }; }),
  drop: async (selector, files) => { const dt = new DataTransfer(); for (const [name, content, type] of files) dt.items.add(new File([content], name, { type })); document.querySelector(selector).dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true })); await T.sleep(800); },
  go: async (hash) => { location.hash = hash; await T.sleep(500); },
  // answer current question in the player correctly (or wrongly)
  answer: async (right = true) => {
    const qs = await T.db('questions');
    const q = qs.find(x => x.question === document.querySelector('.qbig').textContent);
    const ok = q.answers.map(a => q.options[a]);
    const choices = [...document.querySelectorAll('.choice')];
    if (right) { for (const c of choices) if (ok.includes(c.querySelector('.grow').textContent)) c.click(); }
    else choices.find(c => !ok.includes(c.querySelector('.grow').textContent)).click();
    await T.sleep(60);
    if (q.answers.length > 1 || !right) { const k = [...document.querySelectorAll('.player-actions button')].find(b => b.textContent === 'Kiểm tra'); k?.click(); }
    await T.sleep(120);
    return q.answers.length > 1;
  },
};`;

async function evaluate(expr) {
  const r = await send("Runtime.evaluate", { expression: `(async () => { ${HELPERS}\n${expr}\n})()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.split("\n")[0] ?? "eval error");
  return r.result?.result?.value;
}
async function open(hash = "") {
  await send("Page.navigate", { url: `${BASE}/?r=${Date.now()}#/${hash}` });
  for (let i = 0; i < 40; i++) {
    await sleep(200);
    try { if (await evaluate(`return !!document.querySelector('.shell') && !document.querySelector('.boot')`)) break; } catch { /* loading */ }
  }
  await sleep(300);
}

const results = [];
async function test(name, fn) {
  if (only && !name.includes(only)) return;
  const before = errors.length;
  try {
    const detail = await fn();
    const newErr = errors.slice(before);
    results.push({ name, ok: !newErr.length, detail: newErr.length ? newErr.join(" | ") : detail });
  } catch (e) {
    results.push({ name, ok: false, detail: e.message });
  }
  const r = results.at(-1);
  console.log(`${r.ok ? "✅" : "❌"} ${name}${r.detail ? " — " + (typeof r.detail === "string" ? r.detail : JSON.stringify(r.detail)) : ""}`);
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

// ---------------------------------------------------------------------------
await open();
await test("Màn hình chào mừng hiện cho người mới, chọn cỡ chữ, chơi thử", async () => {
  const r = await evaluate(`
    await T.sleep(300);
    const welcome = !!document.querySelector('.welcome');
    await T.click('Tiếp tục');
    [...document.querySelectorAll('.size-opt')][2].click(); await T.sleep(100);
    const fs = getComputedStyle(document.documentElement).fontSize;
    await T.click('Tiếp tục');
    await T.click('Chơi thử ngay'); await T.sleep(900);
    return { welcome, fs, hash: location.hash };`);
  expect(r.welcome, "không thấy màn hình chào mừng");
  expect(r.fs === "20.8px", "cỡ chữ không đổi: " + r.fs);
  expect(r.hash.startsWith("#/practice/"), "không chuyển tới luyện tập: " + r.hash);
  return r;
});

await evaluate(`localStorage.setItem('quizforge-settings-v1', JSON.stringify({ ...JSON.parse(localStorage.getItem('quizforge-settings-v1')||'{}'), fontScale: 1, sound: false, effects: false, provider: 'compatible', compatBaseUrl: 'http://127.0.0.1:3199/v1', compatModel: 'mock-1', compatKey: '' }))`);
await open();

await test("Luyện tập: làm hết bộ mẫu, kết quả + XP + phiên được lưu", async () => {
  const r = await evaluate(`
    const deck = (await T.db('decks'))[0];
    await T.go('#/practice/' + deck.id + '/practice');
    await T.click('Bắt đầu'); await T.sleep(300);
    let n = 0;
    while (document.querySelector('.qbig') && n < 20) { await T.answer(n % 3 !== 2); n++; await T.click(n >= 6 ? 'Xem kết quả' : 'Câu tiếp'); }
    const res = T.text('.result-hero');
    const sessions = await T.db('sessions');
    return { n, res: res?.replace(/\\n+/g, ' | '), sessions: sessions.length, run: localStorage.getItem('quizforge-run-v1') };`);
  expect(r.res && r.res.includes("4/6"), "kết quả sai: " + r.res);
  expect(r.sessions === 1, "không lưu phiên");
  expect(!r.run, "bài đã xong nhưng còn lưu bài dở");
  return r.res;
});

await test("Đua tốc độ: câu cuối cùng được tính vào kết quả", async () => {
  const r = await evaluate(`
    const deck = (await T.db('decks'))[0];
    await T.go('#/practice/' + deck.id + '/speed');
    await T.click('Bắt đầu'); await T.sleep(300);
    let n = 0;
    while (document.querySelector('.qbig') && n < 20) { await T.answer(true); n++; await T.sleep(800); }
    await T.sleep(400);
    return { n, res: T.text('.result-hero')?.replace(/\\n+/g, ' | ') };`);
  expect(r.res && r.res.includes(r.n + "/" + r.n), "thiếu câu cuối: trả lời " + r.n + " câu, kết quả " + r.res);
  return r.res;
});

await test("Sinh tồn: câu sai cuối cùng (mất mạng thứ 3) được tính", async () => {
  const r = await evaluate(`
    const deck = (await T.db('decks'))[0];
    await T.go('#/practice/' + deck.id + '/survival');
    await T.click('Bắt đầu'); await T.sleep(300);
    let n = 0;
    while (document.querySelector('.qbig') && n < 5) { await T.answer(false); n++; await T.sleep(1600); }
    await T.sleep(400);
    return { n, res: T.text('.result-hero')?.replace(/\\n+/g, ' | ') };`);
  expect(r.res && r.res.includes("0/3"), "kết quả sinh tồn sai: " + r.res);
  return r.res;
});

await test("Thi thử: Enter ở câu cuối phải hỏi xác nhận trước khi nộp", async () => {
  const r = await evaluate(`
    const deck = (await T.db('decks'))[0];
    await T.go('#/practice/' + deck.id + '/exam');
    await T.click('Bắt đầu'); await T.sleep(300);
    let asked = 0; window.confirm = () => { asked++; return false; };
    for (let i = 0; i < 10; i++) { dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); await T.sleep(120); }
    await T.sleep(300);
    const still = !!document.querySelector('.qbig');
    window.confirm = () => { asked++; return true; };
    dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); await T.sleep(500);
    return { asked, stillInExamAfterCancel: still, res: T.text('.result-hero')?.replace(/\\n+/g, ' | ') };`);
  expect(r.stillInExamAfterCancel, "đã nộp bài dù bấm Huỷ");
  expect(r.asked >= 1 && r.res, "không hỏi xác nhận hoặc không nộp được");
  return r.res;
});

await test("Thi thử hết giờ tự nộp bài", async () => {
  const r = await evaluate(`
    const qs = await T.db('questions');
    localStorage.setItem('quizforge-run-v1', JSON.stringify({ run: { mode: 'exam', deckIds: [qs[0].deckId], title: 'Hết giờ', timeLimitSec: 3, items: qs.slice(0, 3).map(q => ({ id: q.id, order: q.options.map((_, i) => i) })) }, idx: 0, answers: {}, checked: {}, flashRes: {}, elapsed: 0, combo: 0, bestCombo: 0, lives: 3, xp: 0 }));
    await T.go('#/'); await T.go('#/play'); await T.sleep(4500);
    return T.text('.result-hero')?.replace(/\\n+/g, ' | ');`);
  expect(r && r.includes("0/3"), "không tự nộp khi hết giờ: " + r);
  return r;
});

await test("Thẻ ghi nhớ: lật thẻ, chấm điểm, ghi tiến độ", async () => {
  const r = await evaluate(`
    const deck = (await T.db('decks'))[0];
    await T.go('#/practice/' + deck.id + '/flash');
    await T.click('Bắt đầu'); await T.sleep(300);
    let n = 0;
    while (document.querySelector('.qbig') && n < 10) { await T.click('Lật thẻ'); await T.click(n % 2 ? 'Nhớ' : 'Quên'); n++; }
    await T.sleep(300);
    return T.text('.result-hero')?.replace(/\\n+/g, ' | ');`);
  expect(r && r.includes("3/6"), "kết quả thẻ nhớ sai: " + r);
  return r;
});

await test("Bài dở: tải lại trang vẫn làm tiếp; xoá hết câu thì nút Làm tiếp biến mất", async () => {
  const r1 = await evaluate(`
    const deck = (await T.db('decks'))[0];
    await T.go('#/practice/' + deck.id + '/practice');
    await T.click('Bắt đầu'); await T.sleep(300);
    await T.answer(true); await T.click('Câu tiếp'); await T.answer(true);
    return !!localStorage.getItem('quizforge-run-v1');`);
  expect(r1, "không lưu bài dở");
  await open("");
  const r2 = await evaluate(`return T.text('.callout.resume')`);
  expect(r2 && r2.includes("câu 2/"), "không thấy nút làm tiếp: " + r2);
  await open("play");
  const r3 = await evaluate(`return T.text('.player-top')?.replace(/\\n+/g,' | ')`);
  expect(r3 && r3.includes("Đúng 2/2"), "không khôi phục đúng tiến độ: " + r3);
  return r3;
});

await test("Nhập CSV + văn bản kiểu ChatGPT + JSON, cảnh báo thiếu đáp án", async () => {
  const r = await evaluate(`
    await T.go('#/import');
    T.set(document.querySelector('select'), '__new'); await T.sleep(100);
    T.set(document.querySelector('input[placeholder="Tên bộ đề mới"]'), 'Bộ nhập thử'); await T.sleep(50);
    const csv = 'question,A,B,C,D,answer,explanation,topic\\n"Thủ đô Pháp?",Paris,Lyon,Nice,Lille,A,Paris là thủ đô,Địa lý\\n"2+2?",3,4,5,6,B,,Toán';
    await T.drop('.dropzone', [['de.csv', csv, 'text/csv']]);
    const afterCsv = document.querySelectorAll('.draft').length;
    await T.click('Dán văn bản');
    T.set(document.querySelector('textarea'), '**Câu 1:** Màu của lá?\\n- A. Đỏ\\n- B. Xanh\\n**Đáp án:** B\\n\\n**Câu 2:** Không có đáp án?\\nA. x\\nB. y');
    await T.click('Nhận dạng câu hỏi');
    const afterPaste = document.querySelectorAll('.draft').length;
    const warn = [...document.querySelectorAll('.pill.bad')].map(p => p.textContent);
    let confirmMsg = ''; window.confirm = (m) => { confirmMsg = m; return true; };
    await T.click('Lưu'); await T.sleep(800);
    const qs = (await T.db('questions')).filter(q => q.question.includes('Thủ đô Pháp') || q.question.includes('Màu của lá'));
    return { afterCsv, afterPaste, warn, confirmMsg, hash: location.hash, saved: qs.sort((a, b) => a.question.localeCompare(b.question)).map(q => q.answers) };`);
  expect(r.afterCsv === 2 && r.afterPaste === 4, "số câu nhận sai: " + JSON.stringify(r));
  expect(r.confirmMsg.includes("1 câu CHƯA CÓ"), "không cảnh báo thiếu đáp án");
  expect(JSON.stringify(r.saved) === "[[1],[0]]", "đáp án lưu sai: " + JSON.stringify(r.saved));
  return r.hash;
});

await test("Tài liệu: tải TXT lên bộ đề", async () => {
  const r = await evaluate(`
    const deck = (await T.db('decks')).find(d => d.name === 'Bộ nhập thử');
    await T.go('#/deck/' + deck.id + '/docs');
    await T.drop('.dropzone', [['bai1.txt', 'Quang hợp là quá trình thực vật dùng ánh sáng để tạo glucose từ CO2 và nước. Pha sáng diễn ra ở màng thylakoid.', 'text/plain']]);
    return T.all('.doc-row b');`);
  expect(r.includes("bai1.txt"), "không thêm tài liệu");
  return r;
});

await test("Tạo đề bằng AI (giả lập) từ tài liệu → lưu", async () => {
  const r = await evaluate(`
    const deck = (await T.db('decks')).find(d => d.name === 'Bộ nhập thử');
    await T.go('#/studio/' + deck.id);
    T.set(document.querySelector('input[type=number]'), '3'); await T.sleep(100);
    await T.click('Tạo 3 câu hỏi'); await T.sleep(1500);
    const drafts = document.querySelectorAll('.draft').length;
    await T.click('Lưu 3 câu'); await T.sleep(600);
    return { drafts, hash: location.hash, count: (await T.db('questions')).filter(q => q.deckId === deck.id).length };`);
  expect(r.drafts === 3 && r.count === 7, "tạo đề lỗi: " + JSON.stringify(r));
  return r;
});

await test("Sổ tay lý thuyết: AI soạn, đổi thứ tự ↑↓, đánh dấu đã học, luyện theo chủ đề", async () => {
  const r = await evaluate(`
    const deck = (await T.db('decks')).find(d => d.name === 'Bộ nhập thử');
    await T.go('#/deck/' + deck.id + '/theory');
    await T.click('AI soạn sổ tay'); await T.click('Bắt đầu soạn'); await T.sleep(1500);
    const before = T.all('.toc-item b');
    document.querySelector('.toc-item:nth-of-type(2)').click(); await T.sleep(150);
    document.querySelector('.note-tools button[title="Lên trên"]').click(); await T.sleep(400);
    const after = T.all('.toc-item b');
    await T.click('Tôi đã hiểu'); await T.sleep(200);
    const prog = T.text('.theory-progress');
    return { before, after, prog };`);
  expect(r.before.length === 3, "không soạn được: " + JSON.stringify(r.before));
  expect(r.after[0] === r.before[1] && r.after[1] === r.before[0], "đổi thứ tự không chạy: " + JSON.stringify(r));
  return r;
});

await test("Hoàn tác xoá câu hỏi", async () => {
  const r = await evaluate(`
    const deck = (await T.db('decks')).find(d => d.name === 'Bộ nhập thử');
    await T.go('#/deck/' + deck.id + '/questions');
    const n0 = (await T.db('questions')).length;
    document.querySelector('.qrow input[type=checkbox]').click(); await T.sleep(100);
    window.confirm = () => true;
    await T.click('🗑 Xoá'); await T.sleep(300);
    const n1 = (await T.db('questions')).length;
    await T.click('Hoàn tác'); await T.sleep(400);
    const n2 = (await T.db('questions')).length;
    return { n0, n1, n2 };`);
  expect(r.n1 === r.n0 - 1 && r.n2 === r.n0, "hoàn tác lỗi: " + JSON.stringify(r));
  return r;
});

await test("AI bên ngoài: dán JSON + lý thuyết Markdown", async () => {
  const r = await evaluate(`
    const deck = (await T.db('decks')).find(d => d.name === 'Bộ nhập thử');
    await T.go('#/import/' + deck.id + '/external');
    const ta = [...document.querySelectorAll('.ext textarea')].pop();
    T.set(ta, 'Đây:\\n\\\`\\\`\\\`json\\n{"questions":[{"question":"Câu JSON ngoài?","options":["A. Một","B. Hai"],"answer":"B"}]}\\n\\\`\\\`\\\`');
    await T.click('Nhận dạng câu hỏi');
    const drafts = T.all('.draft');
    await T.go('#/import/' + deck.id + '/external-theory');
    const ta2 = [...document.querySelectorAll('.ext textarea')].pop();
    T.set(ta2, '## Chủ đề ngoài\\n> Tóm tắt\\n### Ý chính\\n- a');
    await T.click('Nhận dạng lý thuyết');
    await T.click('Lưu 1 chủ đề'); await T.sleep(600);
    return { drafts, hash: location.hash, toc: T.all('.toc-item b') };`);
  expect(r.drafts.length === 1 && r.drafts[0].includes("Hai"), "không nhận JSON: " + JSON.stringify(r.drafts));
  expect(r.toc.includes("Chủ đề ngoài"), "không lưu lý thuyết ngoài");
  return r.toc;
});

await test("Gia sư AI (giả lập) trả lời", async () => {
  const r = await evaluate(`
    await T.go('#/tutor');
    T.set(document.querySelector('.composer textarea'), 'Giải thích quang hợp'); await T.sleep(50);
    await T.click('Gửi'); await T.sleep(1200);
    return T.all('.msg').length;`);
  expect(r >= 2, "gia sư không trả lời");
  return r + " tin nhắn";
});

await test("Sao lưu → xoá toàn bộ → khôi phục", async () => {
  const r = await evaluate(`
    let blobUrl = null;
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.download) blobUrl = this.href; else orig.call(this); };
    await T.go('#/settings');
    await T.click('Sao lưu toàn bộ'); await T.sleep(200);
    const json = await (await fetch(blobUrl)).text();
    HTMLAnchorElement.prototype.click = orig;
    const before = (await T.db('questions')).length;
    window.confirm = () => true;
    await T.click('Xoá toàn bộ dữ liệu'); await T.sleep(500);
    const wiped = (await T.db('questions')).length;
    const input = document.querySelector('input[type=file][accept=".json"]');
    const dt = new DataTransfer(); dt.items.add(new File([json], 'b.json', { type: 'application/json' }));
    input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); await T.sleep(1200);
    const after = (await T.db('questions')).length;
    const notes = (await T.db('notes')).length;
    return { before, wiped, after, notes };`);
  expect(r.wiped === 0 && r.after === r.before && r.notes > 0, "sao lưu/khôi phục lỗi: " + JSON.stringify(r));
  return r;
});

await test("Xuất CSV bộ đề + in đề không lỗi", async () => {
  const r = await evaluate(`
    let csv = null;
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.download) csv = this.href; else orig.call(this); };
    const deck = (await T.db('decks')).find(d => d.name === 'Bộ nhập thử');
    await T.go('#/deck/' + deck.id);
    await T.click('Xuất / In'); await T.click('CSV / Excel');
    const text = await (await fetch(csv)).text();
    HTMLAnchorElement.prototype.click = orig;
    return text.split('\\n').length;`);
  expect(r >= 5, "CSV quá ít dòng: " + r);
  return r + " dòng";
});

await test("Bài dở có câu bị xoá: không sập, xoá hết thì nút Làm tiếp biến mất", async () => {
  await evaluate(`
    const deck = (await T.db('decks')).find(d => d.name === 'Bộ nhập thử');
    await T.go('#/practice/' + deck.id + '/practice');
    await T.click('Bắt đầu'); await T.sleep(300);
    await T.answer(true);`);
  // delete one question of the paused run, then reopen the player
  await evaluate(`
    const run = JSON.parse(localStorage.getItem('quizforge-run-v1'));
    await new Promise(res => { const r = indexedDB.open('quizforge'); r.onsuccess = () => { const t = r.result.transaction('questions', 'readwrite'); t.objectStore('questions').delete(run.run.items[run.run.items.length - 1].id); t.oncomplete = () => { r.result.close(); res(); }; }; });`);
  await open("play");
  const a = await evaluate(`return !!document.querySelector('.qbig')`);
  expect(a, "mở lại bài dở bị lỗi sau khi xoá 1 câu");
  // delete every question of the run → dashboard must not offer to resume
  await evaluate(`
    const run = JSON.parse(localStorage.getItem('quizforge-run-v1'));
    await new Promise(res => { const r = indexedDB.open('quizforge'); r.onsuccess = () => { const t = r.result.transaction('questions', 'readwrite'); for (const it of run.run.items) t.objectStore('questions').delete(it.id); t.oncomplete = () => { r.result.close(); res(); }; }; });`);
  await open("");
  const b = await evaluate(`return { resume: !!document.querySelector('.callout.resume'), saved: !!localStorage.getItem('quizforge-run-v1') }`);
  expect(!b.resume && !b.saved, "vẫn còn nút làm tiếp: " + JSON.stringify(b));
  return b;
});

// Every page at phone width: no horizontal overflow
await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
const decksForMobile = await evaluate(`return (await T.db('decks')).map(d => d.id)`);
for (const hash of ["", "library", "studio", "import", "import/x/external", "practice", "tutor", "achievements", "stats", "help", "settings", `deck/${decksForMobile[0]}`, `deck/${decksForMobile[0]}/theory`, `deck/${decksForMobile[0]}/docs`, `deck/${decksForMobile[0]}/stats`]) {
  await test(`Điện thoại: #/${hash} không tràn ngang`, async () => {
    await open(hash);
    const r = await evaluate(`
      const vw = document.documentElement.clientWidth;
      const wide = [...document.querySelectorAll('body *')].filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > vw + 1 && !e.closest('.side, .toasts, .md-table, .thumbs, pre'); }).slice(0, 3).map(e => e.tagName + '.' + e.className + ' →' + Math.round(e.getBoundingClientRect().right));
      return { scroll: document.documentElement.scrollWidth, vw, wide };`);
    expect(r.scroll <= r.vw + 1 && !r.wide.length, "tràn: " + JSON.stringify(r));
  });
}

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} bài kiểm tra đạt`);
ws.close();
edge.kill();
process.exit(0);
