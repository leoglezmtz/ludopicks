import { kv } from "@vercel/kv";
import { PARTIDOS, SALDO_INICIAL, APUESTA_MIN } from "../lib/data.js";

const BY_ID = Object.fromEntries(PARTIDOS.map(p => [p.id, p]));
const MERCADOS_VALIDOS = ["local", "empate", "visita", "over", "under"];

function publicJugadores(jugadores) {
  const out = {};
  for (const [nombre, j] of Object.entries(jugadores)) {
    out[nombre] = { nombre: j.nombre, saldo: j.saldo, creado: j.creado, avatar: j.avatar || null };
  }
  return out;
}

// Deriva todos los resultados posibles a partir del marcador exacto
function outcomes(match, r) {
  const gl = r.gl, gv = r.gv, total = gl + gv;
  return {
    local: gl > gv, empate: gl === gv, visita: gl < gv,
    over: total > match.linea, under: total < match.linea,
  };
}
function pickWins(partidoId, r, pick) {
  const m = BY_ID[partidoId];
  if (!m) return false;
  return !!outcomes(m, r)[pick];
}

// Momio real desde el catálogo (nunca confiar en el cliente)
function momioDe(partidoId, pick) {
  const m = BY_ID[partidoId];
  if (!m || !(pick in m.momios)) return null;
  return m.momios[pick];
}

// Motor recalculable: ajusta saldos solo por transiciones de estado.
// Idempotente — sirve igual para registrar y para revertir resultados.
function settleAll(jugadores, apuestas, resultados) {
  for (const b of Object.values(apuestas)) {
    let ns;
    if (b.tipo === "parlay") {
      const sts = b.legs.map(l => {
        const r = resultados[l.partidoId];
        if (!r) return "pending";
        return pickWins(l.partidoId, r, l.pick) ? "won" : "lost";
      });
      ns = sts.includes("lost") ? "lost" : sts.every(s => s === "won") ? "won" : "pending";
    } else {
      const r = resultados[b.partidoId];
      ns = !r ? "pending" : (pickWins(b.partidoId, r, b.pick) ? "won" : "lost");
    }
    const old = b.status || "pending";
    const j = jugadores[b.nombre];
    if (!j) { b.status = ns; continue; }
    if (old === ns) continue;
    if (old === "won") j.saldo -= (b.payout || 0);           // revierte pago anterior
    if (ns === "won") {
      const factor = b.tipo === "parlay" ? b.momioTotal : b.momio;
      const pay = Math.round(b.monto * factor);
      j.saldo += pay; b.payout = pay;
    } else { b.payout = 0; }
    b.status = ns;
  }
}

