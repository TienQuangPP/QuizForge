// Assembles ../QuizForge_Portable (app + server + node runtime) and zips it.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const here = resolve(import.meta.dirname, "..");
const out = resolve(here, "..", "QuizForge_Portable");
const zip = out + ".zip";
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(resolve(here, "dist"), resolve(out, "app"), { recursive: true });
cpSync(resolve(here, "portable-src"), out, { recursive: true });
if (existsSync(resolve(here, "runtime", "node.exe"))) cpSync(resolve(here, "runtime"), resolve(out, "runtime"), { recursive: true });
else console.warn("runtime/node.exe missing: portable build will need Node installed.");
rmSync(zip, { force: true });
if (process.platform === "win32") {
  execFileSync("powershell.exe", ["-NoProfile", "-Command", `Compress-Archive -Path '${out}\*' -DestinationPath '${zip}' -CompressionLevel Optimal`], { stdio: "inherit" });
}
console.log("Portable ready:", out);
