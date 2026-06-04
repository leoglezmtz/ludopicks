import { kv } from "@vercel/kv";
import { PARTIDOS, SALDO_INICIAL, APUESTA_MIN, LINEAS_OU, LINEA_DEFAULT } from "../lib/data.js";
import { webcrypto } from "crypto";
import crypto from "crypto";

const { subtle } = webcrypto;

// ── WEB PUSH NATIVO (sin dependencias externas) ───────────────
function b64u(s){ return Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/'), 'base64'); }
function toB64u(b){ return Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,''); }

async function vapidJWT(audience){
  const pub=process.env.VAPID_PUBLIC_KEY, priv=process.env.VAPID_PRIVATE_KEY;
  if(!pub||!priv) return null;
  const now=Math.floor(Date.now()/1000);
  const hdr=toB64u(Buffer.from(JSON.stringify({typ:'JWT',alg:'ES256'})));
  const pay=toB64u(Buffer.from(JSON.stringify({aud:audience,exp:now+43200,sub:'mailto:admin@ludopicks.app'})));
  const msg=`${hdr}.${pay}`;
  const rawPriv=b64u(priv), rawPub=b64u(pub);
  const jwk={kty:'EC',crv:'P-256',d:toB64u(rawPriv),x:toB64u(rawPub.slice(1,33)),y:toB64u(rawPub.slice(33,65))};
  const key=await subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const sig=await subtle.sign({name:'ECDSA',hash:'SHA-256'},key,Buffer.from(msg));
  return `${msg}.${toB64u(Buffer.from(sig))}`;
}