function rankingSnapshot(jugadores) {
  const orden = Object.values(jugadores).sort((a, b) => b.saldo - a.saldo);
  const pos = {};
  orden.forEach((j, i) => { pos[j.nombre] = i + 1; });
  return pos;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    const jugadores  = (await kv.get("jugadores"))  || {};
    const apuestas   = (await kv.get("apuestas"))   || {};
    const resultados = (await kv.get("resultados")) || {};
    const rankPrev   = (await kv.get("rankPrev"))   || {};
    return res.json({
      jugadores: publicJugadores(jugadores), apuestas, resultados, rankPrev,
      partidos: PARTIDOS, saldo_inicial: SALDO_INICIAL, apuesta_min: APUESTA_MIN,
      now: Date.now(),
    });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  const { action, payload } = req.body;
  const isAdmin = () => payload && payload.adminKey === process.env.ADMIN_KEY;

  // ── REGISTRO / LOGIN ───────────────────────────────────────────────
  if (action === "register") {
    const { nombre, pin, avatar } = payload;
    if (!nombre || !pin) return res.status(400).json({ error: "Faltan datos" });
    if (!/^\d{4}$/.test(String(pin))) return res.status(400).json({ error: "El PIN debe ser de 4 dígitos" });
    const jugadores = (await kv.get("jugadores")) || {};
    if (jugadores[nombre]) return res.status(400).json({ error: "Ese nombre ya existe, elige otro" });
    jugadores[nombre] = { nombre, pin: String(pin), saldo: SALDO_INICIAL, creado: Date.now(), avatar: avatar || null };
    await kv.set("jugadores", jugadores);
    return res.json({ ok: true, jugadores: publicJugadores(jugadores) });
  }

  if (action === "login") {
    const { nombre, pin } = payload;
    const jugadores = (await kv.get("jugadores")) || {};
    const j = jugadores[nombre];
    if (!j) return res.status(400).json({ error: "Jugador no existe" });
    if (String(j.pin) !== String(pin)) return res.status(403).json({ error: "PIN incorrecto" });
    return res.json({ ok: true, jugadores: publicJugadores(jugadores) });
  }

  if (action === "updateAvatar") {
    const { nombre, pin, avatar } = payload;
    const jugadores = (await kv.get("jugadores")) || {};
    const j = jugadores[nombre];
    if (!j) return res.status(400).json({ error: "Jugador no existe" });
    if (String(j.pin) !== String(pin)) return res.status(403).json({ error: "PIN incorrecto" });
    jugadores[nombre].avatar = avatar;
    await kv.set("jugadores", jugadores);
    return res.json({ ok: true, jugadores: publicJugadores(jugadores) });
  }

  // ── APOSTAR (simple u over/under) ──────────────────────────────────
  if (action === "apostar") {
    const { nombre, partidoId, pick, monto } = payload;
    const jugadores  = (await kv.get("jugadores"))  || {};
    const apuestas   = (await kv.get("apuestas"))   || {};
    const resultados = (await kv.get("resultados")) || {};
    const j = jugadores[nombre];
    if (!j) return res.status(400).json({ error: "Jugador no existe" });
    if (!MERCADOS_VALIDOS.includes(pick)) return res.status(400).json({ error: "Pick inválido" });
    const m = BY_ID[partidoId];
    if (!m) return res.status(400).json({ error: "Partido no existe" });
    if (resultados[partidoId]) return res.status(400).json({ error: "El partido ya tiene resultado" });
    if (Date.now() >= m.kickoff) return res.status(400).json({ error: "El partido ya empezó, apuestas cerradas" });
    const mInt = Math.floor(Number(monto));
    if (!mInt || mInt < APUESTA_MIN) return res.status(400).json({ error: `Mínimo $${APUESTA_MIN}` });

    const mercado = (pick === "over" || pick === "under") ? "ou" : "1x2";
    // Reemplaza apuesta simple previa pendiente en mismo partido+mercado (devuelve su stake)
    let saldoDisp = j.saldo;
    let prevKey = null;
    for (const [k, b] of Object.entries(apuestas)) {
      if (b.tipo !== "parlay" && b.nombre === nombre && b.partidoId === partidoId && b.mercado === mercado && (b.status || "pending") === "pending") {
        saldoDisp += b.monto; prevKey = k; break;
      }
    }
    if (mInt > saldoDisp) return res.status(400).json({ error: "Saldo insuficiente" });
    if (prevKey) { delete apuestas[prevKey]; }

    j.saldo = saldoDisp - mInt;
    const id = "b" + Date.now() + Math.random().toString(36).slice(2, 6);
    apuestas[id] = { id, tipo: "simple", mercado, nombre, partidoId, pick, monto: mInt, momio: momioDe(partidoId, pick), status: "pending", payout: 0, ts: Date.now() };
    await kv.set("jugadores", jugadores);
    await kv.set("apuestas", apuestas);
    return res.json({ ok: true, jugadores: publicJugadores(jugadores), apuestas });
  }

  // ── APOSTAR PARLAY ─────────────────────────────────────────────────
  if (action === "apostarParlay") {
    const { nombre, legs, monto } = payload;
    const jugadores  = (await kv.get("jugadores"))  || {};
    const apuestas   = (await kv.get("apuestas"))   || {};
    const resultados = (await kv.get("resultados")) || {};
    const j = jugadores[nombre];
    if (!j) return res.status(400).json({ error: "Jugador no existe" });
    if (!Array.isArray(legs) || legs.length < 2) return res.status(400).json({ error: "Un parlay necesita 2+ selecciones" });
    const mInt = Math.floor(Number(monto));
    if (!mInt || mInt < APUESTA_MIN) return res.status(400).json({ error: `Mínimo $${APUESTA_MIN}` });
    if (mInt > j.saldo) return res.status(400).json({ error: "Saldo insuficiente" });

    const vistos = new Set();
    let momioTotal = 1;
    const cleanLegs = [];
    for (const l of legs) {
      const m = BY_ID[l.partidoId];
      if (!m) return res.status(400).json({ error: "Partido inválido en el parlay" });
      if (!MERCADOS_VALIDOS.includes(l.pick)) return res.status(400).json({ error: "Pick inválido en el parlay" });
      if (vistos.has(l.partidoId)) return res.status(400).json({ error: "Solo una selección por partido en un parlay" });
      vistos.add(l.partidoId);
      if (resultados[l.partidoId]) return res.status(400).json({ error: `${m.local} vs ${m.visita} ya tiene resultado` });
      if (Date.now() >= m.kickoff) return res.status(400).json({ error: `${m.local} vs ${m.visita} ya empezó` });
      const mo = momioDe(l.partidoId, l.pick);
      momioTotal *= mo;
      cleanLegs.push({ partidoId: l.partidoId, pick: l.pick, mercado: (l.pick === "over" || l.pick === "under") ? "ou" : "1x2", momio: mo });
    }
    momioTotal = Math.round(momioTotal * 100) / 100;

    j.saldo -= mInt;
    const id = "p" + Date.now() + Math.random().toString(36).slice(2, 6);
    apuestas[id] = { id, tipo: "parlay", nombre, legs: cleanLegs, monto: mInt, momioTotal, status: "pending", payout: 0, ts: Date.now() };
    await kv.set("jugadores", jugadores);
    await kv.set("apuestas", apuestas);
    return res.json({ ok: true, jugadores: publicJugadores(jugadores), apuestas });
  }

  // ── CANCELAR (solo pendientes) ─────────────────────────────────────
  if (action === "cancelar") {
    const { nombre, betId } = payload;
    const jugadores = (await kv.get("jugadores")) || {};
    const apuestas  = (await kv.get("apuestas"))  || {};
    const b = apuestas[betId];
    if (!b) return res.status(400).json({ error: "Apuesta no existe" });
    if (b.nombre !== nombre) return res.status(403).json({ error: "No es tu apuesta" });
    if ((b.status || "pending") !== "pending") return res.status(400).json({ error: "Ya está liquidada" });
    // No cancelar si algún partido involucrado ya empezó
    const ids = b.tipo === "parlay" ? b.legs.map(l => l.partidoId) : [b.partidoId];
    if (ids.some(id => BY_ID[id] && Date.now() >= BY_ID[id].kickoff)) return res.status(400).json({ error: "Un partido ya empezó, no se puede cancelar" });
    if (jugadores[nombre]) jugadores[nombre].saldo += b.monto;
    delete apuestas[betId];
    await kv.set("jugadores", jugadores);
    await kv.set("apuestas", apuestas);
    return res.json({ ok: true, jugadores: publicJugadores(jugadores), apuestas });
  }

  // ── ADMIN: registrar resultado con marcador exacto ─────────────────
  if (action === "resultado") {
    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    const { partidoId, gl, gv } = payload;
    if (partidoId === -1) return res.json({ ok: true }); // ping de validación de clave
    const m = BY_ID[partidoId];
    if (!m) return res.status(400).json({ error: "Partido no existe" });
    const golL = Math.floor(Number(gl)), golV = Math.floor(Number(gv));
    if (isNaN(golL) || isNaN(golV) || golL < 0 || golV < 0 || golL > 30 || golV > 30)
      return res.status(400).json({ error: "Marcador inválido" });
    const jugadores  = (await kv.get("jugadores"))  || {};
    const apuestas   = (await kv.get("apuestas"))   || {};
    const resultados = (await kv.get("resultados")) || {};
    await kv.set("rankPrev", rankingSnapshot(jugadores)); // foto antes de liquidar
    resultados[partidoId] = { gl: golL, gv: golV };
    settleAll(jugadores, apuestas, resultados);
    await kv.set("resultados", resultados);
    await kv.set("jugadores", jugadores);
    await kv.set("apuestas", apuestas);
    return res.json({ ok: true, resultados, jugadores: publicJugadores(jugadores), apuestas });
  }

  // ── ADMIN: revertir/corregir resultado ─────────────────────────────
  if (action === "revertirResultado") {
    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    const { partidoId } = payload;
    const jugadores  = (await kv.get("jugadores"))  || {};
    const apuestas   = (await kv.get("apuestas"))   || {};
    const resultados = (await kv.get("resultados")) || {};
    if (!resultados[partidoId]) return res.status(400).json({ error: "Ese partido no tiene resultado" });
    delete resultados[partidoId];
    settleAll(jugadores, apuestas, resultados); // revierte pagos automáticamente
    await kv.set("resultados", resultados);
    await kv.set("jugadores", jugadores);
    await kv.set("apuestas", apuestas);
    return res.json({ ok: true, resultados, jugadores: publicJugadores(jugadores), apuestas });
  }

  // ── ADMIN: saldos ──────────────────────────────────────────────────
  if (action === "ajustarSaldo") {
    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    const { nombre, monto } = payload;
    const jugadores = (await kv.get("jugadores")) || {};
    if (!jugadores[nombre]) return res.status(400).json({ error: "Jugador no existe" });
    jugadores[nombre].saldo = Math.max(0, jugadores[nombre].saldo + Math.round(Number(monto)));
    await kv.set("jugadores", jugadores);
    return res.json({ ok: true, jugadores: publicJugadores(jugadores) });
  }

  if (action === "bonusTodos") {
    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    const monto = Math.round(Number(payload.monto));
    const jugadores = (await kv.get("jugadores")) || {};
    for (const j of Object.values(jugadores)) j.saldo = Math.max(0, j.saldo + monto);
    await kv.set("jugadores", jugadores);
    return res.json({ ok: true, jugadores: publicJugadores(jugadores) });
  }

  // ── ADMIN: ver apuestas de un partido ──────────────────────────────
  if (action === "verApuestas") {
    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    const { partidoId } = payload;
    const apuestas = (await kv.get("apuestas")) || {};
    const lista = Object.values(apuestas).filter(b =>
      b.tipo === "parlay" ? b.legs.some(l => l.partidoId === partidoId) : b.partidoId === partidoId);
    return res.json({ ok: true, apuestas: lista });
  }

  // ── ADMIN: usuarios ────────────────────────────────────────────────
  if (action === "adminGetUsers") {
    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    const jugadores = (await kv.get("jugadores")) || {};
    const users = Object.values(jugadores).map(j => ({ nombre: j.nombre, pin: j.pin, saldo: j.saldo, creado: j.creado, avatar: j.avatar || null }));
    return res.json({ ok: true, users });
  }

  if (action === "renombrar") {
    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    const { nombreViejo, nombreNuevo } = payload;
    if (!nombreNuevo || !nombreNuevo.trim()) return res.status(400).json({ error: "Nombre inválido" });
    const jugadores = (await kv.get("jugadores")) || {};
    const apuestas  = (await kv.get("apuestas"))  || {};
    if (!jugadores[nombreViejo]) return res.status(400).json({ error: "Jugador no existe" });
    if (jugadores[nombreNuevo]) return res.status(400).json({ error: "Ese nombre ya existe" });
    jugadores[nombreNuevo] = { ...jugadores[nombreViejo], nombre: nombreNuevo };
    delete jugadores[nombreViejo];
    for (const b of Object.values(apuestas)) { if (b.nombre === nombreViejo) b.nombre = nombreNuevo; }
    await kv.set("jugadores", jugadores);
    await kv.set("apuestas", apuestas);
    return res.json({ ok: true, jugadores: publicJugadores(jugadores) });
  }

  if (action === "resetPin") {
    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    const { nombre, nuevoPin } = payload;
    if (!/^\d{4}$/.test(String(nuevoPin))) return res.status(400).json({ error: "PIN debe ser 4 dígitos" });
    const jugadores = (await kv.get("jugadores")) || {};
    if (!jugadores[nombre]) return res.status(400).json({ error: "Jugador no existe" });
    jugadores[nombre].pin = String(nuevoPin);
    await kv.set("jugadores", jugadores);
    return res.json({ ok: true });
  }

  if (action === "borrarJugador") {
    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    const { nombre } = payload;
    const jugadores = (await kv.get("jugadores")) || {};
    const apuestas  = (await kv.get("apuestas"))  || {};
    delete jugadores[nombre];
    for (const [k, b] of Object.entries(apuestas)) { if (b.nombre === nombre) delete apuestas[k]; }
    await kv.set("jugadores", jugadores);
    await kv.set("apuestas", apuestas);
    return res.json({ ok: true, jugadores: publicJugadores(jugadores) });
  }

  if (action === "reset") {
    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    await kv.set("jugadores", {});
    await kv.set("apuestas", {});
    await kv.set("resultados", {});
    await kv.set("rankPrev", {});
    return res.json({ ok: true });
  }

  return res.status(400).json({ error: "Acción no reconocida" });
}
