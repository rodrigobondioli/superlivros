// Claude no motor (docs/claude-no-motor-prompt.md): /council, /verdict e pautas no Claude, o resto no Gemini.
//   node --test testes/claude-motor.test.mjs
// Anthropic e Gemini simulados, D1 de verdade (SQLite do Node). Nao toca na rede nem no motor publicado.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import worker from "../worker/worker.js";

const ORIGEM = "https://superlivros.rodrigobondioli.com";
const SITE = "https://site.teste";
const SONNET = "claude-sonnet-5-5", OPUS = "claude-opus-5-5";
const FLASH = "gemini-3.8-flash", PRO = "gemini-3.1-pro-preview";

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

/* ---------- uma resposta que serve pra qualquer rota ---------- */
const TIPOS = ["contraintuitivo", "mito", "framework", "pergunta", "erro", "caso", "frase"];
const pauta = (i, de) => ({ tipo: TIPOS[i % 7], gancho: `${de} ${i + 1} com gancho bom`, insight: `Insight ${i + 1} com substancia suficiente pra passar no filtro.`, ancora: "Capitulo " + (i + 1) });
const TUDO = {
  replies: [{ autor: "Autora A", livro: "Livro A", txt: "Fala <b>afiada</b>.", quote: "q", quote_orig: "" }], sugeridos: [], deriva: "",
  sintese: "s", tradeoff: "t", recomendacao: "r", primeiro_passo: "p", alternativa: "",
  picks: [{ i: 0, motivo: "m" }], angulos: "a", falta: "", intro: "i",
  abertura: "a", caminhos: [{ rotulo: "r", desc: "d" }], pergunta: "p",
  brief: "briefing condensado", resposta: "resposta", termos: ["preco", "pricing"],
  cat: "Design", dominio: "d", tese: "t", convoque: "c", desc: "d", md: "# md",
  frases: ["um", "dois", "tres"], posts: [{}, {}, {}],
  candidatas: Array.from({ length: 15 }, (_, i) => pauta(i, "Candidata")),
  pautas: Array.from({ length: 5 }, (_, i) => pauta(i, "Escolhida")),
};

/* ---------- fetch simulado ---------- */
const sim = { claude: "ok", chamadas: [] };
const USO = { input_tokens: 1200, output_tokens: 340, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
function claudeResp(texto, extra) {
  return new Response(JSON.stringify(Object.assign({ id: "msg_1", type: "message", role: "assistant", model: extra && extra.model,
    content: [{ type: "thinking", thinking: "", signature: "x" }, { type: "text", text: texto }], stop_reason: "end_turn", usage: USO }, extra || {})), { status: 200 });
}
function erroClaude(status, type, message) { return new Response(JSON.stringify({ type: "error", error: { type, message } }), { status }); }
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith(SITE + "/data/catalogo-pautas.json")) return new Response(JSON.stringify([{ hash: "aaaa1", titulo: "Livro A", autor: "Autora A", cat: "Design" }]));
  if (u.startsWith(SITE + "/data/catalogo-pautas-texto.ndjson")) return new Response("");
  if (u === "https://api.anthropic.com/v1/messages") {
    const body = JSON.parse(init.body);
    sim.chamadas.push({ ia: "claude", modelo: body.model, body, headers: init.headers });
    const m = sim.claude;
    if (m === "timeout") { const e = new Error("abortou"); e.name = "AbortError"; throw e; }
    if (m === "rede") throw new TypeError("fetch failed");
    if (m === 429) return erroClaude(429, "rate_limit_error", "devagar");
    if (m === 500) return erroClaude(500, "api_error", "deu ruim");
    if (m === 529) return erroClaude(529, "overloaded_error", "lotado");
    if (m === 401) return erroClaude(401, "authentication_error", "invalid x-api-key");
    if (m === "credito") return erroClaude(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API.");
    if (m === 400) return erroClaude(400, "invalid_request_error", "outra coisa");
    if (m === "max_tokens") return claudeResp('{"replies":[{"autor":"Autora A","txt":"cor', { model: body.model, stop_reason: "max_tokens" });
    if (m === "recusa") return claudeResp("", { model: body.model, content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: "general_harms" } });
    if (m === "cercas") return claudeResp("Aqui está o JSON:\n```json\n" + JSON.stringify(TUDO) + "\n```\nQualquer coisa me fala.", { model: body.model });
    if (m === "lixo") return claudeResp("desculpa, nao consigo", { model: body.model });
    return claudeResp(JSON.stringify(TUDO), { model: body.model });
  }
  if (u.includes("generativelanguage.googleapis.com")) {
    const modelo = /models\/([^:]+):/.exec(u)[1];
    const body = JSON.parse(init.body);
    // a busca de termos do retrieval (termosDeBusca) roda antes do conselho e fica no Gemini por desenho
    const termos = /Extraia termos de busca/.test(body.contents[0].parts[0].text);
    sim.chamadas.push({ ia: termos ? "gemini:termos" : "gemini", modelo, body });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(TUDO) }] }, finishReason: "STOP" }] }), { status: 200 });
  }
  throw new Error("fetch inesperado: " + u);
};

