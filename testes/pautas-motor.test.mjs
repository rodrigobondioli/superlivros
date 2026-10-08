// Testes do motor das pautas: D1 de verdade (o SQLite do Node, com FTS5) e Gemini simulado.
//   node --test testes/pautas-motor.test.mjs
// Exige Node 22+ (node:sqlite). Nao toca na rede nem no motor publicado.
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import worker from "../worker/worker.js";

const ORIGEM = "https://superlivros.rodrigobondioli.com";
const SITE = "https://site.teste";
const FLASH = "gemini-3.8-flash";

/* ---------- D1 de mentira em cima do SQLite de verdade ---------- */
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
  { hash: "aaaa1", titulo: "Livro A", autor: "Autora A", cat: "Design", trechos: 100 },
  { hash: "bbbb2", titulo: "Livro B", autor: "Autor B", cat: "Design", trechos: 60 },
  { hash: "cccc3", titulo: "Livro C", autor: "Autor C", cat: "Design", trechos: 30 },
  { hash: "dddd4", titulo: "Livro D", autor: "Autor D", cat: "Drinks", trechos: 50 },
  { hash: "eeee5", titulo: "Escaneado", autor: "Autor E", cat: "Storytelling", trechos: 0 },   // sem trechos, tem resumo
  { hash: "ffff6", titulo: "Vazio", autor: "Autor F", cat: "Comunidade", trechos: 0 },        // nem trecho nem resumo
];
const CATALOGO = JSON.stringify(LIVROS.map(({ hash, titulo, autor, cat }) => ({ hash, titulo, autor, cat })));
const TEXTO = JSON.stringify({ hash: "eeee5", txt: "RESUMO DO ESCANEADO. " + "Frase do resumo que sustenta a pauta. ".repeat(40), ganchos: ["Gancho um", "Gancho dois"], muda: "Muda tudo." }) + "\n";
const TODAS = ["Design", "Drinks", "Storytelling", "Comunidade"];

/* ---------- Gemini simulado ---------- */
const mock = { prompts: [], criticoQuebrado: false, candidatasQuebradas: 0 };
function respostaGemini(obj, cru) {
  const text = cru != null ? cru : JSON.stringify(obj);
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] }), { status: 200, headers: { "content-type": "application/json" } });
}
const TIPOS = ["contraintuitivo", "mito", "framework", "pergunta", "erro", "caso", "frase"];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith(SITE + "/data/catalogo-pautas.json")) return new Response(CATALOGO, { status: 200 });
  if (u.startsWith(SITE + "/data/catalogo-pautas-texto.ndjson")) return new Response(TEXTO, { status: 200 });
  if (u.includes("generativelanguage.googleapis.com")) {
    await new Promise((r) => setTimeout(r, 2));   // ts diferente a cada geracao
    const corpo = JSON.parse(init.body), gc = corpo.generationConfig || {};
    // os proximos modelos devolvem 400 INVALID_ARGUMENT com estes parametros (aviso do Google, 10/2026)
    const aposentados = ["temperature", "topP", "topK", "thinkingBudget"].filter((k) => k in gc || (gc.thinkingConfig && k in gc.thinkingConfig));
    if (aposentados.length) return new Response(JSON.stringify({ error: { code: 400, status: "INVALID_ARGUMENT", message: "parametro aposentado: " + aposentados } }), { status: 400 });
    const prompt = corpo.contents[0].parts[0].text;
    mock.prompts.push(prompt);
    if (prompt.includes("Gere 15 candidatas")) {
      if (mock.candidatasQuebradas > 0) { mock.candidatasQuebradas--; return respostaGemini(null, "isso nao e json {"); }
      const livro = /LIVRO: (.+?) —/.exec(prompt)[1];
      return respostaGemini({ candidatas: Array.from({ length: 15 }, (_, i) => ({ tipo: TIPOS[i % 7], gancho: `Candidata ${i + 1} de ${livro}`, insight: `Insight da candidata ${i + 1}, com substancia suficiente pra passar.`, ancora: "Capitulo " + (i + 1) })) });
    }
    if (prompt.includes("editor exigente")) {
      if (mock.criticoQuebrado) return respostaGemini(null, "{\"pautas\": [ quebrado");
      return respostaGemini({ pautas: Array.from({ length: 5 }, (_, i) => ({ tipo: TIPOS[i], gancho: `Escolhida ${i + 1}`, insight: `Insight escolhido ${i + 1}, reescrito mais afiado pelo critico.`, ancora: `O caso do capitulo ${i + 1}, no trecho [${i + 1}].` })) });
    }
    return new Response(JSON.stringify({ error: { message: "prompt desconhecido" } }), { status: 400 });
  }
  throw new Error("fetch inesperado: " + u);
};

