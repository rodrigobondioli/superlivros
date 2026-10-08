// Fumaca do motor contra o Gemini DE VERDADE: roda o worker.js local (sem publicar) e chama
// uma vez cada rota que fala com o modelo. Confere que nenhuma chamada manda parametro
// aposentado (temperature, topP, topK, thinkingBudget) e que cada resposta volta em JSON.
//   GEMINI_API_KEY=... node testes/fumaca-gemini.mjs
// Custa centavos (~13 chamadas no Flash, 1 tentativa no Pro). Nao entra no `node --test`.
import io from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../worker/worker.js";

if (!process.env.GEMINI_API_KEY) { console.error("Falta GEMINI_API_KEY no ambiente."); process.exit(1); }
const RAIZ = new URL("../", import.meta.url);
const SITE = "https://site.local";
const PROIBIDOS = ["temperature", "topP", "top_p", "topK", "top_k", "thinkingBudget", "thinking_budget"];

/* ---------- dados reais da estante ---------- */
const html = io.readFileSync(new URL("index.html", RAIZ), "utf8");
const MENTES = JSON.parse(/const MENTES = (\[.*?\]);\n/s.exec(html)[1]);
const BOOKS = JSON.parse(/const BOOKS = (\[.*?\]);\n/s.exec(html)[1]);
const roster = MENTES.slice(0, 60).map((m, i) => ({ i, id: m.id, autor: m.autor, titulo: m.titulo, dominio: m.dominio, tese: m.tese, convoque: m.convoque }));
const mesa = MENTES.slice(0, 3).map((m) => ({ id: m.id, autor: m.autor, titulo: m.titulo, dossie: m.md }));
const livro = BOOKS.find((b) => b.txt && b.txt.length > 2000) || BOOKS[0];
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const problema = "Tenho um estudio de design com 3 pessoas, cobro por projeto e vivo de indicacao. Quero parar de depender de indicacao e cobrar mais caro sem perder os clientes atuais.";

/* ---------- fetch: site local, Gemini real com inspecao ---------- */
const chamadasGemini = [];
const fetchReal = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith(SITE + "/")) {
    const arq = new URL(u.slice(SITE.length + 1).split("?")[0], RAIZ);
    return io.existsSync(arq) ? new Response(io.readFileSync(arq)) : new Response("nao achei", { status: 404 });
  }
  if (u.includes("generativelanguage.googleapis.com")) {
    const corpo = JSON.parse(init.body);
    const gc = corpo.generationConfig || {};
    const reg = { modelo: /models\/([^:]+):/.exec(u)[1], generationConfig: gc, proibidos: PROIBIDOS.filter((k) => k in gc || (gc.thinkingConfig && k in gc.thinkingConfig)) };
    chamadasGemini.push(reg);
    const r = await fetchReal(url, init);
    const j = await r.clone().json().catch(() => null);
    reg.http = r.status;
    try {
      reg.finishReason = j.candidates[0].finishReason;
      const txt = j.candidates[0].content.parts.map((p) => p.text || "").join("");
      reg.jsonValido = (() => { try { JSON.parse(txt); return true; } catch { return false; } })();
      reg.chaves = reg.jsonValido ? Object.keys(JSON.parse(txt)).join(",") : txt.slice(0, 80);
    } catch { reg.erro = (j && j.error && j.error.message || "").slice(0, 160); }
    return r;
  }
  throw new Error("fetch inesperado: " + u);
};