/* ---------- ambiente ---------- */
const db = new DatabaseSync(":memory:"), dbT = new DatabaseSync(":memory:");
dbT.exec("CREATE TABLE IF NOT EXISTS trechos (id TEXT, livro TEXT, txt TEXT)");
dbT.exec("CREATE VIRTUAL TABLE IF NOT EXISTS busca USING fts5(livro, txt, content='trechos', content_rowid='rowid', tokenize='porter unicode61 remove_diacritics 2')");
dbT.exec("CREATE TRIGGER IF NOT EXISTS trechos_ai AFTER INSERT ON trechos BEGIN INSERT INTO busca(rowid, livro, txt) VALUES (new.rowid, new.livro, new.txt); END");
const ins = dbT.prepare("INSERT INTO trechos (id, livro, txt) VALUES (?,?,?)");
for (let k = 0; k < 80; k++) ins.run(`aaaa1-${k}`, "aaaa1", `TRECHO ${k} do livro A. ` + "Texto de enchimento pra parecer um trecho do livro. ".repeat(6));

const BASE = { DB: d1(db), TRECHOS: d1(dbT), GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a", INDEX_KEY: "segredo", SITE_URL: SITE, IA_COUNCIL: "claude", IA_VERDICT: "claude", IA_PAUTAS: "claude" };
let env = { ...BASE };
let pend = [];
const ctx = { waitUntil(p) { pend.push(p); } };
async function chama(path, body, headers = {}) {
  const corpo = JSON.stringify(body || {});
  const r = await worker.fetch(new Request("https://motor.teste" + path, { method: "POST", headers: { Origin: ORIGEM, "Content-Type": "application/json", "Content-Length": String(corpo.length), ...headers }, body: corpo }), env, ctx);
  const j = await r.json().catch(() => ({}));
  await Promise.all(pend); pend = [];
  return { status: r.status, j, h: r.headers };
}
const so = (ia) => sim.chamadas.filter((c) => c.ia === ia);
const semTermos = () => sim.chamadas.filter((c) => c.ia !== "gemini:termos");
const MESA = [{ id: "aaaa1", autor: "Autora A", titulo: "Livro A", dossie: "# dossie da autora A" }];
const conselho = (extra) => chama("/council", { problem: "quero cobrar mais caro", mentes: MESA.map((m) => ({ ...m })), history: [{ role: "user", text: "quero cobrar mais caro" }], ...extra });
const veredito = () => chama("/verdict", { mentes: MESA, history: [{ role: "user", text: "e ai?" }] });

beforeEach(() => {
  env = { ...BASE }; sim.claude = "ok"; sim.chamadas = []; pend = [];
  for (const t of ["pautas", "log", "rl"]) { try { db.exec("DELETE FROM " + t); } catch (e) {} }
});

test("1. /council no Sonnet, com pro no Opus; /verdict no Opus; pautas no Sonnet nas duas chamadas", async () => {
  let r = await conselho();
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.modelo, SONNET); assert.equal(r.j.caiu, "");
  assert.equal(r.j.replies[0].txt, "Fala <b>afiada</b>.");
  const c = so("claude")[0];
  assert.equal(c.modelo, SONNET);
  assert.equal(c.headers["anthropic-version"], "2023-06-01");
  assert.equal(c.headers["x-api-key"], "a");
  assert.ok(c.body.max_tokens >= 16000, "pensamento adaptativo conta no max_tokens");
  assert.equal(c.body.output_config.effort, "medium");
  assert.ok(!("temperature" in c.body) && !("top_p" in c.body) && !("thinking" in c.body));
  assert.match(c.body.messages[0].content.at(-1).text, /Responda apenas com o JSON pedido, sem texto antes ou depois, sem cercas de código\.$/);
  assert.equal(so("gemini").length, 0);

  sim.chamadas = [];
  r = await conselho({ pro: true });
  assert.equal(r.j.modelo, OPUS); assert.equal(so("claude")[0].modelo, OPUS); assert.equal(so("claude")[0].body.output_config.effort, "high");

  sim.chamadas = [];
  r = await veredito();
  assert.equal(r.status, 200); assert.equal(r.j.modelo, OPUS); assert.equal(r.j.recomendacao, "r");
  assert.deepEqual(semTermos().map((c) => c.modelo), [OPUS]);

  sim.chamadas = [];
  r = await chama("/pautas/gerar", {});
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.pautas.length, 5); assert.equal(r.j.modelo, SONNET);
  assert.deepEqual(semTermos().map((c) => c.ia + ":" + c.modelo), ["claude:" + SONNET, "claude:" + SONNET]);
});