/* ---------- ambiente ---------- */
const db = new DatabaseSync(":memory:"), dbT = new DatabaseSync(":memory:");
dbT.exec("CREATE TABLE IF NOT EXISTS trechos (id TEXT, livro TEXT, txt TEXT)");
dbT.exec("CREATE VIRTUAL TABLE IF NOT EXISTS busca USING fts5(livro, txt, content='trechos', content_rowid='rowid', tokenize='porter unicode61 remove_diacritics 2')");
dbT.exec("CREATE TRIGGER IF NOT EXISTS trechos_ai AFTER INSERT ON trechos BEGIN INSERT INTO busca(rowid, livro, txt) VALUES (new.rowid, new.livro, new.txt); END");
const ins = dbT.prepare("INSERT INTO trechos (id, livro, txt) VALUES (?,?,?)");
for (const l of LIVROS) for (let k = 0; k < l.trechos; k++) ins.run(`${l.hash}-${k}`, l.hash, `TRECHO ${k} de ${l.hash}. ` + "Texto de enchimento pra parecer um trecho de verdade do livro. ".repeat(6));

const env = { DB: d1(db), TRECHOS: d1(dbT), GEMINI_API_KEY: "teste", SITE_URL: SITE };
let pend = [];
const ctx = { waitUntil(p) { pend.push(p); } };
function req(path, o = {}) {
  const body = o.body ? JSON.stringify(o.body) : undefined;
  const headers = Object.assign({}, o.semOrigem ? {} : { Origin: ORIGEM }, body ? { "Content-Type": "application/json", "Content-Length": String(body.length) } : {});
  return new Request("https://motor.teste" + path, { method: o.method || (body ? "POST" : "GET"), headers, body });
}
async function chama(path, o) { const r = await worker.fetch(req(path, o), env, ctx); const j = await r.json().catch(() => ({})); return { status: r.status, j }; }
async function cron() { await worker.scheduled({ cron: "0 9 * * *", scheduledTime: Date.now() }, env, ctx); await Promise.all(pend); pend = []; }
async function desliga(cats) { const r = await chama("/pautas/filtro", { body: { cats_off: cats } }); assert.equal(r.status, 200); }
const todasPautas = () => db.prepare("SELECT * FROM pautas ORDER BY id").all();
const hojeSP = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

before(async () => { const r = await chama("/pautas"); assert.equal(r.status, 200, "o GET cria as tabelas sozinho"); });
beforeEach(async () => {
  for (const t of ["pautas", "config", "log", "rl"]) db.exec("DELETE FROM " + t);
  mock.prompts = []; mock.criticoQuebrado = false; mock.candidatasQuebradas = 0; pend = [];
});

test("1. o cron gera 5 pautas de um livro de categoria ligada", async () => {
  await desliga(TODAS.filter((c) => c !== "Design"));
  await cron();
  const ps = todasPautas();
  assert.equal(ps.length, 5);
  assert.ok(ps.every((p) => p.cat === "Design" && p.origem === "cron" && p.status === "nova" && p.dia === hojeSP()));
  assert.ok(ps.every((p) => p.livro === ps[0].livro && p.livro_titulo && p.gancho && p.insight));
  assert.equal(new Set(ps.map((p) => p.tipo)).size, 5, "5 tipos diferentes vindos do critico");
  assert.deepEqual(ps.map((p) => p.ancora), [1, 2, 3, 4, 5].map((i) => `O caso do capitulo ${i}.`), "a ancora perde o numero do trecho");
  const log = db.prepare("SELECT rota, status, modelo FROM log").all();
  assert.deepEqual(log.map((l) => [l.rota, l.status, l.modelo]), [["cron:pautas", 200, FLASH]]);
});

test("2. rodar o cron duas vezes no mesmo dia nao duplica", async () => {
  await desliga(["Drinks", "Storytelling", "Comunidade"]);
  await cron(); await cron();
  assert.equal(todasPautas().length, 5);
  assert.equal(mock.prompts.length, 2, "a segunda rodada nem chamou o modelo");
});

