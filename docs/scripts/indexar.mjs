// Manda os trechos de .indice/trechos.ndjson pro motor, que grava no banco de busca (D1, plano gratuito).
// Roda no Terminal do Mac, na pasta do repo:   node docs/scripts/indexar.mjs
// Retomável: se cair, roda de novo e ele continua de onde parou (.indice/enviados.txt).
// Livro novo: rode trechos.py de novo e depois este script — só os trechos novos sobem.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const IDX = path.join(RAIZ, ".indice");
const MOTOR = process.env.MOTOR || "https://broad-heart-33a0.rodrigobondioli.workers.dev";
const LOTE = 33, PARALELO = 2;   // 33 = 99 parâmetros, o máximo que o D1 aceita por consulta

const chaveP = path.join(IDX, "chave");
if (!fs.existsSync(chaveP)) { console.log("Falta .indice/chave — rode antes: bash docs/scripts/ativar-retrieval.sh"); process.exit(1); }
const CHAVE = fs.readFileSync(chaveP, "utf8").trim();
const arq = path.join(IDX, "trechos.ndjson");
if (!fs.existsSync(arq)) { console.log("Falta .indice/trechos.ndjson — os trechos ainda não foram extraídos."); process.exit(1); }

async function chama(corpo) {
  const r = await fetch(MOTOR + "/indexar", { method: "POST", headers: { "Content-Type": "application/json", "X-Index-Key": CHAVE }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(120000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error || "http " + r.status) + (j.detail ? " — " + j.detail : ""));
  return j;
}

// 1) confere a ligação antes de mandar 80 mil trechos
let st;
try { st = await chama({ op: "status" }); }
catch (e) { console.log("O motor recusou: " + e.message + "\n(se for 'sem_bindings', o deploy com o Vectorize ainda não subiu; se for 'chave', rode o ativar-retrieval.sh de novo)"); process.exit(1); }
console.log(`Motor ok. O banco tem ${st.trechos} trechos.`);

const progP = path.join(IDX, "enviados.txt");
const ja = fs.existsSync(progP) ? parseInt(fs.readFileSync(progP, "utf8"), 10) || 0 : 0;
const total = await new Promise((res) => { let n = 0; fs.createReadStream(arq).on("data", (b) => { for (const c of b) if (c === 10) n++; }).on("end", () => res(n)); });
if (ja >= total) { console.log(`Nada novo: ${total} trechos já estão no índice.`); process.exit(0); }
console.log(`${total - ja} trechos pra mandar (${ja} já foram).`);

// 2) lê em lotes e manda com alguns em paralelo; o progresso só avança até o último lote contínuo confirmado
const lotes = [];
let atual = [], linha = 0;
const rl = readline.createInterface({ input: fs.createReadStream(arq), crlfDelay: Infinity });
for await (const l of rl) {
  linha++;
  if (linha <= ja || !l.trim()) continue;
  atual.push(JSON.parse(l));
  if (atual.length === LOTE) { lotes.push({ fim: linha, itens: atual }); atual = []; }
}
if (atual.length) lotes.push({ fim: linha, itens: atual });

const ok = new Array(lotes.length).fill(false);
let prox = 0, confirmado = ja, falhou = null, enviados = 0;
const t0 = Date.now();
function salva() {
  let k = 0; while (k < ok.length && ok[k]) k++;
  const novo = k ? lotes[k - 1].fim : ja;
  if (novo > confirmado) { confirmado = novo; fs.writeFileSync(progP, String(confirmado)); }
}
await Promise.all(Array.from({ length: PARALELO }, async () => {
  while (prox < lotes.length && !falhou) {
    const k = prox++;
    for (let t = 0; t < 5; t++) {
      try { await chama({ trechos: lotes[k].itens }); ok[k] = true; break; }
      catch (e) { if (t === 4) { falhou = e.message; } else await new Promise((r) => setTimeout(r, 2000 * (t + 1))); }
    }
    if (!ok[k]) break;
    enviados += lotes[k].itens.length; salva();
    if (k % 40 === 0) {
      const s = (Date.now() - t0) / 1000, ritmo = enviados / s, resta = (total - ja - enviados) / Math.max(ritmo, 1);
      console.log(`  ${ja + enviados}/${total} · ~${Math.ceil(resta / 60)} min restantes`);
    }
  }
}));
salva();
if (falhou) {
  const limite = /limit|exceeded/i.test(falhou);
  console.log(limite
    ? `\nO plano gratuito do D1 grava ~100 mil linhas por dia e chegou no teto de hoje. Progresso salvo (${confirmado}/${total}).\nRode o mesmo comando amanhã (o limite zera às 21h de Brasília) que ele continua de onde parou.\nEnquanto isso a mesa funciona normal, com os trechos que já subiram.`
    : `\nParou com erro: ${falhou}\nProgresso salvo (${confirmado}/${total}). Rode de novo pra continuar.`);
  process.exit(1);
}
console.log(`\nPronto: ${total} trechos no índice. A mesa já usa o livro inteiro.`);
