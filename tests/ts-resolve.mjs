// Lets Node run the app's .ts sources directly: resolves "./x" to "./x.ts".
import { register } from "node:module";

const hook = `
export async function resolve(spec, ctx, next) {
  try {
    return await next(spec, ctx);
  } catch (e) {
    const last = spec.split("/").pop();
    if (spec.startsWith(".") && !last.includes(".")) return next(spec + ".ts", ctx);
    throw e;
  }
}`;
register("data:text/javascript," + encodeURIComponent(hook));
