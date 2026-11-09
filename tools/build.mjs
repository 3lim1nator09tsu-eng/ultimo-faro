// Crea dist/ultimo-faro.html: un solo file con gioco, stili e script.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

// esbuild dal progetto (npm install) oppure dagli strumenti preinstallati dell'ambiente di sviluppo.
let esbuild;
try {
  esbuild = createRequire(import.meta.url)("esbuild");
} catch {
  esbuild = createRequire("/opt/npm-tools/node_modules/")("esbuild");
}

const out = await esbuild.build({
  entryPoints: ["src/game-client/main.ts"],
  bundle: true,
  minify: !process.env.NOMIN,
  format: "iife",
  target: "es2020",
  write: false,
  charset: "utf8",
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html = readFileSync("src/game-client/template.html", "utf8").replace("/*BUNDLE*/", () => js);
writeFileSync("dist/ultimo-faro.html", html);
console.log(`dist/ultimo-faro.html ${(html.length / 1024).toFixed(1)} KB`);

// Versione autonoma (hosting web o APK): stessa pagina con intestazione completa e codifica dichiarata.
import { mkdirSync } from "node:fs";
mkdirSync("dist/web", { recursive: true });
const standalone = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0b171d"></head><body>${html}</body></html>`;
writeFileSync("dist/web/index.html", standalone);
// Copia per GitHub Pages (cartella docs del repository).
mkdirSync("docs", { recursive: true });
writeFileSync("docs/index.html", standalone);
writeFileSync("docs/.nojekyll", "");
console.log(`dist/web/index.html ${(standalone.length / 1024).toFixed(1)} KB`);