/* ---------- D1 de mentira em cima do SQLite (igual ao pautas-motor.test.mjs) ---------- */
function d1(db) {
  const stmt = (sql, params) => ({
    bind: (...p) => stmt(sql, p),
    async first(col) { const row = db.prepare(sql).get(...params); if (row == null) return null; return col ? row[col] : row; },
    async all() {
      if (/^\s*(select|with|pragma)/i.test(sql)) return { success: true, results: db.prepare(sql).all(...params), meta: {} };
      const r = db.prepare(sql).run(...params);
      return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
    async run() { return this.all(); },
  });
  return { prepare: (sql) => stmt(sql, []), async batch(xs) { const out = []; for (const s of xs) out.push(await s.all()); return out; } };
}
const env = { DB: d1(new DatabaseSync(":memory:")), GEMINI_API_KEY: process.env.GEMINI_API_KEY, SITE_URL: SITE };
const ctx = { waitUntil() {} };
async function chama(path, body) {
  const corpo = JSON.stringify(body);
  const r = await worker.fetch(new Request("https://motor.local" + path, { method: "POST", headers: { Origin: "https://superlivros.rodrigobondioli.com", "Content-Type": "application/json", "Content-Length": String(corpo.length) }, body: corpo }), env, ctx);
  return { status: r.status, j: await r.json().catch(() => ({})) };
}

/* ---------- um caso por rota ---------- */
const casos = [
  ["/brief", { text: "Estudio Ponto, design de marca para restaurantes em SP. Ticket medio R$ 18 mil, 3 socios, 70% dos clientes vem de indicacao. Meta: R$ 80 mil/mes ate dezembro sem contratar." }, (j) => j.brief && !j.brief.startsWith("Estudio Ponto")],
  ["/mente", { titulo: livro.titulo, autor: livro.autor, text: String(livro.txt || livro.desc || "").slice(0, 8000) }, (j) => j.tese && j.md && j.cat],
  ["/cast", { problem: problema, roster }, (j) => Array.isArray(j.picks) && j.picks.length >= 1],
  ["/orient", { problem: problema, mentes: mesa }, (j) => Array.isArray(j.caminhos) && j.caminhos.length >= 1 && j.abertura],
  ["/council", { problem: problema, mentes: mesa.map((m) => ({ ...m })), history: [{ role: "user", text: problema }] }, (j) => Array.isArray(j.replies) && j.replies.length >= 1 && j.replies[0].txt],
  ["/verdict", { mentes: mesa, history: [{ role: "user", text: problema }] }, (j) => j.recomendacao && j.primeiro_passo],
  ["/ask", { titulo: mesa[0].titulo, autor: mesa[0].autor, dossie: mesa[0].dossie, question: "O que voce acha desta imagem e do meu problema? " + problema, images: [{ mime: "image/png", data: PNG }] }, (j) => j.resposta],
  ["/librarian", { query: "quero aprender a cobrar mais caro", roster }, (j) => Array.isArray(j.picks) && j.picks.length >= 1],
  ["/gen", { type: "frases", book: { titulo: livro.titulo, autor: livro.autor, cat: livro.cat, desc: livro.desc, muda: livro.muda, ganchos: livro.ganchos, txt: String(livro.txt || "").slice(0, 6000) } }, (j) => Array.isArray(j.frases) && j.frases.length >= 3],
  ["/pautas/gerar", {}, (j) => Array.isArray(j.pautas) && j.pautas.length >= 1],
];

let falhas = 0;
for (const [rota, body, ok] of casos) {
  const antes = chamadasGemini.length, t0 = Date.now();
  let r; try { r = await chama(rota, body); } catch (e) { r = { status: "excecao", j: { error: String(e) } }; }
  const minhas = chamadasGemini.slice(antes);
  const passou = r.status === 200 && !!ok(r.j) && minhas.length > 0 && minhas.every((c) => !c.proibidos.length);
  if (!passou) falhas++;
  console.log(`${passou ? "OK  " : "FALHOU"} ${rota.padEnd(14)} HTTP ${r.status}  ${((Date.now() - t0) / 1000).toFixed(1)}s  resposta: {${Object.keys(r.j).join(",")}}`);
  for (const c of minhas) console.log(`       └ ${c.modelo}  http ${c.http}  ${c.finishReason || ""}  json=${c.jsonValido}  config=${JSON.stringify(c.generationConfig)}${c.proibidos.length ? "  PROIBIDOS: " + c.proibidos : ""}${c.erro ? "  erro: " + c.erro : ""}  → {${c.chaves || ""}}`);
  if (!passou) console.log("       detalhe:", JSON.stringify(r.j).slice(0, 300));
}
const comProibido = chamadasGemini.filter((c) => c.proibidos.length).length;
console.log(`\n${chamadasGemini.length} chamadas ao Gemini, ${comProibido} com parametro aposentado, ${falhas} rota(s) falharam.`);
process.exit(falhas || comProibido ? 1 : 0);
