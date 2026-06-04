import { kv } from "@vercel/kv";
import { PARTIDOS, SALDO_INICIAL } from "../lib/data.js";

function publicJugadores(jugadores) {
  const out = {};
  for (const [nombre, j] of Object.entries(jugadores)) {
    out[nombre] = { nombre: j.nombre, saldo: j.saldo, creado: j.creado, avatar: j.avatar || null };
  }
  return out;
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
    return res.json({ jugadores: publicJugadores(jugadores), apuestas, resultados, partidos: PARTIDOS, saldo_inicial: SALDO_INICIAL });
  }

  if (req.method === "POST") {
    const { action, payload } = req.body;

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

    if (action === "apostar") {
      const { nombre, partidoId, pick, monto } = payload;
      const jugadores  = (await kv.get("jugadores"))  || {};
      const apuestas   = (await kv.get("apuestas"))   || {};
      const resultados = (await kv.get("resultados")) || {};
      if (!jugadores[nombre]) return res.status(400).json({ error: "Jugador no existe" });
      if (resultados[partidoId]) return res.status(400).json({ error: "Partido ya tiene resultado" });
      const partido = PARTIDOS.find(p => p.id === partidoId);
      if (!partido) return res.status(400).json({ error: "Partido no existe" });
      const apKey = `${nombre}_${partidoId}`;
      if (apuestas[apKey]) jugadores[nombre].saldo += apuestas[apKey].monto;
      if (monto > jugadores[nombre].saldo) return res.status(400).json({ error: "Saldo insuficiente" });
      if (monto <= 0) return res.status(400).json({ error: "Monto inválido" });
      jugadores[nombre].saldo -= monto;
      apuestas[apKey] = { nombre, partidoId, pick, monto, momio: partido.momios[pick], ts: Date.now() };
      await kv.set("jugadores", jugadores);
      await kv.set("apuestas", apuestas);
      return res.json({ ok: true, jugadores: publicJugadores(jugadores), apuestas });
    }

    if (action === "cancelar") {
      const { nombre, partidoId } = payload;
      const jugadores  = (await kv.get("jugadores"))  || {};
      const apuestas   = (await kv.get("apuestas"))   || {};
      const resultados = (await kv.get("resultados")) || {};
      if (resultados[partidoId]) return res.status(400).json({ error: "Partido ya tiene resultado" });
      const apKey = `${nombre}_${partidoId}`;
      if (apuestas[apKey]) {
        jugadores[nombre].saldo += apuestas[apKey].monto;
        delete apuestas[apKey];
        await kv.set("jugadores", jugadores);
        await kv.set("apuestas", apuestas);
      }
      return res.json({ ok: true, jugadores: publicJugadores(jugadores), apuestas });
    }

    if (action === "resultado") {
      const { adminKey, partidoId, resultado } = payload;
      if (adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ error: "No autorizado" });
      const jugadores  = (await kv.get("jugadores"))  || {};
      const apuestas   = (await kv.get("apuestas"))   || {};
      const resultados = (await kv.get("resultados")) || {};
      if (resultados[partidoId]) return res.status(400).json({ error: "Ya tiene resultado" });
      resultados[partidoId] = resultado;
      Object.values(apuestas).forEach(ap => {
        if (ap.partidoId !== partidoId) return;
        if (ap.pick === resultado) jugadores[ap.nombre].saldo += Math.round(ap.monto * ap.momio);
      });
      await kv.set("resultados", resultados);
      await kv.set("jugadores", jugadores);
      return res.json({ ok: true, resultados, jugadores: publicJugadores(jugadores) });
    }

    if (action === "ajustarSaldo") {
      const { adminKey, nombre, monto } = payload;
      if (adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ error: "No autorizado" });
      const jugadores = (await kv.get("jugadores")) || {};
      if (!jugadores[nombre]) return res.status(400).json({ error: "Jugador no existe" });
      jugadores[nombre].saldo = Math.max(0, jugadores[nombre].saldo + monto);
      await kv.set("jugadores", jugadores);
      return res.json({ ok: true, jugadores: publicJugadores(jugadores) });
    }

    if (action === "bonusTodos") {
      const { adminKey, monto } = payload;
      if (adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ error: "No autorizado" });
      const jugadores = (await kv.get("jugadores")) || {};
      for (const j of Object.values(jugadores)) j.saldo = Math.max(0, j.saldo + monto);
      await kv.set("jugadores", jugadores);
      return res.json({ ok: true, jugadores: publicJugadores(jugadores) });
    }

    if (action === "verApuestas") {
      const { adminKey, partidoId } = payload;
      if (adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ error: "No autorizado" });
      const apuestas = (await kv.get("apuestas")) || {};
      return res.json({ ok: true, apuestas: Object.values(apuestas).filter(a => a.partidoId === partidoId) });
    }

    if (action === "adminGetUsers") {
      const { adminKey } = payload;
      if (adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ error: "No autorizado" });
      const jugadores = (await kv.get("jugadores")) || {};
      const users = Object.values(jugadores).map(j => ({ nombre: j.nombre, pin: j.pin, saldo: j.saldo, creado: j.creado, avatar: j.avatar || null }));
      return res.json({ ok: true, users });
    }

    if (action === "renombrar") {
      const { adminKey, nombreViejo, nombreNuevo } = payload;
      if (adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ error: "No autorizado" });
      if (!nombreNuevo || !nombreNuevo.trim()) return res.status(400).json({ error: "Nombre inválido" });
      const jugadores = (await kv.get("jugadores")) || {};
      const apuestas  = (await kv.get("apuestas"))  || {};
      if (!jugadores[nombreViejo]) return res.status(400).json({ error: "Jugador no existe" });
      if (jugadores[nombreNuevo]) return res.status(400).json({ error: "Ese nombre ya existe" });
      jugadores[nombreNuevo] = { ...jugadores[nombreViejo], nombre: nombreNuevo };
      delete jugadores[nombreViejo];
      // update apuestas
      const newAp = {};
      for (const [k, ap] of Object.entries(apuestas)) {
        const newK = k.startsWith(nombreViejo + "_") ? nombreNuevo + "_" + k.slice(nombreViejo.length + 1) : k;
        newAp[newK] = { ...ap, nombre: ap.nombre === nombreViejo ? nombreNuevo : ap.nombre };
      }
      await kv.set("jugadores", jugadores);
      await kv.set("apuestas", newAp);
      return res.json({ ok: true, jugadores: publicJugadores(jugadores) });
    }

    if (action === "resetPin") {
      const { adminKey, nombre, nuevoPin } = payload;
      if (adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ error: "No autorizado" });
      if (!/^\d{4}$/.test(String(nuevoPin))) return res.status(400).json({ error: "PIN debe ser 4 dígitos" });
      const jugadores = (await kv.get("jugadores")) || {};
      if (!jugadores[nombre]) return res.status(400).json({ error: "Jugador no existe" });
      jugadores[nombre].pin = String(nuevoPin);
      await kv.set("jugadores", jugadores);
      return res.json({ ok: true });
    }

    if (action === "borrarJugador") {
      const { adminKey, nombre } = payload;
      if (adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ error: "No autorizado" });
      const jugadores = (await kv.get("jugadores")) || {};
      const apuestas  = (await kv.get("apuestas"))  || {};
      delete jugadores[nombre];
      for (const k of Object.keys(apuestas)) {
        if (k.startsWith(nombre + "_")) delete apuestas[k];
      }
      await kv.set("jugadores", jugadores);
      await kv.set("apuestas", apuestas);
      return res.json({ ok: true, jugadores: publicJugadores(jugadores) });
    }

    if (action === "reset") {
      const { adminKey } = payload;
      if (adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ error: "No autorizado" });
      await kv.set("jugadores", {});
      await kv.set("apuestas", {});
      await kv.set("resultados", {});
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: "Acción no reconocida" });
  }
}