test("3. uma categoria desligada nunca e sorteada", async () => {
  await desliga(["Drinks", "Storytelling", "Comunidade"]);
  for (let i = 0; i < 12; i++) { const r = await chama("/pautas/gerar", { body: {} }); assert.equal(r.status, 200, JSON.stringify(r.j)); }
  const cats = new Set(todasPautas().map((p) => p.cat));
  assert.deepEqual([...cats], ["Design"]);
});

test("4. com tudo desligado, nada e gerado (e fica no log)", async () => {
  await desliga(TODAS);
  await cron();
  assert.equal(todasPautas().length, 0);
  assert.equal(mock.prompts.length, 0);
  assert.deepEqual(db.prepare("SELECT rota, status FROM log").all().map((l) => [l.rota, l.status]), [["cron:pautas", 204]]);
  const r = await chama("/pautas/gerar", { body: {} });
  assert.equal(r.status, 409); assert.equal(r.j.error, "tudo_desligado");
});

test("5. livro ja usado nao e sorteado enquanto houver outros; depois volta o de uso mais antigo", async () => {
  await desliga(["Drinks", "Storytelling", "Comunidade"]);   // sobram A, B e C
  const usados = [];
  for (let i = 0; i < 3; i++) { const r = await chama("/pautas/gerar", { body: {} }); assert.equal(r.status, 200); usados.push(r.j.livro.hash); }
  assert.equal(new Set(usados).size, 3, "tres geracoes, tres livros diferentes");
  const r4 = await chama("/pautas/gerar", { body: {} });
  assert.equal(r4.j.livro.hash, usados[0], "o quarto sorteio libera o usado ha mais tempo");
});

test("6. os trechos vem espalhados, sem o comeco e o fim do livro", async () => {
  const r = await chama("/pautas/gerar", { body: { livro: "aaaa1" } });
  assert.equal(r.status, 200); assert.equal(r.j.fonte, "indice");
  const p1 = mock.prompts[0];
  const ns = [...p1.matchAll(/TRECHO (\d+) de aaaa1/g)].map((m) => parseInt(m[1], 10));
  assert.equal(ns.length, 14);
  assert.ok(ns.every((n) => n >= 4 && n < 94), "fora dos 4% iniciais e 6% finais: " + ns.join(","));
  assert.ok(ns.every((n, i) => i === 0 || n > ns[i - 1]), "em ordem do livro");
  assert.ok(ns[0] <= 10 && ns[13] >= 83, "cobre comeco e fim do miolo: " + ns.join(","));
  assert.ok(ns.every((n, i) => i === 0 || n - ns[i - 1] <= 13), "sem buraco maior que duas faixas: " + ns.join(","));
  assert.ok(/\[14\] TRECHO/.test(p1) && !/\[15\]/.test(p1), "14 trechos numerados no prompt");
});

test("7. livro sem trechos cai no resumo do BOOKS; sem nada, sorteia outro ou avisa", async () => {
  const r = await chama("/pautas/gerar", { body: { livro: "eeee5" } });
  assert.equal(r.status, 200); assert.equal(r.j.fonte, "resumo");
  assert.ok(mock.prompts[0].includes("RESUMO DO ESCANEADO") && mock.prompts[0].includes("Ganchos do livro"));
  assert.equal(todasPautas().length, 5);
  const v = await chama("/pautas/gerar", { body: { livro: "ffff6" } });
  assert.equal(v.status, 422); assert.equal(v.j.error, "sem_material");
  await desliga(["Design", "Drinks", "Storytelling"]);   // so o Vazio ligado: o sorteio nao tem de onde tirar
  const s = await chama("/pautas/gerar", { body: {} });
  assert.equal(s.status, 422);
  const d = await chama("/pautas/gerar", { body: { livro: "naoexiste" } });
  assert.equal(d.status, 404);
});

