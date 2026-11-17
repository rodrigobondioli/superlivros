// Rota POST /trechos (material bruto dos livros pra Dinora, servidor a servidor).
//   node --test testes/trechos-dinora.test.mjs
// D1 de verdade (SQLite do Node, com FTS5) e Gemini simulado so pros termos de busca. Nao toca na rede.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import worker from "../worker/worker.js";

const SITE = "https://site.teste";
const CHAVE = "chave-da-dinora";

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

/* ---------- estante de teste ---------- */
const LIVROS = [
  { hash: "aaaa1", titulo: "Preco A", autor: "Autora A", cat: "Negócios", trechos: 40, tema: true },
  { hash: "bbbb2", titulo: "Preco B", autor: "Autor B", cat: "Negócios", trechos: 30, tema: true },
  { hash: "cccc3", titulo: "Preco C", autor: "Autor C", cat: "Design", trechos: 30, tema: true },
  { hash: "dddd4", titulo: "Caes D", autor: "Autor D", cat: "Dog", trechos: 30, tema: false },
  { hash: "eeee5", titulo: "Escaneado", autor: "Autor E", cat: "Design", trechos: 0 },   // so resumo
];
const CATALOGO = JSON.stringify(LIVROS.map(({ hash, titulo, autor, cat }) => ({ hash, titulo, autor, cat })));
const TEXTO = JSON.stringify({ hash: "eeee5", txt: "RESUMO DO ESCANEADO. " + "Frase do resumo que sustenta o material. ".repeat(40), ganchos: ["Gancho um"], muda: "Muda." }) + "\n";

const sim = { geminiChamadas: 0, termos: ["pricing", "preco"] };
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith(SITE + "/data/catalogo-pautas.json")) return new Response(CATALOGO, { status: 200 });
  if (u.startsWith(SITE + "/data/catalogo-pautas-texto.ndjson")) return new Response(TEXTO, { status: 200 });
  if (u.includes("generativelanguage.googleapis.com")) {
    sim.geminiChamadas++;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ termos: sim.termos }) }] }, finishReason: "STOP" }] }), { status: 200 });
  }
  if (u.includes("api.anthropic.com")) throw new Error("a /trechos nunca pode chamar o Claude");
  throw new Error("fetch inesperado: " + u);
};

const db = new DatabaseSync(":memory:"), dbT = new DatabaseSync(":memory:");
dbT.exec("CREATE TABLE IF NOT EXISTS trechos (id TEXT, livro TEXT, txt TEXT)");
dbT.exec("CREATE VIRTUAL TABLE IF NOT EXISTS busca USING fts5(livro, txt, content='trechos', content_rowid='rowid', tokenize='porter unicode61 remove_diacritics 2')");
dbT.exec("CREATE TRIGGER IF NOT EXISTS trechos_ai AFTER INSERT ON trechos BEGIN INSERT INTO busca(rowid, livro, txt) VALUES (new.rowid, new.livro, new.txt); END");
const ins = dbT.prepare("INSERT INTO trechos (id, livro, txt) VALUES (?,?,?)");
for (const l of LIVROS) for (let k = 0; k < l.trechos; k++)
  ins.run(`${l.hash}-${k}`, l.hash, `TRECHO ${k} de ${l.hash}. ` + (l.tema ? "Pricing strategy and value based pricing. " : "Dog training with treats. ") + "Texto de enchimento pra passar do tamanho. ".repeat(40));

