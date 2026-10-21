// QuizForge portable server: serves the built app on 127.0.0.1 and opens the browser.
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "app");
const HOST = "127.0.0.1";
const FIRST_PORT = 3105;
const NAME = "QuizForge";
const noOpen = process.argv.includes("--no-open");

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
};

if (!existsSync(resolve(root, "index.html"))) {
  console.error("[LOI] Khong tim thay thu muc app. Hay giai nen day du goi QuizForge.");
  process.exit(1);
}

const openBrowser = (url) => {
  if (noOpen) return;
  const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd);
};

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/__health") {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end(NAME);
  }
  let path;
  try { path = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
  let file = resolve(root, "." + (path === "/" ? "/index.html" : path));
  if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); return res.end(); }
  if (!existsSync(file) || !statSync(file).isFile()) file = resolve(root, "index.html");
  res.writeHead(200, {
    "content-type": MIME[extname(file).toLowerCase()] || "application/octet-stream",
    "cache-control": file.includes(sep + "assets" + sep) ? "public, max-age=31536000, immutable" : "no-cache",
    "x-content-type-options": "nosniff",
  });
  createReadStream(file).pipe(res);
});

async function isOurs(port) {
  try {
    const r = await fetch(`http://${HOST}:${port}/__health`, { signal: AbortSignal.timeout(1500) });
    return (await r.text()) === NAME;
  } catch { return false; }
}

async function listen(port) {
  if (port > FIRST_PORT + 20) { console.error("[LOI] Khong tim duoc cong trong (3105-3125)."); process.exit(1); }
  if (await isOurs(port)) {
    console.log(`${NAME} da chay san tai http://${HOST}:${port} — mo trinh duyet.`);
    openBrowser(`http://${HOST}:${port}/`);
    setTimeout(() => process.exit(0), 500);
    return;
  }
  server.once("error", (e) => (e.code === "EADDRINUSE" ? listen(port + 1) : (console.error(e), process.exit(1))));
  server.listen(port, HOST, () => {
    const url = `http://${HOST}:${port}/`;
    console.log(`\n  ⚡ ${NAME} dang chay tai ${url}\n  Giu cua so nay mo trong khi hoc. Dong cua so (hoac chay STOP_QuizForge.bat) de tat.\n`);
    openBrowser(url);
  });
}
listen(FIRST_PORT);
