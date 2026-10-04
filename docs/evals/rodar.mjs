// Banco de teste da mesa. Roda cada caso de perguntas.json contra o motor publicado
// e grava o resultado em docs/evals/<rotulo>/ pra comparar versões lado a lado.
//
//   node docs/evals/rodar.mjs baseline          (antes de mudar o motor)
//   node docs/evals/rodar.mjs retrieval         (depois)
//   node docs/evals/comparar.mjs baseline retrieval
//
// Opções: --pro (conselho no modelo forte) · --so=r3-posicionamento,s5-procrastinacao · --sem-cast
// Custo aproximado por rodada completa (18 casos): ~US$ 1,50.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "../..");
const MOTOR = process.env.MOTOR || "https://broad-heart-33a0.rodrigobondioli.workers.dev";
const ORIGEM = "https://superlivros.rodrigobondioli.com";

const args = process.argv.slice(2);
const rotulo = (args.find((a) => !a.startsWith("--")) || "").replace(/[^a-z0-9_-]/gi, "");
if (!rotulo) { console.log("Uso: node docs/evals/rodar.mjs <rotulo>   (ex.: baseline)"); process.exit(1); }
const PRO = args.includes("--pro");
const SEM_CAST = args.includes("--sem-cast");
const SO = ((args.find((a) => a.startsWith("--so=")) || "").slice(5)).split(",").filter(Boolean);

// ---- estante: lida do index.html (as linhas gigantes; nunca abrir no editor) ----
function linhaJSON(prefixo) {
  const html = fs.readFileSync(path.join(RAIZ, "index.html"), "utf8");
  const l = html.split("\n").find((x) => x.startsWith(prefixo));
  if (!l) throw new Error("não achei " + prefixo + " no index.html");
  return JSON.parse(l.slice(l.indexOf("["), l.lastIndexOf("]") + 1));
}
const MENTES = linhaJSON("const MENTES = ");
const BOOKS = linhaJSON("const BOOKS = ");
const CAT = Object.fromEntries(BOOKS.map((b) => [b.hash, b.cat]));
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

// mesma montagem de roster do site, mas com ordem embaralhada por semente fixa:
// a mesma pergunta recebe a mesma ordem em todas as rodadas, pra comparação justa
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function roster(seed) {
  const r = MENTES.map((m, i) => { const nx = /\*\*N[ÃA]O convoque para:\*\*\s*(.+)/.exec(m.md || ""); return { i, id: m.id, local: false, autor: m.autor, titulo: m.titulo, dominio: m.dominio, tese: m.tese, convoque: m.convoque || "", nao: nx ? nx[1].trim() : "" }; });
  const rand = rng(seed);
  for (let k = r.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [r[k], r[j]] = [r[j], r[k]]; }
  return r;
}

async function post(rota, corpo, tentativas = 2) {
  let ultimo = "";
  for (let t = 0; t < tentativas; t++) {
    const t0 = Date.now();
    try {
      const r = await fetch(MOTOR + rota, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGEM }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(170000) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) return { ok: true, j, ms: Date.now() - t0 };
      ultimo = (j.error || "http " + r.status) + (j.detail ? " — " + j.detail : "");
      if (r.status < 500) break;
    } catch (e) { ultimo = String(e && e.message || e); }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { ok: false, erro: ultimo };
}