test("2. as outras rotas continuam no Gemini", async () => {
  const roster = [{ i: 0, id: "aaaa1", autor: "Autora A", titulo: "Livro A", dominio: "d", tese: "t" }];
  const rotas = [
    ["/cast", { problem: "quero cobrar mais caro sem perder cliente", roster }],
    ["/orient", { problem: "cenario", mentes: MESA }],
    ["/brief", { text: "texto comprido o bastante pra virar briefing de verdade, com mais de quarenta letras" }],
    ["/mente", { titulo: "Livro", autor: "A", text: "x".repeat(200) }],
    ["/ask", { titulo: "Livro A", autor: "Autora A", question: "e ai?" }],
    ["/librarian", { query: "cobrar mais caro", roster }],
    ["/gen", { type: "frases", book: { titulo: "Livro A", autor: "Autora A" } }],
  ];
  for (const [rota, body] of rotas) { const r = await chama(rota, body); assert.equal(r.status, 200, rota + " " + JSON.stringify(r.j)); }
  assert.equal(so("claude").length, 0, "nenhuma chamada ao Claude");
  assert.ok(so("gemini").length >= rotas.length);
});

test("3. imagens chegam ao Claude como bloco image base64, antes do texto", async () => {
  await conselho({ images: [{ mime: "image/png", data: "iVBORw0K" }, { mime: "image/heic", data: "AAAA" }] });
  const content = so("claude")[0].body.messages[0].content;
  assert.deepEqual(content[0], { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0K" } });
  assert.equal(content[1].source.media_type, "image/jpeg", "tipo fora da lista vira jpeg, como no Gemini");
  assert.equal(content[2].type, "text");
});

test("4. JSON com cercas e texto em volta e parseado", async () => {
  sim.claude = "cercas";
  const r = await conselho();
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.modelo, SONNET);
  assert.equal(r.j.replies.length, 1);
  assert.equal(so("gemini").length, 0);
});

test("5. max_tokens da muito_longo, sem cair no Gemini; JSON ilegivel da parse, tambem sem cair", async () => {
  sim.claude = "max_tokens";
  let r = await conselho();
  assert.equal(r.status, 502); assert.equal(r.j.error, "muito_longo");
  sim.claude = "lixo";
  r = await conselho();
  assert.equal(r.status, 502); assert.equal(r.j.error, "parse");
  sim.claude = 400;
  r = await conselho();
  assert.equal(r.status, 502); assert.equal(r.j.error, "claude_error", "400 que nao e credito nao cai (bug nosso tem que aparecer)");
  assert.equal(so("gemini").length, 0);
});

test("6. 429, 5xx, tempo, rede, 401, credito e recusa caem no Gemini equivalente e devolvem caiu", async () => {
  const casos = [[429, "claude_429"], [500, "claude_500"], [529, "claude_529"], ["timeout", "tempo_esgotado"], ["rede", "rede"], [401, "claude_401"], ["credito", "sem_credito"], ["recusa", "recusa"]];
  for (const [modo, caiu] of casos) {
    sim.claude = modo; sim.chamadas = [];
    const r = await conselho();
    assert.equal(r.status, 200, modo + " " + JSON.stringify(r.j));
    assert.equal(r.j.caiu, caiu, String(modo));
    assert.equal(r.j.modelo, FLASH);
    assert.deepEqual(semTermos().map((c) => c.ia), ["claude", "gemini"]);
  }
  sim.claude = 500; sim.chamadas = [];
  const v = await veredito();
  assert.equal(v.j.modelo, PRO, "Opus cai no Pro"); assert.equal(v.j.caiu, "claude_500");
  sim.chamadas = [];
  const p = await chama("/pautas/gerar", {});
  assert.equal(p.status, 200); assert.equal(p.j.modelo, FLASH); assert.equal(p.j.caiu, "claude_500");
});

test("7. sem ANTHROPIC_API_KEY, tudo vai pro Gemini sem erro", async () => {
  delete env.ANTHROPIC_API_KEY;
  assert.equal((await conselho()).j.modelo, FLASH);
  assert.equal((await conselho({ pro: true })).j.modelo, PRO);
  assert.equal((await veredito()).j.modelo, PRO);
  assert.equal((await chama("/pautas/gerar", {})).j.modelo, FLASH);
  assert.equal(so("claude").length, 0);
});

test("8. com o interruptor em gemini, nada chama o Claude", async () => {
  env.IA_COUNCIL = "gemini"; env.IA_VERDICT = "gemini"; env.IA_PAUTAS = "gemini";
  assert.equal((await conselho()).j.modelo, FLASH);
  assert.equal((await veredito()).j.modelo, PRO);
  assert.equal((await chama("/pautas/gerar", {})).status, 200);
  assert.equal(so("claude").length, 0);
  env.IA_VERDICT = "claude";   // um so ligado
  assert.equal((await veredito()).j.modelo, OPUS);
  assert.equal((await conselho()).j.modelo, FLASH);
});

test("9. X-IA sem a chave e ignorado; com a chave, vale", async () => {
  assert.equal((await conselho({}, )).j.modelo, SONNET);
  let r = await chama("/council", { problem: "p", mentes: MESA, history: [] }, { "X-IA": "gemini" });
  assert.equal(r.j.modelo, SONNET, "sem chave");
  r = await chama("/council", { problem: "p", mentes: MESA, history: [] }, { "X-IA": "gemini", "X-Index-Key": "errada" });
  assert.equal(r.j.modelo, SONNET, "chave errada");
  r = await chama("/council", { problem: "p", mentes: MESA, history: [] }, { "X-IA": "gemini", "X-Index-Key": "segredo" });
  assert.equal(r.j.modelo, FLASH, "chave certa forca o Gemini");
  env.IA_COUNCIL = "gemini";
  r = await chama("/council", { problem: "p", mentes: MESA, history: [] }, { "X-IA": "claude", "X-Index-Key": "segredo" });
  assert.equal(r.j.modelo, SONNET, "e forca o Claude com o interruptor desligado");
});

test("10. os tokens do Claude vao pro log (e somam as duas chamadas das pautas, inclusive no cron)", async () => {
  await conselho();
  await veredito();
  await chama("/pautas/gerar", {});
  sim.claude = "max_tokens";
  await conselho();
  const log = db.prepare("SELECT rota, status, modelo, tok_in, tok_out FROM log ORDER BY id").all().map((l) => ({ ...l }));
  assert.deepEqual(log, [
    { rota: "/council", status: 200, modelo: SONNET, tok_in: 1200, tok_out: 340 },
    { rota: "/verdict", status: 200, modelo: OPUS, tok_in: 1200, tok_out: 340 },
    { rota: "/pautas/gerar", status: 200, modelo: SONNET, tok_in: 2400, tok_out: 680 },
    { rota: "/council", status: 502, modelo: SONNET, tok_in: 1200, tok_out: 340 },
  ]);
  sim.claude = "ok"; db.exec("DELETE FROM pautas"); db.exec("DELETE FROM log");
  await worker.scheduled({ cron: "0 9 * * *", scheduledTime: Date.now() }, env, ctx);
  assert.deepEqual({ ...db.prepare("SELECT rota, modelo, tok_in, tok_out FROM log").get() }, { rota: "cron:pautas", modelo: SONNET, tok_in: 2400, tok_out: 680 });
  // os cabecalhos de tokens nao vazam pra tela
  const r = await conselho();
  assert.equal(r.h.get("X-Tok-In"), null);
});