test("8. critico com JSON invalido cai nas 5 primeiras candidatas validas", async () => {
  mock.criticoQuebrado = true;
  const r = await chama("/pautas/gerar", { body: { livro: "bbbb2" } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.j.pautas.map((p) => p.gancho), [1, 2, 3, 4, 5].map((i) => `Candidata ${i} de Livro B`));
  mock.criticoQuebrado = false; mock.candidatasQuebradas = 1;   // a 1a chamada quebra uma vez: tenta de novo e segue
  const r2 = await chama("/pautas/gerar", { body: { livro: "cccc3" } });
  assert.equal(r2.status, 200);
  assert.deepEqual(r2.j.pautas.map((p) => p.gancho), [1, 2, 3, 4, 5].map((i) => `Escolhida ${i}`));
  mock.candidatasQuebradas = 2;                                 // quebra duas vezes: desiste com erro, sem gravar
  const r3 = await chama("/pautas/gerar", { body: { livro: "aaaa1" } });
  assert.equal(r3.status, 502);
  assert.equal(todasPautas().length, 10);
});

test("9. a geracao manual conta no limite por IP e no log", async () => {
  const r = await chama("/pautas/gerar", { body: { livro: "aaaa1" } });
  assert.equal(r.status, 200);
  assert.equal(db.prepare("SELECT n FROM rl").get().n, 1);
  await Promise.all(pend);
  assert.deepEqual(db.prepare("SELECT rota, status, modelo FROM log").all().map((l) => [l.rota, l.status, l.modelo]), [["/pautas/gerar", 200, FLASH]]);
  db.prepare("UPDATE rl SET n=150").run();
  const r2 = await chama("/pautas/gerar", { body: { livro: "aaaa1" } });
  assert.equal(r2.status, 429);
  const g = await chama("/pautas");
  assert.equal(g.status, 200, "listar nao passa pelo limite");
});

test("10. status invalido e rejeitado; valido muda e aparece na lista", async () => {
  await chama("/pautas/gerar", { body: { livro: "aaaa1" } });
  const id = todasPautas()[0].id;
  const ruim = await chama("/pautas/status", { body: { id, status: "lida" } });
  assert.equal(ruim.status, 400); assert.equal(ruim.j.error, "status_invalido");
  assert.equal((await chama("/pautas/status", { body: { id: "x", status: "fav" } })).status, 400);
  assert.equal((await chama("/pautas/status", { body: { id: 999999, status: "fav" } })).status, 404);
  for (const st of ["fav", "descartada", "nova"]) {
    const ok = await chama("/pautas/status", { body: { id, status: st } });
    assert.equal(ok.status, 200);
    assert.equal(db.prepare("SELECT status FROM pautas WHERE id=?").get(id).status, st);
  }
  await chama("/pautas/status", { body: { id, status: "fav" } });
  const g = await chama("/pautas?dias=14");
  assert.equal(g.j.pautas.find((p) => p.id === id).status, "fav");
  assert.equal(g.j.hoje, hojeSP());
});

test("11. rotas sem Origin recebem 403", async () => {
  for (const [path, o] of [["/pautas", {}], ["/pautas/gerar", { body: {} }], ["/pautas/filtro", { body: { cats_off: [] } }], ["/pautas/status", { body: { id: 1, status: "fav" } }]]) {
    const r = await chama(path, Object.assign({ semOrigem: true }, o));
    assert.equal(r.status, 403, path);
  }
  assert.equal(todasPautas().length, 0);
});

test("12. o filtro persiste e volta no GET; a lista vem por dia DESC, id ASC", async () => {
  await desliga(["Drinks", "Comunidade"]);
  let g = await chama("/pautas");
  assert.deepEqual(g.j.cats_off, ["Drinks", "Comunidade"]);
  await chama("/pautas/gerar", { body: { livro: "aaaa1" } });
  db.prepare("UPDATE pautas SET dia='2020-01-01'").run();   // envelhece as primeiras
  await chama("/pautas/gerar", { body: { livro: "bbbb2" } });
  g = await chama("/pautas?dias=14");
  assert.equal(g.j.pautas.length, 5, "o filtro de dias deixa as velhas de fora");
  assert.ok(g.j.pautas.every((p) => p.livro === "bbbb2"));
  g = await chama("/pautas?dias=90000");
  assert.equal(g.j.pautas.length, 5, "dias e limitado a 90");
  db.prepare("UPDATE pautas SET dia=? WHERE livro='aaaa1'").run(hojeSP());
  db.prepare("UPDATE pautas SET dia='2020-01-02' WHERE livro='bbbb2'").run();
  g = await chama("/pautas?dias=90");
  assert.equal(g.j.pautas.length, 5);
  assert.ok((await chama("/pautas/filtro", { body: { cats_off: "x" } })).status === 400);
});
