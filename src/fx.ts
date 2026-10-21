// Small delight helpers: confetti, sound effects and read-aloud. No dependencies.
import type { Settings } from "./types";

let fxSettings: Pick<Settings, "sound" | "effects" | "speechRate"> = { sound: true, effects: true, speechRate: 1 };
export const setFxSettings = (s: Settings) => (fxSettings = s);

export function confetti(amount = 120) {
  if (!fxSettings.effects || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const c = document.createElement("canvas");
  c.className = "confetti";
  c.width = innerWidth;
  c.height = innerHeight;
  document.body.appendChild(c);
  const ctx = c.getContext("2d")!;
  const colors = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#0ea5e9", "#ec4899", "#facc15"];
  const parts = Array.from({ length: amount }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * innerWidth * 0.4,
    y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 14 - 4,
    r: Math.random() * 6 + 4,
    rot: Math.random() * 6,
    vr: (Math.random() - 0.5) * 0.3,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  const start = performance.now();
  const frame = (t: number) => {
    const el = t - start;
    ctx.clearRect(0, 0, c.width, c.height);
    for (const p of parts) {
      p.vy += 0.35;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - el / 2200);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.r / 2, -p.r / 3, p.r, p.r * 0.66);
      ctx.restore();
    }
    if (el < 2200) requestAnimationFrame(frame);
    else c.remove();
  };
  requestAnimationFrame(frame);
}

let audio: AudioContext | null = null;
function tone(freq: number, at: number, dur: number, type: OscillatorType = "sine", vol = 0.12) {
  audio ??= new AudioContext();
  const o = audio.createOscillator();
  const g = audio.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = audio.currentTime + at;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(audio.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export function sound(kind: "right" | "wrong" | "level" | "combo" | "tick" | "badge") {
  if (!fxSettings.sound) return;
  try {
    if (kind === "right") { tone(660, 0, 0.12); tone(880, 0.09, 0.18); }
    if (kind === "wrong") { tone(220, 0, 0.25, "triangle", 0.1); tone(180, 0.12, 0.3, "triangle", 0.08); }
    if (kind === "combo") { tone(784, 0, 0.1); tone(988, 0.08, 0.1); tone(1175, 0.16, 0.2); }
    if (kind === "tick") tone(1000, 0, 0.05, "square", 0.04);
    if (kind === "level" || kind === "badge") [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.1, 0.25));
  } catch { /* audio not available */ }
}

export const canSpeak = () => typeof speechSynthesis !== "undefined";

export function speak(text: string) {
  if (!canSpeak()) return;
  speechSynthesis.cancel();
  const vi = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(text);
  const u = new SpeechSynthesisUtterance(text);
  u.lang = vi ? "vi-VN" : "en-US";
  const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(vi ? "vi" : "en"));
  if (voice) u.voice = voice;
  u.rate = fxSettings.speechRate;
  speechSynthesis.speak(u);
}

export const stopSpeaking = () => canSpeak() && speechSynthesis.cancel();