// citação "literal" = o quote_orig (ou o quote) aparece de fato no dossiê ou nos trechos daquela mente
const limpa = (s) => norm(s).replace(/[“”"'‘’.,;:!?()\[\]—–*_#`>-]/g, " ").replace(/\s+/g, " ").trim();
function citacaoLiteral(rep, mesa, trechos) {
  const q = limpa(rep.quote_orig || rep.quote || "");
  if (q.length < 12) return null;
  const m = mesa.find((x) => norm(x.autor) === norm(rep.autor));
  if (!m) return false;
  const fonte = limpa((m.md || "") + " " + ((trechos && trechos[m.id]) || []).join(" "));
  return fonte.includes(q);
}

const anterior = (() => { try { return JSON.parse(fs.readFileSync(path.join(AQUI, "baseline", "resultados.json"), "utf8")); } catch (e) { return null; } })();

async function rodaCaso(c, idx) {
  const out = { id: c.id, origem: c.origem, problema: c.problema };
  // 1) curadoria
  if (!SEM_CAST) {
    const rc = await post("/cast", { problem: c.problema, project: c.projeto || null, roster: roster(1000 + idx) });
    if (rc.ok) {
      const vistos = new Set(); const picks = [];
      (rc.j.picks || []).forEach((p) => { const m = MENTES[p.i]; if (!m) return; const a = norm(m.autor); if (vistos.has(a)) return; vistos.add(a); picks.push({ id: m.id, autor: m.autor, titulo: m.titulo, cat: CAT[m.id] || "", motivo: p.motivo }); });
      out.cast = { ms: rc.ms, modelo: rc.j.modelo || "", lista: rc.j.lista || MENTES.length, picks, angulos: rc.j.angulos || "", falta: rc.j.falta || "" };
      if (c.mesa_real && c.mesa_real.length) {
        const real = new Set(c.mesa_real.map((id) => norm((MENTES.find((m) => m.id === id) || {}).autor)));
        out.cast.acertos = picks.filter((p) => real.has(norm(p.autor))).length;
        out.cast.de = c.mesa_real.length;
      }
    } else out.cast = { erro: rc.erro };
  }
  // 2) conselho: mesa fixa pra comparar só a qualidade da fala
  //    real -> a mesa que o Rodrigo usou; sintético -> a mesa que o curador montou no baseline
  let ids = (c.mesa_real && c.mesa_real.length) ? c.mesa_real : null;
  if (!ids && anterior) { const a = anterior.casos.find((x) => x.id === c.id); if (a && a.cast && a.cast.picks) ids = a.cast.picks.map((p) => p.id); }
  if (!ids && out.cast && out.cast.picks) ids = out.cast.picks.map((p) => p.id);
  const mesa = (ids || []).map((id) => MENTES.find((m) => m.id === id)).filter(Boolean);
  if (!mesa.length) { out.council = { erro: "sem mesa" }; return out; }
  const history = [{ role: "user", text: c.problema }];
  if (c.segunda) history.push({ role: "user", text: c.segunda });
  const rr = await post("/council", { problem: c.problema, project: c.projeto || null, mentes: mesa.map((m) => ({ id: m.id, autor: m.autor, titulo: m.titulo, dossie: m.md })), history, pro: PRO, debug: true });
  if (rr.ok) {
    const reps = (rr.j.replies || []).map((r) => ({ ...r, literal: citacaoLiteral(r, mesa, rr.j.trechos) }));
    out.council = { ms: rr.ms, modelo: rr.j.modelo || "", mesa: mesa.map((m) => ({ id: m.id, autor: m.autor, titulo: m.titulo })), replies: reps, fontes: rr.j.fontes || {}, deriva: rr.j.deriva || "", sugeridos: rr.j.sugeridos || [] };
  } else out.council = { erro: rr.erro, mesa: mesa.map((m) => ({ id: m.id, autor: m.autor })) };
  return out;
}

const banco = JSON.parse(fs.readFileSync(path.join(AQUI, "perguntas.json"), "utf8"));
const casos = banco.casos.filter((c) => !SO.length || SO.includes(c.id));
console.log(`Rodando ${casos.length} casos contra ${MOTOR}${PRO ? " (conselho no Pro)" : ""}…`);
const res = new Array(casos.length);
let prox = 0, feitos = 0;
await Promise.all([0, 1, 2].map(async () => {
  while (prox < casos.length) {
    const k = prox++;
    res[k] = await rodaCaso(casos[k], banco.casos.indexOf(casos[k]));
    feitos++;
    const r = res[k];
    console.log(`  [${feitos}/${casos.length}] ${r.id}  cast:${r.cast ? (r.cast.erro ? "ERRO " + r.cast.erro : r.cast.picks.length + " mentes" + (r.cast.de ? ` (${r.cast.acertos}/${r.cast.de} da mesa real)` : "")) : "-"}  conselho:${r.council.erro ? "ERRO " + r.council.erro : r.council.replies.length + " falas"}`);
  }
}));

// resumo
const media = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const comReal = res.filter((r) => r.cast && r.cast.de);
const cits = res.flatMap((r) => (r.council && r.council.replies) ? r.council.replies.filter((x) => x.literal !== null) : []);
const resumo = {
  rotulo, quando: new Date().toISOString(), motor: MOTOR, pro: PRO,
  casos: res.length,
  cast_acerto_mesa_real: comReal.length ? `${comReal.reduce((a, r) => a + r.cast.acertos, 0)}/${comReal.reduce((a, r) => a + r.cast.de, 0)}` : "-",
  cast_ms_medio: Math.round(media(res.filter((r) => r.cast && r.cast.ms).map((r) => r.cast.ms))),
  cast_categorias_por_mesa: +media(res.filter((r) => r.cast && r.cast.picks).map((r) => new Set(r.cast.picks.map((p) => p.cat)).size)).toFixed(2),
  conselho_ms_medio: Math.round(media(res.filter((r) => r.council && r.council.ms).map((r) => r.council.ms))),
  citacoes_literais: cits.length ? `${cits.filter((x) => x.literal).length}/${cits.length}` : "-",
  falas_com_trechos: res.reduce((a, r) => a + Object.keys((r.council && r.council.fontes) || {}).length, 0),
  erros: res.filter((r) => (r.cast && r.cast.erro) || (r.council && r.council.erro)).map((r) => r.id),
};
const dir = path.join(AQUI, rotulo);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "resultados.json"), JSON.stringify({ resumo, casos: res }, null, 1));
console.log("\nResumo:", JSON.stringify(resumo, null, 1));
console.log(`\nGravado em docs/evals/${rotulo}/resultados.json`);
