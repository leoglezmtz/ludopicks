import { kv } from "@vercel/kv";
import { PARTIDOS, SALDO_INICIAL } from "../lib/data.js";

function publicJugadores(jugadores) {
  const out = {};
  for (const [nombre, j] of Object.entries(jugadores)) {
    out[nombre] = { nombre: j.nombre, saldo: j.saldo, creado: j.creado };
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    const jugadores = (await kv.get("jugadores")) || {};
    const apuestas  = (await kv.get("apuestas"))  || {};
    const resultados= (await kv.get("resultados")) || {};
    return res.json({ jugadores: publicJugadores(jugadores), apuestas, resultados, partidos: PARTIDOS, saldo_inicial: SALDO_INICIAL });
  }

  if (req.method === "POST") {
    const { action, payload } = req.body;

    if (action === "register") {
      const { nombre, pin } = payload;
      if (!nombre || !pin) return res.status(400).json({ error: "Faltan datos" });
      if (!/^\d{4}$/.test(String(pin))) return res.status(400).json({ error: "El PIN debe ser de 4 dígitos" });
      const jugadores = (await kv.get("jugadores")) || {};
      if (jugadores[nombre]) return res.status(400).json({ error: "Ese nombre ya existe, elige otro" });
      jugadores[nombre] = { nombre, pin: String(pin), saldo: SALDO_INICIAL, creado: Date.now() };
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

    if (action === "apostar") {
      const { nombre, partidoId, pick, monto } = payload;
      const jugadores = (await kv.get("jugadores")) || {};
      const apuestas  = (await kv.get("apuestas"))  || {};
      const resultados= (await kv.get("resultados")) || {};

      if (!jugadores[nombre]) return res.status(400).json({ error: "Jugador no existe" });
      if (resultados[partidoId]) return res.status(400).json({ error: "Partido ya tiene resultado" });

      const partido = PARTIDOS.find(p => p.id === partidoId);
      if (!partido) return res.status(400).json({ error: "Partido no existe" });

      const apKey = `${nombre}_${partidoId}`;
      const apuestaExistente = apuestas[apKey];

      if (apuestaExistente) {
        jugadores[nombre].saldo += apuestaExistente.monto;
      }

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
      const jugadores = (await kv.get("jugadores")) || {};
      const apuestas  = (await kv.get("apuestas"))  || {};
      const resultados= (await kv.get("resultados")) || {};

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
        if (ap.pick === resultado) {
          jugadores[ap.nombre].saldo += Math.round(ap.monto * ap.momio);
        }
      });

      await kv.set("resultados", resultados);
      await kv.set("jugadores", jugadores);
      return res.json({ ok: true, resultados, jugadores: publicJugadores(jugadores) });
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