async function hkdfExtract(salt,ikm){
  const k=await subtle.importKey('raw',salt,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return Buffer.from(await subtle.sign('HMAC',k,ikm));
}
async function hkdfExpand(prk,info,len){
  const k=await subtle.importKey('raw',prk,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  let t=Buffer.alloc(0),out=Buffer.alloc(0);
  for(let i=1;out.length<len;i++){t=Buffer.from(await subtle.sign('HMAC',k,Buffer.concat([t,info,Buffer.from([i])])));out=Buffer.concat([out,t]);}
  return out.slice(0,len);
}
async function encryptPayload(plaintext, p256dhB64, authB64){
  const recvPub=b64u(p256dhB64), auth=b64u(authB64);
  const sender=await subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const senderPub=Buffer.from(await subtle.exportKey('raw',sender.publicKey));
  const recvKey=await subtle.importKey('raw',recvPub,{name:'ECDH',namedCurve:'P-256'},false,[]);
  const shared=Buffer.from(await subtle.deriveBits({name:'ECDH',public:recvKey},sender.privateKey,256));
  const prk1=await hkdfExtract(auth,shared);
  const ikm=await hkdfExpand(prk1,Buffer.concat([Buffer.from('WebPush: info\x00'),recvPub,senderPub]),32);
  const salt=crypto.randomBytes(16);
  const prk2=await hkdfExtract(salt,ikm);
  const cek=await hkdfExpand(prk2,Buffer.from('Content-Encoding: aes128gcm\x00'),16);
  const nonce=await hkdfExpand(prk2,Buffer.from('Content-Encoding: nonce\x00'),12);
  const aesKey=await subtle.importKey('raw',cek,{name:'AES-GCM'},false,['encrypt']);
  const ct=Buffer.from(await subtle.encrypt({name:'AES-GCM',iv:nonce,tagLength:128},aesKey,Buffer.concat([Buffer.from(plaintext,'utf8'),Buffer.from([2])])));
  const rs=Buffer.alloc(4);rs.writeUInt32BE(4096,0);
  return Buffer.concat([salt,rs,Buffer.from([65]),senderPub,ct]);
}

async function sendPush(sub, payload){
  try{
    if(!sub?.endpoint||!sub?.keys?.p256dh||!sub?.keys?.auth) return;
    if(!process.env.VAPID_PUBLIC_KEY) return;
    const audience=new URL(sub.endpoint).origin;
    const jwt=await vapidJWT(audience);
    if(!jwt) return;
    const body=await encryptPayload(JSON.stringify(payload),sub.keys.p256dh,sub.keys.auth);
    await fetch(sub.endpoint,{method:'POST',headers:{
      'Authorization':`vapid t=${jwt},k=${process.env.VAPID_PUBLIC_KEY}`,
      'Content-Type':'application/octet-stream',
      'Content-Encoding':'aes128gcm',
      'TTL':'86400',
    },body});
  }catch(e){ /* push falla silenciosamente, no rompe la API */ }
}

async function broadcastPush(subs, payload){
  if(!subs||!Object.keys(subs).length) return;
  await Promise.allSettled(Object.values(subs).map(s=>sendPush(s,payload)));
}

const BY_ID = Object.fromEntries(PARTIDOS.map(p => [p.id, p]));
const PICKS_1X2 = ["local", "empate", "visita"];



function publicJugadores(jugadores) {
  const out = {};
  for (const [nombre, j] of Object.entries(jugadores)) {
    out[nombre] = { nombre: j.nombre, saldo: j.saldo, creado: j.creado, avatar: j.avatar || null };
  }
  return out;
}

// ¿Gana este pick dado el marcador? Para over/under usa la línea de la apuesta.
function pickWins(partidoId, r, pick, linea) {
  const m = BY_ID[partidoId];
  if (!m) return false;
  if (pick === "local") return r.gl > r.gv;
  if (pick === "empate") return r.gl === r.gv;
  if (pick === "visita") return r.gl < r.gv;
  const total = r.gl + r.gv;
  if (pick === "over") return total > linea;
  if (pick === "under") return total < linea;
  return false;
}

// Momio real desde el catálogo (nunca confiar en el cliente).
function momioPick(partidoId, pick, linea) {
  const m = BY_ID[partidoId];
  if (!m) return null;
  if (PICKS_1X2.includes(pick)) return m.momios[pick];
  if (pick === "over" || pick === "under") {
    const row = m.ou[String(linea)];
    return row ? row[pick] : null;
  }
  return null;
}
function esMercadoOU(pick) { return pick === "over" || pick === "under"; }
function mercadoDe(pick) { return esMercadoOU(pick) ? "ou" : "1x2"; }

// Motor recalculable: ajusta saldos solo por transiciones de estado.
// Idempotente — sirve igual para registrar y para revertir resultados.
function settleAll(jugadores, apuestas, resultados) {
  for (const b of Object.values(apuestas)) {
    let ns;
    if (b.tipo === "parlay") {
      const sts = b.legs.map(l => {
        const r = resultados[l.partidoId];
        if (!r) return "pending";
        return pickWins(l.partidoId, r, l.pick, l.linea) ? "won" : "lost";
      });
      ns = sts.includes("lost") ? "lost" : sts.every(s => s === "won") ? "won" : "pending";
    } else {
      const r = resultados[b.partidoId];
      ns = !r ? "pending" : (pickWins(b.partidoId, r, b.pick, b.linea) ? "won" : "lost");
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
      lineas_ou: LINEAS_OU, linea_default: LINEA_DEFAULT,
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

  // ── APOSTAR (simple: 1X2 u over/under con línea) ───────────────────
  if (action === "apostar") {
    const { nombre, partidoId, pick, monto, linea } = payload;
    const jugadores  = (await kv.get("jugadores"))  || {};
    const apuestas   = (await kv.get("apuestas"))   || {};
    const resultados = (await kv.get("resultados")) || {};
    const j = jugadores[nombre];
    if (!j) return res.status(400).json({ error: "Jugador no existe" });
    const m = BY_ID[partidoId];
    if (!m) return res.status(400).json({ error: "Partido no existe" });
    const esOU = esMercadoOU(pick);
    if (!PICKS_1X2.includes(pick) && !esOU) return res.status(400).json({ error: "Pick inválido" });
    const lineaUsada = esOU ? Number(linea) : null;
    const momio = momioPick(partidoId, pick, lineaUsada);
    if (momio == null) return res.status(400).json({ error: "Línea o pick inválido" });
    if (resultados[partidoId]) return res.status(400).json({ error: "El partido ya tiene resultado" });
    if (Date.now() >= m.kickoff) return res.status(400).json({ error: "El partido ya empezó, apuestas cerradas" });
    const mInt = Math.floor(Number(monto));
    if (!mInt || mInt < APUESTA_MIN) return res.status(400).json({ error: `Mínimo $${APUESTA_MIN}` });

    const mercado = mercadoDe(pick);
    // Reemplaza apuesta simple previa pendiente del mismo partido+mercado (devuelve su stake)
    let saldoDisp = j.saldo, prevKey = null;
    for (const [k, b] of Object.entries(apuestas)) {
      if (b.tipo !== "parlay" && b.nombre === nombre && b.partidoId === partidoId && b.mercado === mercado && (b.status || "pending") === "pending") {
        saldoDisp += b.monto; prevKey = k; break;
      }
    }
    if (mInt > saldoDisp) return res.status(400).json({ error: "Saldo insuficiente" });
    if (prevKey) delete apuestas[prevKey];

    j.saldo = saldoDisp - mInt;
    const id = "b" + Date.now() + Math.random().toString(36).slice(2, 6);
    apuestas[id] = { id, tipo: "simple", mercado, nombre, partidoId, pick, linea: lineaUsada, monto: mInt, momio, status: "pending", payout: 0, ts: Date.now() };
    await kv.set("jugadores", jugadores);
    await kv.set("apuestas", apuestas);
    return res.json({ ok: true, jugadores: publicJugadores(jugadores), apuestas });
  }

  // ── APOSTAR PARLAY (permite 1X2 + O/U del mismo partido) ───────────
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

    const vistos = new Set();        // clave: partidoId + mercado (evita 2 picks del mismo mercado/partido)
    let momioTotal = 1;
    const cleanLegs = [];
    for (const l of legs) {
      const m = BY_ID[l.partidoId];
      if (!m) return res.status(400).json({ error: "Partido inválido en el parlay" });
      const esOU = esMercadoOU(l.pick);
      if (!PICKS_1X2.includes(l.pick) && !esOU) return res.status(400).json({ error: "Pick inválido en el parlay" });
      const mercado = mercadoDe(l.pick);
      const clave = l.partidoId + "_" + mercado;
      if (vistos.has(clave)) return res.status(400).json({ error: "No puedes repetir el mismo mercado de un partido" });
      vistos.add(clave);
      if (resultados[l.partidoId]) return res.status(400).json({ error: `${m.local} vs ${m.visita} ya tiene resultado` });
      if (Date.now() >= m.kickoff) return res.status(400).json({ error: `${m.local} vs ${m.visita} ya empezó` });
      const lineaUsada = esOU ? Number(l.linea) : null;
      const mo = momioPick(l.partidoId, l.pick, lineaUsada);
      if (mo == null) return res.status(400).json({ error: "Línea o pick inválido en el parlay" });
      momioTotal *= mo;
      cleanLegs.push({ partidoId: l.partidoId, pick: l.pick, linea: lineaUsada, mercado, momio: mo });
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
    await kv.set("rankPrev", rankingSnapshot(jugadores));
    resultados[partidoId] = { gl: golL, gv: golV };
    settleAll(jugadores, apuestas, resultados);
    await kv.set("resultados", resultados);
    await kv.set("jugadores", jugadores);
    await kv.set("apuestas", apuestas);

    // ── Notificaciones push a ganadores ──────────────────────────────
    const subs = (await kv.get("pushSubs")) || {};
    if (Object.keys(subs).length) {
      const partidoLabel = `${m.local} ${golL}-${golV} ${m.visita}`;
      // Colectar ganadores y sus pagos de este partido
      const ganadores = {};
      Object.values(apuestas).forEach(b => {
        if (b.status !== 'won') return;
        const esDeEstePartido = b.tipo === 'parlay'
          ? b.legs.some(l => l.partidoId === partidoId)
          : b.partidoId === partidoId;
        if (!esDeEstePartido) return;
        if (!ganadores[b.nombre]) ganadores[b.nombre] = 0;
        ganadores[b.nombre] += b.payout || 0;
      });
      // Mandar notificación a cada ganador
      await Promise.allSettled(
        Object.entries(ganadores).map(([nombre, pago]) => {
          if (!subs[nombre]) return Promise.resolve();
          const saldo = jugadores[nombre]?.saldo || 0;
          return sendPush(subs[nombre], {
            title: '🎉 ¡Ganaste!',
            body: `${partidoLabel} · +$${pago.toLocaleString('es-MX')} 💰 Saldo: $${Math.round(saldo).toLocaleString('es-MX')}`,
            tag: 'win-' + partidoId,
            url: '/',
          });
        })
      );
    }

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
    const lista = Object.entries(apuestas)
      .filter(([k, b]) => b.tipo === "parlay" ? (b.legs || []).some(l => l.partidoId === partidoId) : b.partidoId === partidoId)
      .map(([k, b]) => ({ ...b, _key: k }));
    return res.json({ ok: true, apuestas: lista });
  }

  // ── ADMIN: borrar una apuesta (devuelve saldo como si nunca hubiera pasado) ──
  if (action === "borrarApuesta") {
    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    const { key } = payload;
    const jugadores = (await kv.get("jugadores")) || {};
    const apuestas  = (await kv.get("apuestas"))  || {};
    const b = apuestas[key];
    if (!b) return res.status(400).json({ error: "Apuesta no existe" });
    const j = jugadores[b.nombre];
    if (j) {
      // Revertir el efecto neto de la apuesta sobre el saldo
      j.saldo += (b.monto || 0);                 // devolver el stake
      if (b.status === "won") j.saldo -= (b.payout || 0); // quitar el pago si había ganado
      j.saldo = Math.max(0, j.saldo);
    }
    delete apuestas[key];
    await kv.set("jugadores", jugadores);
    await kv.set("apuestas", apuestas);
    return res.json({ ok: true, jugadores: publicJugadores(jugadores), apuestas });
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

  // ── Guardar suscripción push de un jugador ─────────────────────────
  if (action === "saveSub") {
    const { nombre, sub } = payload;
    if (!nombre || !sub) return res.status(400).json({ error: "Faltan datos" });
    const subs = (await kv.get("pushSubs")) || {};
    subs[nombre] = sub;
    await kv.set("pushSubs", subs);
    return res.json({ ok: true });
  }

  // ── Admin: enviar notificación manual a todos ──────────────────────
  if (action === "sendPushAdmin") {
    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    const { titulo, mensaje } = payload;
    if (!titulo && !mensaje) return res.status(400).json({ error: "Escribe un título o mensaje" });
    const subs = (await kv.get("pushSubs")) || {};
    await broadcastPush(subs, {
      title: titulo || '🏆 LudoPicks',
      body: mensaje || '',
      tag: 'admin-' + Date.now(),
      url: '/',
    });
    return res.json({ ok: true, enviadas: Object.keys(subs).length });
  }

  // ── RESET ──────────────────────────────────────────────────────────

    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    await kv.set("jugadores", {});
    await kv.set("apuestas", {});
    await kv.set("resultados", {});
    await kv.set("rankPrev", {});
    return res.json({ ok: true });
  }

  return res.status(400).json({ error: "Acción no reconocida" });
}