const BASE = { DB: d1(db), TRECHOS: d1(dbT), GEMINI_API_KEY: "g", DINORA_KEY: CHAVE, SITE_URL: SITE };
let env = { ...BASE };
let pend = [];
const ctx = { waitUntil(p) { pend.push(p); } };
async function chama(body, headers = { "X-Dinora-Key": CHAVE }) {
  const corpo = JSON.stringify(body);
  // sem Origin de proposito: a Dinora chama de servidor
  const r = await worker.fetch(new Request("https://motor.teste/trechos", { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": String(corpo.length), ...headers }, body: corpo }), env, ctx);
  const j = await r.json().catch(() => ({}));
  await Promise.all(pend); pend = [];
  return { status: r.status, j };
}
beforeEach(() => { env = { ...BASE }; sim.geminiChamadas = 0; sim.termos = ["pricing", "preco"]; pend = []; try { db.exec("DELETE FROM log"); db.exec("DELETE FROM rl"); } catch (e) {} });

test("1. sem chave ou com chave errada: 403, sem chamar nada", async () => {
  assert.equal((await chama({ tema: "preco" }, {})).status, 403);
  assert.equal((await chama({ tema: "preco" }, { "X-Dinora-Key": "errada" })).status, 403);
  delete env.DINORA_KEY;
  assert.equal((await chama({ tema: "preco" })).status, 403, "sem o secret configurado, ninguem entra");
  assert.equal(sim.geminiChamadas, 0);
});

test("2. modo tema: no maximo 3 por livro, filtra categoria, corta em 1200, devolve os termos e grava no log", async () => {
  let r = await chama({ tema: "como cobrar mais caro", n: 12 });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.modo, "tema");
  assert.deepEqual(r.j.termos, ["pricing", "preco"]);
  assert.ok(r.j.livros.length >= 3, "variedade de livros");
  assert.ok(r.j.livros.every((l) => l.trechos.length <= 3));
  assert.ok(r.j.livros.every((l) => l.trechos.every((t) => t.length <= 1200)));
  assert.ok(r.j.livros.some((l) => l.trechos.some((t) => t.length === 1200)), "o trecho grande foi cortado");
  assert.ok(!r.j.livros.some((l) => l.hash === "dddd4"), "livro fora do tema nao vem");
  assert.deepEqual(Object.keys(r.j.livros[0]).sort(), ["autor", "cat", "fonte", "hash", "titulo", "trechos"]);
  assert.ok(r.j.livros.reduce((a, l) => a + l.trechos.length, 0) <= 12);

  r = await chama({ tema: "como cobrar mais caro", cats: ["Design"] });
  assert.deepEqual(r.j.livros.map((l) => l.hash), ["cccc3"], "so a categoria pedida");

  const log = db.prepare("SELECT rota, status, modelo FROM log ORDER BY id").all().map((x) => ({ ...x }));
  assert.deepEqual(log, [{ rota: "/trechos", status: 200, modelo: "gemini-3.8-flash" }, { rota: "/trechos", status: 200, modelo: "gemini-3.8-flash" }]);
});

test("3. modo livro por hash: trechos do indice; livro escaneado cai no resumo; hash desconhecido da 404", async () => {
  let r = await chama({ livro: "aaaa1" });
  assert.equal(r.status, 200);
  assert.equal(r.j.modo, "livro");
  assert.equal(r.j.livros.length, 1);
  assert.equal(r.j.livros[0].hash, "aaaa1"); assert.equal(r.j.livros[0].titulo, "Preco A"); assert.equal(r.j.livros[0].fonte, "indice");
  assert.ok(r.j.livros[0].trechos.length > 5 && r.j.livros[0].trechos.every((t) => t.length <= 1200));
  assert.equal(sim.geminiChamadas, 0, "modo livro nao chama IA nenhuma");

  r = await chama({ livro: "eeee5" });
  assert.equal(r.j.livros[0].fonte, "resumo");
  assert.match(r.j.livros[0].trechos[0], /RESUMO DO ESCANEADO/);

  r = await chama({ livro: "zzzz9" });
  assert.equal(r.status, 404);
});

test("4. sorteio respeita cats e evitar", async () => {
  for (let i = 0; i < 15; i++) {
    const r = await chama({ sorteio: true, cats: ["Negócios"], evitar: ["aaaa1"] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.j.livros.map((l) => l.hash), ["bbbb2"], "Negocios menos o evitado sobra so o B");
  }
  const r = await chama({ sorteio: true, cats: ["Negócios"], evitar: ["aaaa1", "bbbb2"] });
  assert.deepEqual(r.j.livros, [], "nada sobrando: lista vazia, sem erro");
});

test("5. indice ausente ou busca vazia: 200 com livros vazio, nunca erro", async () => {
  delete env.TRECHOS;
  let r = await chama({ tema: "preco" });
  assert.equal(r.status, 200); assert.deepEqual(r.j.livros, []);
  r = await chama({ livro: "eeee5" });
  assert.equal(r.j.livros[0].fonte, "resumo", "modo livro ainda tem o resumo");
  env = { ...BASE };
  sim.termos = ["xylofone"];
  r = await chama({ tema: "algo que nenhum livro trata" });
  assert.equal(r.status, 200); assert.deepEqual(r.j.livros, []); assert.deepEqual(r.j.termos, ["xylofone"]);
});

test("6. limite de 300 por dia e corpo sem tema nem livro", async () => {
  assert.equal((await chama({})).status, 400);
  const dia = Math.floor(Date.now() / 1000); db.exec(`INSERT OR REPLACE INTO rl (ip,n,janela) VALUES ('dinora', 300, ${dia - (dia % 86400)})`);
  assert.equal((await chama({ tema: "preco" })).status, 429);
});
