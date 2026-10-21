import { looseEqual } from "../src/course.ts";
const cases: [string, string, boolean][] = [
  ["CO2", "$O_2$", false], ["O2", "$O_2$", true], ["o2", "O2", true], ["ADP", "ATP", false],
  ["quang phan li", "quang phân li", true], ["quang phân ly", "quang phân li", true], ["thylakoid", "thylakoid", true],
  ["thylakoyd", "thylakoid", true], ["mang thylakoid", "màng thylakoid", true], ["36", "38", false], ["38 ATP", "38 ATP", true], ["", "ATP", false],
];
let ok = 0;
for (const [u, e, want] of cases) { const got = looseEqual(u, e); if (got === want) ok++; else console.log("❌", JSON.stringify(u), "vs", JSON.stringify(e), "→", got); }
console.log(`${ok}/${cases.length} trường hợp chấm điền khuyết đúng`);
