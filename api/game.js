import { kv } from "@vercel/kv";
import { PARTIDOS, SALDO_INICIAL, APUESTA_MIN, LINEAS_OU, LINEA_DEFAULT, LINEAS_CORNERS, LINEA_CORNERS_DEFAULT, MOMIOS_CORNERS, LINEAS_TARJETAS, LINEA_TARJETAS_DEFAULT, MOMIOS_TARJETAS, CAMPEON, CAMPEON_CIERRA, ESPECIAL, ESPECIALES_SEED, RULETA } from "../lib/data.js";
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



function publicJugadores(jugadores, solicitante) {
  const out = {};
  for (const [nombre, j] of Object.entries(jugadores)) {
    const base = { nombre: j.nombre, saldo: j.saldo, creado: j.creado, avatar: j.avatar || null, tickets: j.tickets || 0, doble: !!j.doble, saldoDia: j.saldoDia != null ? j.saldoDia : j.saldo };
    if (nombre === solicitante && j.regalos && j.regalos.length) base.regalos = j.regalos;
    out[nombre] = base;
  }
  return out;
}

// ¿Gana este pick dado el marcador? Para over/under usa la línea de la apuesta.
function pickWins(partidoId, r, pick, linea, mercado) {
  const m = BY_ID[partidoId];
  if (!m) return false;
  if (m.pa && r.pa) {
    if (pick === "local" && r.pa.l) return true;
    if (pick === "visita" && r.pa.v) return true;
  }
  if (pick === "local") return r.gl > r.gv;
  if (pick === "empate") return r.gl === r.gv;
  if (pick === "visita") return r.gl < r.gv;
  if (pick === "over" || pick === "under") {
    let total;
    if (mercado === "corners") total = r.corners;
    else if (mercado === "tarjetas") total = r.tarjetas;
    else total = r.gl + r.gv;
    if (total == null) return false; // mercado aún sin liquidar
    return pick === "over" ? total > linea : total < linea;
  }
  if (pick === "si") return r.gl > 0 && r.gv > 0;
  if (pick === "no") return !(r.gl > 0 && r.gv > 0);
  return false;
}

// Momio real desde el catálogo (nunca confiar en el cliente).
function momioPick(partidoId, pick, linea, mercado) {
  const m = BY_ID[partidoId];
  if (!m) return null;
  if (PICKS_1X2.includes(pick)) return m.momios[pick];
  if (pick === "over" || pick === "under") {
    if (mercado === "corners") return MOMIOS_CORNERS[linea] ? MOMIOS_CORNERS[linea][pick] : null;
    if (mercado === "tarjetas") return MOMIOS_TARJETAS[linea] ? MOMIOS_TARJETAS[linea][pick] : null;
    const row = m.ou[String(linea)];
    return row ? row[pick] : null;
  }
  if (pick === "si" || pick === "no") return m.btts ? m.btts[pick] : null;
  return null;
}
function esMercadoOU(pick) { return pick === "over" || pick === "under"; }
function esBtts(pick) { return pick === "si" || pick === "no"; }
function mercadoDe(pick) { return esMercadoOU(pick) ? "ou" : esBtts(pick) ? "btts" : "1x2"; }

// Sub-mercado de una apuesta O/U: 'goles' (default, legacy), 'corners', 'tarjetas'.
// Las apuestas viejas no tienen este campo o tienen 'goles' implícito.
function ouSub(b) {
  const m = b && b.mercado;
  return (m === 'corners' || m === 'tarjetas') ? m : 'goles';
}
// Key compuesta para evitar dos apuestas pendientes al mismo mercado en el mismo partido.
function mercadoKey(pick, subMercado) {
  if (esMercadoOU(pick)) return 'ou-' + (subMercado || 'goles');
  if (esBtts(pick)) return 'btts';
  return '1x2';
}
const SUB_VALIDOS = new Set(['goles', 'corners', 'tarjetas']);

// Detecta incongruencias entre patas de un MISMO partido en un parlay.
// Retorna un string con el error, o null si todo cuadra. Mensajes amigables.
function validarIncongruenciasParlay(legs) {
  const byMatch = {};
  for (const l of legs) {
    if (!byMatch[l.partidoId]) byMatch[l.partidoId] = [];
    byMatch[l.partidoId].push(l);
  }
  for (const [pid, plegs] of Object.entries(byMatch)) {
    if (plegs.length < 2) continue;
    const m = BY_ID[pid]; if (!m) continue;
    const matchName = `${m.local} vs ${m.visita}`;
    const r1x2 = plegs.find(l => PICKS_1X2.includes(l.pick));
    // Solo O/U de goles entra en estas reglas (córners/tarjetas son mercados independientes)
    const ou   = plegs.find(l => esMercadoOU(l.pick) && (!l.mercado || l.mercado === 'goles'));
    const btts = plegs.find(l => esBtts(l.pick));
    const ouLinea = ou ? Number(ou.linea) : null;

    if (btts && btts.pick === "si" && ou && ou.pick === "under" && ouLinea <= 1.5) {
      return `Imposible en ${matchName}: "Ambos anotan: Sí" requiere al menos 2 goles, pero "Under ${ouLinea}" requiere máximo 1.`;
    }
    if (ou && ou.pick === "under" && ouLinea < 1) {
      if (r1x2 && r1x2.pick !== "empate") {
        return `Imposible en ${matchName}: "Under ${ouLinea}" implica 0-0, pero elegiste a ${r1x2.pick === "local" ? m.local : m.visita} ganador.`;
      }
      if (btts && btts.pick === "si") {
        return `Imposible en ${matchName}: "Under ${ouLinea}" implica 0-0, pero "Ambos anotan: Sí" requiere que ambos anoten.`;
      }
    }
    if (r1x2 && r1x2.pick === "empate" && btts && btts.pick === "no" && ou && ou.pick === "over") {
      return `Imposible en ${matchName}: "Empate + Ambos anotan: No" obliga a 0-0, pero "Over ${ouLinea}" requiere goles.`;
    }
  }
  return null;
}

// Motor recalculable: ajusta saldos solo por transiciones de estado.
// Idempotente — sirve igual para registrar y para revertir resultados.
// Carga el mapa de apuestas especiales desde KV; siembra la inicial (Belinda) si no existe.
async function loadEspeciales() {
  let esp = await kv.get("especiales");
  let changed = false;
  if (!esp) {
    const prevRes = await kv.get("especialRes"); // resultado declarado con el sistema viejo
    esp = {};
    if (ESPECIAL && ESPECIAL.id) {
      esp[ESPECIAL.id] = { ...ESPECIAL, res: prevRes || null, creado: ESPECIAL.cierra - 86400000 };
    }
    changed = true;
  }
  // Inyectar apuestas sembradas por Claude (una sola vez por id; si el admin la borró, no revive)
  if (Array.isArray(ESPECIALES_SEED) && ESPECIALES_SEED.length) {
    const seeded = (await kv.get("seededIds")) || [];
    let seededChanged = false;
    for (const s of ESPECIALES_SEED) {
      if (!seeded.includes(s.id)) {
        if (!esp[s.id]) { esp[s.id] = { ...s }; changed = true; }
        seeded.push(s.id); seededChanged = true;
      }
      // Sincronizar campos visuales (img/tint) aunque ya estuviera sembrada, sin tocar apuestas/resultados
      if (esp[s.id] && s.img && (esp[s.id].img !== s.img || JSON.stringify(esp[s.id].tint || null) !== JSON.stringify(s.tint || null))) {
        esp[s.id].img = s.img; esp[s.id].tint = s.tint; changed = true;
      }
    }
    if (seededChanged) await kv.set("seededIds", seeded);
  }
  if (changed) await kv.set("especiales", esp);
  return esp;
}
function slug(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "").slice(0, 16) || "op";
}

// ── RULETA: helpers ─────────────────────────────────────────────
// Día actual en horario Tijuana (UTC-7), formato YYYY-MM-DD.
function todayTJ() {
  const d = new Date();
  const local = new Date(d.getTime() - 7 * 3600 * 1000);
  return local.toISOString().slice(0, 10);
}
// Asegura que el jugador tenga sus tickets del día (mutar in-place). Retorna true si se dieron.
function grantTicketsIfNew(j) {
  if (!j) return false;
  if (j.tickets == null) j.tickets = 0;
  const hoy = todayTJ();
  if (j.lastTicketDay !== hoy) {
    j.tickets = Math.min((RULETA.ticketsMax || 4), (j.tickets || 0) + (RULETA.ticketsDia || 2));
    j.lastTicketDay = hoy;
    j.saldoDia = j.saldo; // snapshot del saldo al inicio del día
    return true;
  }
  return false;
}
// Concede tickets a TODOS si no los tienen del día. Usado al cargar.
async function grantTicketsAllIfNeeded() {
  const jugadores = (await kv.get("jugadores")) || {};
  let changed = false;
  for (const j of Object.values(jugadores)) if (grantTicketsIfNew(j)) changed = true;
  if (changed) await kv.set("jugadores", jugadores);
  return jugadores;
}
// Elige un segmento de la ruleta según las probabilidades (suma debe ser 1).
function pickSegmento() {
  const r = Math.random();
  let acc = 0;
  for (let i = 0; i < RULETA.segmentos.length; i++) {
    acc += RULETA.segmentos[i].prob;
    if (r <= acc) return i;
  }
  return RULETA.segmentos.length - 1;
}

// ── INSTA-PAGABLE EN VIVO ────────────────────────────────────
// Algunos mercados son irrevocables una vez cumplidos: los pagamos al instante.
//   - BTTS "Sí": ambos anotaron → ya no se deshace.
//   - Over X (goles/córners/tarjetas): contador no puede bajar.
// Los demás (1X2 sin PA, Under, BTTS No) esperan al final.
function pickInstaWonLive(pick, linea, mercado, liveScore) {
  if (!liveScore) return false;
  if (pick === "si") return (liveScore.gl || 0) > 0 && (liveScore.gv || 0) > 0;
  if (pick === "over") {
    let total;
    if (mercado === "corners") total = liveScore.corners;
    else if (mercado === "tarjetas") total = liveScore.tarjetas;
    else total = (liveScore.gl != null) ? (liveScore.gl || 0) + (liveScore.gv || 0) : null;
    if (total == null) return false;
    return total > linea;
  }
  return false;
}

// Evalúa una pata/apuesta de partido considerando: resultado final, parcial PA, o liveScore.
function legStatus(partidoId, r, pick, linea, mercado, liveScore) {
  // Si el liveScore ya tiene la pata DEFINITIVAMENTE cumplida (insta-pagable), 'won'
  if (liveScore && pickInstaWonLive(pick, linea, mercado, liveScore)) return "won";
  if (!r) return "pending";
  if (mercado === "corners") {
    if (r.corners == null) return "pending";
    return pickWins(partidoId, r, pick, linea, "corners") ? "won" : "lost";
  }
  if (mercado === "tarjetas") {
    if (r.tarjetas == null) return "pending";
    return pickWins(partidoId, r, pick, linea, "tarjetas") ? "won" : "lost";
  }
  if (r.gl == null || r.gv == null) {
    const m = BY_ID[partidoId];
    if (m && m.pa && r.pa && ((pick === "local" && r.pa.l) || (pick === "visita" && r.pa.v))) return "won";
    return "pending";
  }
  return pickWins(partidoId, r, pick, linea, mercado) ? "won" : "lost";
}

function settleAll(jugadores, apuestas, resultados, campeon, especiales, liveScores) {
  especiales = especiales || {};
  liveScores = liveScores || {};
  for (const b of Object.values(apuestas)) {
    let ns;
    if (b.tipo === "campeon") {
      ns = !campeon ? "pending" : (b.equipo === campeon ? "won" : "lost");
    } else if (b.tipo === "especial") {
      const sp = especiales[b.especialId];
      const r = sp ? sp.res : null;
      ns = !r ? "pending" : (b.opcion === r ? "won" : "lost");
    } else if (b.tipo === "parlay") {
      const sts = b.legs.map(l => legStatus(l.partidoId, resultados[l.partidoId], l.pick, l.linea, l.mercado, liveScores[l.partidoId]));
      ns = sts.includes("lost") ? "lost" : sts.every(s => s === "won") ? "won" : "pending";
    } else {
      ns = legStatus(b.partidoId, resultados[b.partidoId], b.pick, b.linea, b.mercado, liveScores[b.partidoId]);
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

function rankingSnapshot(jugadores, refPartidoId) {
  const orden = Object.values(jugadores).sort((a, b) => b.saldo - a.saldo);
  const pos = {}, saldo = {};
  let r = 0;
  orden.forEach((j, i) => {
    if (i === 0 || j.saldo !== orden[i-1].saldo) r++;
    pos[j.nombre] = r;
    saldo[j.nombre] = j.saldo;
  });
  return { pos, saldo, partidoId: refPartidoId != null ? refPartidoId : null, ts: Date.now() };
}

// Toma snapshot SOLO si aún no se ha tomado para este partido (o si el actual referencia
// un partido diferente). Esto preserva el estado "antes del primer movimiento" cuando hay
// múltiples actualizaciones (live → live → final → corrección) sobre el mismo partido.
async function snapshotIfFirstTouch(jugadores, partidoId) {
  if (partidoId == null) return false;
  const cur = (await kv.get("rankPrev")) || {};
  // Si el snapshot ya pertenece a este partido, NO sobrescribir (preservar el original)
  if (cur.partidoId === partidoId) return false;
  await kv.set("rankPrev", rankingSnapshot(jugadores, partidoId));
  return true;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    const jugadores  = await grantTicketsAllIfNeeded(); // concede tickets diarios automáticamente
    const apuestas   = (await kv.get("apuestas"))   || {};
    const resultados = (await kv.get("resultados")) || {};
    const rankPrev   = (await kv.get("rankPrev"))   || {};
    const campeon    = (await kv.get("campeon"))    || null;
    const especiales = await loadEspeciales();
    const jackpot    = (await kv.get("jackpot")) ?? RULETA.jackpotSemilla;
    const ruletaHist = (await kv.get("ruletaHist")) || [];
    const liveScores = (await kv.get("liveScores")) || {};
    const tabla_orden = (await kv.get("tabla_orden")) || {};
    return res.json({
      jugadores: publicJugadores(jugadores, req.query.nombre || null), apuestas, resultados, rankPrev,
      partidos: PARTIDOS, saldo_inicial: SALDO_INICIAL, apuesta_min: APUESTA_MIN,
      lineas_ou: LINEAS_OU, linea_default: LINEA_DEFAULT,
      lineas_corners: LINEAS_CORNERS, linea_corners_default: LINEA_CORNERS_DEFAULT, momios_corners: MOMIOS_CORNERS,
      lineas_tarjetas: LINEAS_TARJETAS, linea_tarjetas_default: LINEA_TARJETAS_DEFAULT, momios_tarjetas: MOMIOS_TARJETAS,
      campeon_odds: CAMPEON, campeon_cierra: CAMPEON_CIERRA, campeon,
      especiales,
      ruleta: RULETA, jackpot, ruletaHist, liveScores, tabla_orden,
      fairplay: (await kv.get("fairplay")) || {},
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
    const { nombre, partidoId, pick, monto, linea, mercado: subMkt } = payload;
    const jugadores  = (await kv.get("jugadores"))  || {};
    const apuestas   = (await kv.get("apuestas"))   || {};
    const resultados = (await kv.get("resultados")) || {};
    const j = jugadores[nombre];
    if (!j) return res.status(400).json({ error: "Jugador no existe" });
    const m = BY_ID[partidoId];
    if (!m) return res.status(400).json({ error: "Partido no existe" });
    const esOU = esMercadoOU(pick);
    if (!PICKS_1X2.includes(pick) && !esOU && !esBtts(pick)) return res.status(400).json({ error: "Pick inválido" });
    const subMercado = (esOU && SUB_VALIDOS.has(subMkt)) ? subMkt : 'goles';
    const lineaUsada = esOU ? Number(linea) : null;
    // Validar línea según sub-mercado
    if (esOU) {
      if (subMercado === 'corners' && !LINEAS_CORNERS.includes(lineaUsada)) return res.status(400).json({ error: "Línea de córners inválida" });
      if (subMercado === 'tarjetas' && !LINEAS_TARJETAS.includes(lineaUsada)) return res.status(400).json({ error: "Línea de tarjetas inválida" });
      if (subMercado === 'goles' && !LINEAS_OU.includes(lineaUsada)) return res.status(400).json({ error: "Línea de goles inválida" });
    }
    const momio = momioPick(partidoId, pick, lineaUsada, subMercado);
    if (momio == null) return res.status(400).json({ error: "Línea o pick inválido" });
    // Permitir apuestas a córners/tarjetas aunque ya haya marcador final, mientras no esté ya liquidado ese sub-mercado
    const r = resultados[partidoId];
    if (r) {
      if (subMercado === 'goles' && r.gl != null) return res.status(400).json({ error: "El partido ya tiene resultado" });
      if (subMercado === 'corners' && r.corners != null) return res.status(400).json({ error: "Los córners ya se liquidaron" });
      if (subMercado === 'tarjetas' && r.tarjetas != null) return res.status(400).json({ error: "Las tarjetas ya se liquidaron" });
    }
    if (Date.now() >= m.kickoff) return res.status(400).json({ error: "El partido ya empezó, apuestas cerradas" });
    const mInt = Math.floor(Number(monto));
    if (!mInt || mInt < APUESTA_MIN) return res.status(400).json({ error: `Mínimo $${APUESTA_MIN}` });

    const mktKey = mercadoKey(pick, subMercado);
    // Reemplaza apuesta simple previa pendiente del mismo partido+mercado (devuelve su stake)
    let saldoDisp = j.saldo, prevKey = null;
    for (const [k, b] of Object.entries(apuestas)) {
      if (b.tipo !== "parlay" && b.nombre === nombre && b.partidoId === partidoId && (b.status || "pending") === "pending") {
        const bKey = mercadoKey(b.pick, ouSub(b));
        if (bKey === mktKey) { saldoDisp += b.monto; prevKey = k; break; }
      }
    }
    if (mInt > saldoDisp) return res.status(400).json({ error: "Saldo insuficiente" });
    if (prevKey) delete apuestas[prevKey];

    j.saldo = saldoDisp - mInt;
    const id = "b" + Date.now() + Math.random().toString(36).slice(2, 6);
    apuestas[id] = { id, tipo: "simple", mercado: esOU ? subMercado : (esBtts(pick) ? 'btts' : '1x2'), nombre, partidoId, pick, linea: lineaUsada, monto: mInt, momio, status: "pending", payout: 0, ts: Date.now() };
    await kv.set("jugadores", jugadores);
    await kv.set("apuestas", apuestas);
    return res.json({ ok: true, jugadores: publicJugadores(jugadores), apuestas });
  }

  // ── APOSTAR CAMPEÓN DEL MUNDIAL (outright, cierra al 1er partido) ──
  if (action === "apostarCampeon") {
    const { nombre, equipo, monto } = payload;
    const jugadores = (await kv.get("jugadores")) || {};
    const apuestas  = (await kv.get("apuestas"))  || {};
    const j = jugadores[nombre];
    if (!j) return res.status(400).json({ error: "Jugador no existe" });
    const momio = CAMPEON[equipo];
    if (!momio) return res.status(400).json({ error: "Equipo inválido" });
    if (Date.now() >= CAMPEON_CIERRA) return res.status(400).json({ error: "Apuesta de campeón cerrada (ya inició el Mundial)" });
    if (await kv.get("campeon")) return res.status(400).json({ error: "El campeón ya fue declarado" });
    const mInt = Math.floor(Number(monto));
    if (!mInt || mInt < APUESTA_MIN) return res.status(400).json({ error: `Mínimo $${APUESTA_MIN}` });
    // Una sola apuesta de campeón por jugador: si ya tiene una pendiente, se reemplaza
    const prevKey = Object.keys(apuestas).find(k => apuestas[k].tipo === "campeon" && apuestas[k].nombre === nombre && (apuestas[k].status || "pending") === "pending");
    let saldoDisp = j.saldo;
    if (prevKey) { saldoDisp += apuestas[prevKey].monto; delete apuestas[prevKey]; }
    if (mInt > saldoDisp) return res.status(400).json({ error: "Saldo insuficiente" });
    j.saldo = saldoDisp - mInt;
    const id = "b" + Date.now() + Math.random().toString(36).slice(2, 6);
    apuestas[id] = { id, tipo: "campeon", nombre, equipo, monto: mInt, momio, status: "pending", payout: 0, ts: Date.now() };
    await kv.set("jugadores", jugadores);
    await kv.set("apuestas", apuestas);
    return res.json({ ok: true, jugadores: publicJugadores(jugadores), apuestas });
  }

  // ── ADMIN: declarar campeón del Mundial (liquida los outrights) ───
  if (action === "setCampeon") {
    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    const { equipo } = payload;
    if (equipo && !CAMPEON[equipo]) return res.status(400).json({ error: "Equipo inválido" });
    const jugadores  = (await kv.get("jugadores"))  || {};
    const apuestas   = (await kv.get("apuestas"))   || {};
    const resultados = (await kv.get("resultados")) || {};
    const liveScoresC = (await kv.get("liveScores")) || {};
    await kv.set("rankPrev", rankingSnapshot(jugadores, null));
    await kv.set("campeon", equipo || null);
    settleAll(jugadores, apuestas, resultados, equipo || null, await loadEspeciales(), liveScoresC);
    await kv.set("jugadores", jugadores);
    await kv.set("apuestas", apuestas);
    return res.json({ ok: true, jugadores: publicJugadores(jugadores), apuestas, campeon: equipo || null });
  }

  // ── APOSTAR EN UNA ESPECIAL (por id) ──────────────────────────────
  if (action === "apostarEspecial") {
    const { nombre, especialId, opcion, monto } = payload;
    const jugadores = (await kv.get("jugadores")) || {};
    const apuestas  = (await kv.get("apuestas"))  || {};
    const especiales = await loadEspeciales();
    const j = jugadores[nombre];
    if (!j) return res.status(400).json({ error: "Jugador no existe" });
    const sp = especiales[especialId];
    if (!sp || sp.activo === false) return res.status(400).json({ error: "Esa apuesta especial no está disponible" });
    const op = sp.opciones.find(o => o.key === opcion);
    if (!op) return res.status(400).json({ error: "Opción inválida" });
    if (Date.now() >= sp.cierra) return res.status(400).json({ error: "Apuesta especial cerrada" });
    if (sp.res) return res.status(400).json({ error: "El resultado ya fue declarado" });
    const mInt = Math.floor(Number(monto));
    if (!mInt || mInt < APUESTA_MIN) return res.status(400).json({ error: `Mínimo $${APUESTA_MIN}` });
    // Una apuesta por jugador POR especial (se reemplaza la previa pendiente de esa especial)
    const prevKey = Object.keys(apuestas).find(k => apuestas[k].tipo === "especial" && apuestas[k].especialId === especialId && apuestas[k].nombre === nombre && (apuestas[k].status || "pending") === "pending");
    let saldoDisp = j.saldo;
    if (prevKey) { saldoDisp += apuestas[prevKey].monto; delete apuestas[prevKey]; }
    if (mInt > saldoDisp) return res.status(400).json({ error: "Saldo insuficiente" });
    j.saldo = saldoDisp - mInt;
    const id = "b" + Date.now() + Math.random().toString(36).slice(2, 6);
    apuestas[id] = { id, tipo: "especial", especialId, especialTitulo: sp.titulo, nombre, opcion, opcionLabel: op.label, opcionEmoji: op.emoji, monto: mInt, momio: op.momio, status: "pending", payout: 0, ts: Date.now() };
    await kv.set("jugadores", jugadores);
    await kv.set("apuestas", apuestas);
    return res.json({ ok: true, jugadores: publicJugadores(jugadores), apuestas });
  }

  // ── ADMIN: crear una apuesta especial ─────────────────────────────
  if (action === "crearEspecial") {
    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    const { titulo, emoji, pregunta, nota, cierra, opciones, img, tint } = payload;
    if (!titulo || !pregunta) return res.status(400).json({ error: "Falta título o pregunta" });
    if (!Array.isArray(opciones) || opciones.length < 2) return res.status(400).json({ error: "Pon al menos 2 opciones" });
    const cierraMs = Number(cierra);
    if (!cierraMs || isNaN(cierraMs)) return res.status(400).json({ error: "Fecha de cierre inválida" });
    const usedKeys = {};
    const ops = opciones.map((o, i) => {
      let k = slug(o.label); if (usedKeys[k]) k = k + i; usedKeys[k] = 1;
      const m = Number(o.momio);
      return { key: k, label: String(o.label || "Opción " + (i + 1)).slice(0, 40), emoji: o.emoji || "▫️", momio: (m && m >= 1.01) ? Math.round(m * 100) / 100 : 2 };
    });
    const especiales = await loadEspeciales();
    const id = "esp" + Date.now().toString(36);
    const imgClean = (img && /^https?:\/\//i.test(String(img).trim())) ? String(img).trim() : "";
    especiales[id] = { id, titulo: String(titulo).slice(0, 60), emoji: emoji || "✨", pregunta: String(pregunta).slice(0, 200), nota: nota ? String(nota).slice(0, 120) : "", cierra: cierraMs, opciones: ops, img: imgClean, tint: (Array.isArray(tint) && tint.length === 2) ? tint : null, res: null, activo: true, creado: Date.now() };
    await kv.set("especiales", especiales);
    return res.json({ ok: true, especiales });
  }

  // ── ADMIN: editar una apuesta especial existente ──────────────────
  if (action === "editarEspecial") {
    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    const { especialId, titulo, emoji, pregunta, nota, cierra, opciones, img, tint, activo, archivada } = payload;
    const especiales = await loadEspeciales();
    const sp = especiales[especialId];
    if (!sp) return res.status(400).json({ error: "Especial no existe" });
    if (titulo !== undefined && String(titulo).trim()) sp.titulo = String(titulo).slice(0, 60);
    if (emoji !== undefined && String(emoji).trim()) sp.emoji = String(emoji).slice(0, 4);
    if (pregunta !== undefined && String(pregunta).trim()) sp.pregunta = String(pregunta).slice(0, 200);
    if (nota !== undefined) sp.nota = nota ? String(nota).slice(0, 120) : "";
    if (cierra !== undefined) { const c = Number(cierra); if (c && !isNaN(c)) sp.cierra = c; }
    if (img !== undefined) sp.img = (img && /^https?:\/\//i.test(String(img).trim())) ? String(img).trim() : "";
    if (Array.isArray(tint) && tint.length === 2) sp.tint = tint;
    if (typeof activo === "boolean") sp.activo = activo;
    if (typeof archivada === "boolean") sp.archivada = archivada;
    if (Array.isArray(opciones) && opciones.length >= 2) {
      const usedKeys = {};
      sp.opciones = opciones.map((o, i) => {
        let k = o.key && String(o.key).trim() ? String(o.key) : slug(o.label);
        if (usedKeys[k]) k = k + i; usedKeys[k] = 1;
        const m = Number(o.momio);
        return { key: k, label: String(o.label || "Opción " + (i + 1)).slice(0, 40), emoji: o.emoji || "▫️", momio: (m && m >= 1.01) ? Math.round(m * 100) / 100 : 2 };
      });
      if (sp.res && !sp.opciones.find(o => o.key === sp.res)) sp.res = null; // el ganador ya no existe → revertir
    }
    await kv.set("especiales", especiales);
    // Re-liquidar por consistencia (idempotente; las apuestas guardan su propio momio)
    const jugadores  = (await kv.get("jugadores"))  || {};
    const apuestas   = (await kv.get("apuestas"))   || {};
    const resultados = (await kv.get("resultados")) || {};
    const campeon    = (await kv.get("campeon"))    || null;
    settleAll(jugadores, apuestas, resultados, campeon, especiales, (await kv.get("liveScores")) || {});
    await kv.set("jugadores", jugadores);
    await kv.set("apuestas", apuestas);
    return res.json({ ok: true, especiales, jugadores: publicJugadores(jugadores), apuestas });
  }

  // ── ADMIN: declarar resultado de una especial (por id) ────────────
  if (action === "setEspecial") {
    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    const { especialId, opcion } = payload;
    const especiales = await loadEspeciales();
    const sp = especiales[especialId];
    if (!sp) return res.status(400).json({ error: "Especial no existe" });
    if (opcion && !sp.opciones.find(o => o.key === opcion)) return res.status(400).json({ error: "Opción inválida" });
    const jugadores  = (await kv.get("jugadores"))  || {};
    const apuestas   = (await kv.get("apuestas"))   || {};
    const resultados = (await kv.get("resultados")) || {};
    const campeon    = (await kv.get("campeon"))    || null;
    await kv.set("rankPrev", rankingSnapshot(jugadores, null));
    sp.res = opcion || null;
    await kv.set("especiales", especiales);
    settleAll(jugadores, apuestas, resultados, campeon, especiales, (await kv.get("liveScores")) || {});
    await kv.set("jugadores", jugadores);
    await kv.set("apuestas", apuestas);
    return res.json({ ok: true, jugadores: publicJugadores(jugadores), apuestas, especiales });
  }

  // ── ADMIN: borrar una especial (devuelve el dinero de sus apuestas) ──
  if (action === "borrarEspecial") {
    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    const { especialId } = payload;
    const especiales = await loadEspeciales();
    if (!especiales[especialId]) return res.status(400).json({ error: "Especial no existe" });
    const jugadores = (await kv.get("jugadores")) || {};
    const apuestas  = (await kv.get("apuestas"))  || {};
    // Revertir cada apuesta de esa especial como si nunca hubiera pasado
    for (const k of Object.keys(apuestas)) {
      const b = apuestas[k];
      if (b.tipo === "especial" && b.especialId === especialId) {
        const jj = jugadores[b.nombre];
        if (jj) { if ((b.status) === "won") jj.saldo -= (b.payout || 0); jj.saldo += b.monto; }
        delete apuestas[k];
      }
    }
    delete especiales[especialId];
    await kv.set("especiales", especiales);
    await kv.set("jugadores", jugadores);
    await kv.set("apuestas", apuestas);
    return res.json({ ok: true, jugadores: publicJugadores(jugadores), apuestas, especiales });
  }

  // ── RULETA: girar (descuenta 1 ticket, devuelve premio) ────────────
  if (action === "girarRuleta") {
    const { nombre } = payload;
    const jugadores = (await kv.get("jugadores")) || {};
    const apuestasAll = (await kv.get("apuestas")) || {};
    const j = jugadores[nombre];
    if (!j) return res.status(400).json({ error: "Jugador no existe" });
    grantTicketsIfNew(j);
    if ((j.tickets || 0) <= 0) return res.status(400).json({ error: "No tienes tickets. ¡Vuelve mañana!" });
    // Candado de rescate: saldo + apuestas activas (pendientes) deben ser < lockLimit
    const enJuego = Object.values(apuestasAll)
      .filter(b => b.nombre === nombre && (b.status || "pending") === "pending")
      .reduce((a, b) => a + (b.monto || 0), 0);
    const totalParaCandado = (j.saldo || 0) + enJuego;
    if (totalParaCandado >= RULETA.lockLimit) {
      return res.status(403).json({ error: `La ruleta es para rescate · gira cuando bajes de $${RULETA.lockLimit.toLocaleString()}`, locked: true, totalParaCandado });
    }
    j.tickets -= 1;
    let jackpot = Number((await kv.get("jackpot")) ?? RULETA.jackpotSemilla);
    jackpot += RULETA.jackpotAporte;
    const segIdx = pickSegmento();
    const seg = RULETA.segmentos[segIdx];
    let premio = { tipo: seg.tipo, label: seg.label, emoji: seg.emoji || '', ganancia: 0, mensaje: '' };
    let extra = {};
    if (seg.tipo === "money") {
      j.saldo += seg.valor;
      premio.ganancia = seg.valor;
      premio.mensaje = `¡Te ganaste $${seg.valor.toLocaleString()} de feria!`;
    } else if (seg.tipo === "jackpot") {
      j.saldo += jackpot;
      premio.ganancia = jackpot;
      premio.mensaje = `🎰 ¡JACKPOT! Te llevaste $${jackpot.toLocaleString()}. Leyenda del grupo.`;
      extra.jackpotGanado = jackpot;
      jackpot = RULETA.jackpotSemilla;
    } else if (seg.tipo === "social") {
      // Quitar feria al líder de la tabla (no a sí mismo)
      const orden = Object.values(jugadores).filter(x => x.nombre !== nombre).sort((a, b) => b.saldo - a.saldo);
      const lider = orden[0];
      const robo = lider ? Math.min(seg.valor, Math.max(0, lider.saldo)) : 0;
      if (lider && robo > 0) {
        lider.saldo -= robo;
        premio.ganancia = 0; // el "premio social" no le da feria al girador, sólo al líder se la quita
        premio.mensaje = `😈 Le bajaste $${robo.toLocaleString()} a ${lider.nombre}. El chat va a arder 🔥`;
        extra.victimaRobo = lider.nombre;
        extra.robo = robo;
        extra.liderNombre = lider.nombre;
      } else {
        premio.mensaje = `😈 Premio social, pero no había a quién bajarle (todos en cero).`;
      }
    } else if (seg.tipo === "nada") {
      premio.mensaje = `😅 La ruleta no te quiso. ¡Inventa Romario!`;
    }
    await kv.set("jackpot", jackpot);
    await kv.set("jugadores", jugadores);
    // Registrar tirada en historial (últimas 60)
    const hist = (await kv.get("ruletaHist")) || [];
    hist.unshift({
      who: nombre, type: seg.tipo, value: seg.tipo === "jackpot" ? extra.jackpotGanado : (seg.valor || 0),
      victima: extra.liderNombre || null, t: Date.now(),
    });
    if (hist.length > 60) hist.length = 60;
    await kv.set("ruletaHist", hist);
    // Push al líder cuando le bajan feria
    if (extra.victimaRobo) {
      const subs = (await kv.get("pushSubs")) || {};
      if (subs[extra.victimaRobo]) {
        try { await sendPush(subs[extra.victimaRobo], { title: '😈 ¡Te bajaron feria en la ruleta!', body: `${nombre} te quitó $${extra.robo.toLocaleString()} con un giro de suerte`, tag: 'robo-' + Date.now(), url: '/' }); } catch (e) {}
      }
    }
    return res.json({ ok: true, jugadores: publicJugadores(jugadores), jackpot, segIdx, premio, extra, ruletaHist: hist });
  }

  // ── ADMIN: dar tickets de ruleta ───────────────────────────────────
  if (action === "darTickets") {
    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    const { nombre, cantidad, mensaje } = payload;
    const cant = Math.max(1, Math.min(20, Math.floor(Number(cantidad) || 1)));
    const jugadores = (await kv.get("jugadores")) || {};
    if (nombre) {
      if (!jugadores[nombre]) return res.status(400).json({ error: "Jugador no existe" });
      jugadores[nombre].tickets = (jugadores[nombre].tickets || 0) + cant;
    } else {
      for (const j of Object.values(jugadores)) j.tickets = (j.tickets || 0) + cant;
    }
    await kv.set("jugadores", jugadores);
    if (mensaje && mensaje.trim()) {
      const subs = (await kv.get("pushSubs")) || {};
      const body = mensaje.trim();
      if (nombre && subs[nombre]) { try { await sendPush(subs[nombre], { title: '🎰 LudoPicks', body, tag: 'tix-' + Date.now(), url: '/' }); } catch (e) {} }
      else if (!nombre) { try { await broadcastPush(subs, { title: '🎰 LudoPicks', body, tag: 'tix-' + Date.now(), url: '/' }); } catch (e) {} }
    }
    return res.json({ ok: true, jugadores: publicJugadores(jugadores) });
  }

  // ── ADMIN: regalo unificado (tickets O feria) a grupo de jugadores ──
  if (action === "regaloUnif") {
    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    const { kind, cantidad, destinatarios, titulo, descripcion } = payload;
    if (!["tickets","feria"].includes(kind)) return res.status(400).json({ error: "kind inválido" });
    const cant = Math.max(1, Math.min(99999, Math.floor(Number(cantidad) || 1)));
    if (!Array.isArray(destinatarios) || !destinatarios.length) return res.status(400).json({ error: "Sin destinatarios" });
    const jugadores = (await kv.get("jugadores")) || {};
    const pushTitle = (titulo || "🎁 ¡Tienes un regalo!").trim();
    const pushBody = (descripcion || (kind === "tickets" ? `🎟️ +${cant} ticket${cant !== 1 ? "s" : ""} de ruleta — ábrela para reclamarlo` : `💵 +$${cant.toLocaleString()} de feria — ábrela para reclamarlo`)).trim();
    const subs = (await kv.get("pushSubs")) || {};
    for (const nom of destinatarios) {
      const j = jugadores[nom]; if (!j) continue;
      // Guardar como regalo pendiente en lugar de aplicar directo
      if (!j.regalos) j.regalos = [];
      j.regalos.push({ kind, cantidad: cant, titulo: pushTitle, ts: Date.now() });
      // Push siempre al enviar regalo
      if (subs[nom]) { try { await sendPush(subs[nom], { title: pushTitle, body: pushBody, tag: "regalo-" + Date.now(), url: "/" }); } catch (e) {} }
    }
    await kv.set("jugadores", jugadores);
    return res.json({ ok: true, jugadores: publicJugadores(jugadores) });
  }

  if (action === "reclamarRegalos") {
    const { nombre, pin } = payload;
    const jugadores = (await kv.get("jugadores")) || {};
    const j = jugadores[nombre];
    if (!j || String(j.pin) !== String(pin)) return res.status(403).json({ error: "No autorizado" });
    const regalos = j.regalos || [];
    if (!regalos.length) return res.json({ ok: true, jugadores: publicJugadores(jugadores, nombre) });
    for (const r of regalos) {
      if (r.kind === "tickets") j.tickets = (j.tickets || 0) + r.cantidad;
      else j.saldo += r.cantidad;
    }
    j.regalos = [];
    await kv.set("jugadores", jugadores);
    return res.json({ ok: true, reclamados: regalos, jugadores: publicJugadores(jugadores, nombre) });
  }

  if (action === "ajustarSaldo") {
    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    const { nombre, delta, setSaldo } = payload;
    if (!nombre) return res.status(400).json({ error: "Faltan datos" });
    const jugadores = (await kv.get("jugadores")) || {};
    const j = jugadores[nombre];
    if (!j) return res.status(404).json({ error: "Jugador no encontrado" });
    j.saldo = setSaldo !== undefined ? Number(setSaldo) : (j.saldo || 0) + Number(delta || 0);
    // Actualizar rankPrev para que el delta no se muestre
    const rankPrev = (await kv.get("rankPrev")) || {};
    if (rankPrev.saldo) rankPrev.saldo[nombre] = j.saldo;
    await kv.set("jugadores", jugadores);
    await kv.set("rankPrev", rankPrev);
    return res.json({ ok: true, nombre, saldo: j.saldo, jugadores: publicJugadores(jugadores) });
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

    const vistos = new Set();
    let momioTotal = 1;
    const cleanLegs = [];
    for (const l of legs) {
      const m = BY_ID[l.partidoId];
      if (!m) return res.status(400).json({ error: "Partido inválido en el parlay" });
      const esOU = esMercadoOU(l.pick);
      if (!PICKS_1X2.includes(l.pick) && !esOU && !esBtts(l.pick)) return res.status(400).json({ error: "Pick inválido en el parlay" });
      const subMercado = (esOU && SUB_VALIDOS.has(l.mercado)) ? l.mercado : 'goles';
      const mktKey = mercadoKey(l.pick, subMercado);
      const clave = l.partidoId + "_" + mktKey;
      if (vistos.has(clave)) return res.status(400).json({ error: "No puedes repetir el mismo mercado de un partido" });
      vistos.add(clave);
      // Solo bloquear si ese sub-mercado ya está liquidado
      const r = resultados[l.partidoId];
      if (r) {
        if (subMercado === 'goles' && r.gl != null) return res.status(400).json({ error: `${m.local} vs ${m.visita} ya tiene resultado` });
        if (subMercado === 'corners' && r.corners != null) return res.status(400).json({ error: `Córners de ${m.local} vs ${m.visita} ya liquidados` });
        if (subMercado === 'tarjetas' && r.tarjetas != null) return res.status(400).json({ error: `Tarjetas de ${m.local} vs ${m.visita} ya liquidadas` });
      }
      if (Date.now() >= m.kickoff) return res.status(400).json({ error: `${m.local} vs ${m.visita} ya empezó` });
      const lineaUsada = esOU ? Number(l.linea) : null;
      if (esOU) {
        if (subMercado === 'corners' && !LINEAS_CORNERS.includes(lineaUsada)) return res.status(400).json({ error: "Línea de córners inválida en el parlay" });
        if (subMercado === 'tarjetas' && !LINEAS_TARJETAS.includes(lineaUsada)) return res.status(400).json({ error: "Línea de tarjetas inválida en el parlay" });
        if (subMercado === 'goles' && !LINEAS_OU.includes(lineaUsada)) return res.status(400).json({ error: "Línea de goles inválida en el parlay" });
      }
      const mo = momioPick(l.partidoId, l.pick, lineaUsada, subMercado);
      if (mo == null) return res.status(400).json({ error: "Línea o pick inválido en el parlay" });
      momioTotal *= mo;
      cleanLegs.push({ partidoId: l.partidoId, pick: l.pick, linea: lineaUsada, mercado: esOU ? subMercado : (esBtts(l.pick) ? 'btts' : '1x2'), momio: mo });
    }
    momioTotal = Math.round(momioTotal * 100) / 100;

    // Bloquear parlays con incongruencias matemáticas (ej. Under 1.5 + Ambos anotan: Sí)
    const incongruencia = validarIncongruenciasParlay(cleanLegs);
    if (incongruencia) return res.status(400).json({ error: incongruencia, incongruencia: true });

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
    if (b.tipo === "campeon") {
      if (Date.now() >= CAMPEON_CIERRA || (await kv.get("campeon"))) return res.status(400).json({ error: "Ya no se puede cancelar (Mundial en curso)" });
      if (jugadores[nombre]) jugadores[nombre].saldo += b.monto;
      delete apuestas[betId];
      await kv.set("jugadores", jugadores);
      await kv.set("apuestas", apuestas);
      return res.json({ ok: true, jugadores: publicJugadores(jugadores), apuestas });
    }
    if (b.tipo === "especial") {
      const especiales = await loadEspeciales();
      const sp = especiales[b.especialId];
      if (!sp || Date.now() >= sp.cierra || sp.res) return res.status(400).json({ error: "Ya no se puede cancelar (apuesta cerrada)" });
      if (jugadores[nombre]) jugadores[nombre].saldo += b.monto;
      delete apuestas[betId];
      await kv.set("jugadores", jugadores);
      await kv.set("apuestas", apuestas);
      return res.json({ ok: true, jugadores: publicJugadores(jugadores), apuestas });
    }
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
  // ── ADMIN: aplicar Pago Anticipado EN VIVO (sin marcador final) ────
  // ── ADMIN: actualizar marcador EN VIVO sin liquidar nada ─────
  // Estilo "Draftea": admin va actualizando gl/gv durante el partido para que
  // los jugadores vean su progreso. NO afecta apuestas — solo informativo.
  if (action === "setLiveScore") {
    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    const { partidoId, gl, gv, corners, tarjetas } = payload;
    const m = BY_ID[partidoId];
    if (!m) return res.status(400).json({ error: "Partido no existe" });
    // Si el partido YA tiene resultado final (no parcial), no permitir live updates
    const resultados = (await kv.get("resultados")) || {};
    const r = resultados[partidoId];
    if (r && r.gl != null && !r.parcial) return res.status(400).json({ error: "El partido ya está liquidado. Edita el resultado en su lugar." });
    const live = (await kv.get("liveScores")) || {};
    const entry = { ts: Date.now() };
    if (gl != null && gl !== '') { const g = Math.floor(Number(gl)); if (!isNaN(g) && g >= 0 && g <= 30) entry.gl = g; }
    if (gv != null && gv !== '') { const g = Math.floor(Number(gv)); if (!isNaN(g) && g >= 0 && g <= 30) entry.gv = g; }
    if (corners != null && corners !== '') { const c = Math.floor(Number(corners)); if (!isNaN(c) && c >= 0 && c <= 50) entry.corners = c; }
    if (tarjetas != null && tarjetas !== '') { const t = Math.floor(Number(tarjetas)); if (!isNaN(t) && t >= 0 && t <= 30) entry.tarjetas = t; }
    // Si todos los campos vienen vacíos, limpiar
    if (Object.keys(entry).length === 1) delete live[partidoId];
    else live[partidoId] = entry;
    await kv.set("liveScores", live);

    // ── AUTO-PA: verificar ANTES de liquidar para hacer un solo settleAll ──
    // Si el partido tiene pa:true y un equipo llegó a +2 (y no hay PA previa), inyectar en resultados.
    let autoPaApplied = false;
    const glN = entry.gl ?? live[partidoId]?.gl;
    const gvN = entry.gv ?? live[partidoId]?.gv;
    if (m.pa && glN != null && gvN != null && !r?.pa) {
      const diff = glN - gvN;
      const paFlags = {};
      if (diff >= 2) paFlags.l = true;
      if (diff <= -2) paFlags.v = true;
      if ((paFlags.l || paFlags.v) && (!resultados[partidoId] || resultados[partidoId].gl == null)) {
        resultados[partidoId] = { pa: { l: !!paFlags.l, v: !!paFlags.v }, parcial: true };
        await kv.set("resultados", resultados);
        autoPaApplied = true;
      }
    }

    // ── LIQUIDACIÓN ÚNICA: insta-pago + PA en una sola pasada ──
    const jugadoresLs = (await kv.get("jugadores")) || {};
    const apuestasLs = (await kv.get("apuestas")) || {};
    const campeonLs = (await kv.get("campeon")) || null;
    const especialesLs = await loadEspeciales();
    await snapshotIfFirstTouch(jugadoresLs, partidoId);
    const statusBefore = {};
    Object.values(apuestasLs).forEach(b => { statusBefore[b.id] = b.status || "pending"; });
    settleAll(jugadoresLs, apuestasLs, resultados, campeonLs, especialesLs, live);
    // Recopilar nuevos ganadores (solo los que pasaron de pending → won)
    const ganadoresInsta = {}, ganadoresPA = {};
    Object.values(apuestasLs).forEach(b => {
      const wasPending = (statusBefore[b.id] || "pending") === "pending";
      if (wasPending && b.status === "won" && b.payout) {
        // Es ganador PA si el partido tiene PA aplicada y la apuesta es 1x2 o parlay con pata 1x2
        const esPa = autoPaApplied && (b.pick === "local" || b.pick === "visita" ||
          (b.tipo === "parlay" && b.legs?.some(l => l.pick === "local" || l.pick === "visita")));
        if (esPa) ganadoresPA[b.nombre] = (ganadoresPA[b.nombre] || 0) + b.payout;
        else ganadoresInsta[b.nombre] = (ganadoresInsta[b.nombre] || 0) + b.payout;
      }
      if (wasPending && b.status === "lost") b.status = "pending";
    });
    const todosGanadores = { ...ganadoresInsta };
    for (const [n, v] of Object.entries(ganadoresPA)) todosGanadores[n] = (todosGanadores[n] || 0) + v;
    if (Object.keys(todosGanadores).length) {
      await kv.set("jugadores", jugadoresLs);
      await kv.set("apuestas", apuestasLs);
      const subs = (await kv.get("pushSubs")) || {};
      for (const [nombre, monto] of Object.entries(todosGanadores)) {
        if (!subs[nombre]) continue;
        const esPA = !!ganadoresPA[nombre];
        try {
          await sendPush(subs[nombre], {
            title: esPA ? `⚡ ¡Cobraste por PA en ${m.local} vs ${m.visita}!` : `✓ ¡Apuesta cobrada en ${m.local} vs ${m.visita}!`,
            body: esPA ? `Pago anticipado automático · +$${monto.toLocaleString()} a tu saldo` : `Una de tus apuestas ya quedó confirmada · +$${monto.toLocaleString()} a tu saldo`,
            tag: (esPA ? "pa-" : "live-") + partidoId, url: "/"
          });
        } catch (e) {}
      }
    }

    return res.json({ ok: true, liveScores: live, jugadores: publicJugadores(jugadoresLs), apuestas: apuestasLs });
  }

  if (action === "setFairplay") {
    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    const { equipo, amarillas, rojas } = payload;
    if (!equipo) return res.status(400).json({ error: "Equipo requerido" });
    const fp = (await kv.get("fairplay")) || {};
    fp[equipo] = { a: Math.max(0, Number(amarillas) || 0), r: Math.max(0, Number(rojas) || 0) };
    await kv.set("fairplay", fp);
    return res.json({ ok: true, fairplay: fp });
  }

  if (action === "aplicarPA") {
    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    const { partidoId, pa } = payload;
    const m = BY_ID[partidoId];
    if (!m) return res.status(400).json({ error: "Partido no existe" });
    if (!m.pa) return res.status(400).json({ error: "Ese partido no tiene Pago Anticipado" });
    if (!pa || (!pa.l && !pa.v)) return res.status(400).json({ error: "Marca al menos un equipo que haya llegado a +2" });
    const jugadores  = (await kv.get("jugadores"))  || {};
    const apuestas   = (await kv.get("apuestas"))   || {};
    const resultados = (await kv.get("resultados")) || {};
    const campeon    = (await kv.get("campeon"))    || null;
    const especialesMap = await loadEspeciales();
    if (resultados[partidoId] && resultados[partidoId].gl != null)
      return res.status(400).json({ error: "Ese partido ya tiene marcador final; edítalo desde Resultados" });
    // Snapshot del estado anterior de apuestas para detectar las recién ganadas
    const statusBefore = {};
    Object.values(apuestas).forEach(b => { statusBefore[b.id] = b.status || "pending"; });
    await snapshotIfFirstTouch(jugadores, partidoId);
    resultados[partidoId] = { pa: { l: !!pa.l, v: !!pa.v }, parcial: true };
    settleAll(jugadores, apuestas, resultados, campeon, especialesMap, (await kv.get("liveScores")) || {});
    await kv.set("resultados", resultados);
    await kv.set("jugadores", jugadores);
    await kv.set("apuestas", apuestas);

    // Notificar a quienes ganaron por PA (simples + parlays que cerraron con esta pata)
    const subs = (await kv.get("pushSubs")) || {};
    if (Object.keys(subs).length) {
      const acumulado = {}; // {nombre: monto ganado}
      Object.values(apuestas).forEach(b => {
        const wasPending = (statusBefore[b.id] || "pending") === "pending";
        if (wasPending && b.status === "won" && b.payout) {
          acumulado[b.nombre] = (acumulado[b.nombre] || 0) + b.payout;
        }
      });
      for (const [nombre, monto] of Object.entries(acumulado)) {
        if (!subs[nombre]) continue;
        try {
          await sendPush(subs[nombre], {
            title: `⚡ ¡Cobraste por PA en ${m.local} vs ${m.visita}!`,
            body: `Pago anticipado a tu favor · +$${monto.toLocaleString()} a tu saldo`,
            tag: "pa-" + partidoId, url: "/"
          });
        } catch (e) {}
      }
    }
    return res.json({ ok: true, resultados, jugadores: publicJugadores(jugadores), apuestas });
  }

  if (action === "resultado") {
    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    const { partidoId, gl, gv, pa, corners, tarjetas } = payload;
    if (partidoId === -1) return res.json({ ok: true });
    const m = BY_ID[partidoId];
    if (!m) return res.status(400).json({ error: "Partido no existe" });
    const golL = Math.floor(Number(gl)), golV = Math.floor(Number(gv));
    if (isNaN(golL) || isNaN(golV) || golL < 0 || golV < 0 || golL > 30 || golV > 30)
      return res.status(400).json({ error: "Marcador inválido" });
    // Validar córners/tarjetas si vienen (opcionales)
    let cornersVal = null, tarjetasVal = null;
    if (corners != null && corners !== '') {
      cornersVal = Math.floor(Number(corners));
      if (isNaN(cornersVal) || cornersVal < 0 || cornersVal > 50) return res.status(400).json({ error: "Córners inválidos (0-50)" });
    }
    if (tarjetas != null && tarjetas !== '') {
      tarjetasVal = Math.floor(Number(tarjetas));
      if (isNaN(tarjetasVal) || tarjetasVal < 0 || tarjetasVal > 30) return res.status(400).json({ error: "Tarjetas inválidas (0-30)" });
    }
    const jugadores  = (await kv.get("jugadores"))  || {};
    const apuestas   = (await kv.get("apuestas"))   || {};
    const resultados = (await kv.get("resultados")) || {};
    const campeon    = (await kv.get("campeon"))    || null;
    const especialesMap = await loadEspeciales();
    await snapshotIfFirstTouch(jugadores, partidoId);
    // Mantener corners/tarjetas previos si ya estaban registrados (parcial)
    const prevR = resultados[partidoId] || {};
    const rEntry = { gl: golL, gv: golV };
    if (cornersVal != null) rEntry.corners = cornersVal;
    else if (prevR.corners != null) rEntry.corners = prevR.corners;
    if (tarjetasVal != null) rEntry.tarjetas = tarjetasVal;
    else if (prevR.tarjetas != null) rEntry.tarjetas = prevR.tarjetas;
    if (m.pa) {
      const paL = pa && typeof pa.l === "boolean" ? pa.l : (golL - golV >= 2);
      const paV = pa && typeof pa.v === "boolean" ? pa.v : (golV - golL >= 2);
      rEntry.pa = { l: paL, v: paV };
    }
    resultados[partidoId] = rEntry;
    settleAll(jugadores, apuestas, resultados, campeon, especialesMap, (await kv.get("liveScores")) || {});
    await kv.set("resultados", resultados);
    await kv.set("jugadores", jugadores);
    await kv.set("apuestas", apuestas);
    // Limpiar live score: ya tenemos resultado final
    const liveScoresAfter = (await kv.get("liveScores")) || {};
    if (liveScoresAfter[partidoId]) { delete liveScoresAfter[partidoId]; await kv.set("liveScores", liveScoresAfter); }

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
    const campeon = (await kv.get("campeon")) || null;
    settleAll(jugadores, apuestas, resultados, campeon, await loadEspeciales(), (await kv.get("liveScores")) || {});
    await kv.set("resultados", resultados);
    await kv.set("jugadores", jugadores);
    await kv.set("apuestas", apuestas);
    // Si el snapshot vigente apuntaba a este partido, lo limpiamos para que el frontend
    // no muestre un delta engañoso referenciando un partido que ya no existe como resultado.
    const rankPrevActual = (await kv.get("rankPrev")) || {};
    if (rankPrevActual.partidoId === partidoId) await kv.set("rankPrev", { pos: {}, saldo: {}, partidoId: null, ts: Date.now() });
    return res.json({ ok: true, resultados, jugadores: publicJugadores(jugadores), apuestas });
  }

  // ── ADMIN: saldos ──────────────────────────────────────────────────
  if (action === "ajustarSaldo") {
    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    const { nombre, monto, mensaje } = payload;
    const jugadores = (await kv.get("jugadores")) || {};
    if (!jugadores[nombre]) return res.status(400).json({ error: "Jugador no existe" });
    const delta = Math.round(Number(monto));
    jugadores[nombre].saldo = Math.max(0, jugadores[nombre].saldo + delta);
    await kv.set("jugadores", jugadores);
    // Push opcional al jugador (típicamente al regalarle dinero)
    if (mensaje && mensaje.trim()) {
      const subs = (await kv.get("pushSubs")) || {};
      if (subs[nombre]) await sendPush(subs[nombre], { title: '💰 LudoPicks', body: mensaje.trim(), tag: 'saldo-' + Date.now(), url: '/' });
    }
    return res.json({ ok: true, jugadores: publicJugadores(jugadores) });
  }

  if (action === "bonusTodos") {
    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    const monto = Math.round(Number(payload.monto));
    const mensaje = payload.mensaje;
    const jugadores = (await kv.get("jugadores")) || {};
    for (const j of Object.values(jugadores)) j.saldo = Math.max(0, j.saldo + monto);
    await kv.set("jugadores", jugadores);
    if (mensaje && mensaje.trim()) {
      const subs = (await kv.get("pushSubs")) || {};
      await broadcastPush(subs, { title: '💰 LudoPicks', body: mensaje.trim(), tag: 'bonus-' + Date.now(), url: '/' });
    }
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

  // ── ADMIN: recotizar apuestas pendientes con los momios del catálogo actual ──
  if (action === "recotizar") {
    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    const apuestas = (await kv.get("apuestas")) || {};
    let actualizadas = 0;
    for (const b of Object.values(apuestas)) {
      if (b.status !== "pending") continue; // solo pendientes; las liquidadas ya pagaron
      if (b.tipo === "parlay") {
        let total = 1, cambio = false;
        for (const leg of b.legs) {
          const nm = momioPick(leg.partidoId, leg.pick, leg.linea, leg.mercado);
          if (nm != null && nm !== leg.momio) { leg.momio = nm; cambio = true; }
          total *= (leg.momio || 1);
        }
        total = Math.round(total * 100) / 100;
        if (total !== b.momioTotal) { b.momioTotal = total; cambio = true; }
        if (cambio) actualizadas++;
      } else {
        const nm = momioPick(b.partidoId, b.pick, b.linea);
        if (nm != null && nm !== b.momio) { b.momio = nm; actualizadas++; }
      }
    }
    await kv.set("apuestas", apuestas);
    return res.json({ ok: true, actualizadas, apuestas });
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
    const { nombre, pin, sub } = payload;
    if (!nombre || !sub) return res.status(400).json({ error: "Faltan datos" });
    if (!isAdmin()) {
      const jugadores = (await kv.get("jugadores")) || {};
      const j = jugadores[nombre];
      if (!j) return res.status(403).json({ error: "Jugador no existe" });
      if (!pin || String(j.pin) !== String(pin)) return res.status(403).json({ error: "PIN incorrecto" });
    }
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
  if (action === "reset") {
    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    await kv.set("jugadores", {});
    await kv.set("apuestas", {});
    await kv.set("resultados", {});
    await kv.set("rankPrev", { pos: {}, saldo: {} });
    return res.json({ ok: true });
  }

  if (action === "setTablaOrden") {
    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    const { grupo, orden } = payload;
    if (!grupo) return res.status(400).json({ error: "Datos inválidos" });
    const tabla_orden = (await kv.get("tabla_orden")) || {};
    if (!orden || orden.length === 0) {
      delete tabla_orden[grupo];
    } else {
      tabla_orden[grupo] = orden;
    }
    await kv.set("tabla_orden", tabla_orden);
    return res.json({ ok: true, tabla_orden });
  }

  // ── ADMIN: SINCRONIZAR MARCADORES + LIQUIDAR DESDE LA API DE FIFA ──
  // idCompetition=17 (FIFA World Cup), idSeason=285023 (Canadá-México-USA 2026).
  // IdStage 289273 = fase de grupos. MatchStatus: 0=final, 1=programado, 3=en vivo.
  // Mapea cada partido FIFA a un partidoId por el par de abreviaciones (local|visita).
  if (action === "syncFifa") {
    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    const FIFA_BASE = "https://api.fifa.com/api/v3";
    const ID_COMP = "17", ID_SEASON = "285023", ID_STAGE = "289273";
    let feed;
    try {
      const resp = await fetch(`${FIFA_BASE}/calendar/matches?idCompetition=${ID_COMP}&idSeason=${ID_SEASON}&count=200&language=en`, { headers: { Accept: "application/json" } });
      if (!resp.ok) return res.status(502).json({ error: `FIFA respondió ${resp.status}` });
      feed = await resp.json();
    } catch (e) {
      return res.status(502).json({ error: "No se pudo conectar con FIFA: " + (e?.message || e) });
    }
    const matches = Array.isArray(feed?.Results) ? feed.Results : [];
    if (!matches.length) return res.status(502).json({ error: "FIFA no devolvió partidos" });

    const jugadores     = (await kv.get("jugadores"))  || {};
    const apuestas      = (await kv.get("apuestas"))   || {};
    const resultados    = (await kv.get("resultados")) || {};
    const campeon       = (await kv.get("campeon"))    || null;
    const especialesMap = await loadEspeciales();
    const live          = (await kv.get("liveScores")) || {};

    // Par "LOCAL|VISITA" -> partidoId (la fase de grupos hace único cada par)
    const pairToId = {};
    for (const p of PARTIDOS) pairToId[p.local + "|" + p.visita] = p.id;

    const statusBefore = {};
    Object.values(apuestas).forEach(b => { statusBefore[b.id] = b.status || "pending"; });

    const aplicados = [], sinMapear = [];
    let firstTouched = null;

    for (const mt of matches) {
      if (String(mt.IdStage) !== ID_STAGE) continue;
      const home = mt.Home?.Abbreviation, away = mt.Away?.Abbreviation;
      if (!home || !away) continue;
      const pid = pairToId[home + "|" + away];
      if (!pid) { sinMapear.push(`${home} vs ${away}`); continue; }
      const m = BY_ID[pid];
      const st = Number(mt.MatchStatus);
      const hsRaw = mt.HomeTeamScore != null ? mt.HomeTeamScore : mt.Home?.Score;
      const asRaw = mt.AwayTeamScore != null ? mt.AwayTeamScore : mt.Away?.Score;
      const hs = hsRaw != null ? Number(hsRaw) : null;
      const as = asRaw != null ? Number(asRaw) : null;

      if (st === 0 && hs != null && as != null) {
        // FINAL — réplica de la acción "resultado"
        const ex = resultados[pid];
        if (ex && !ex.parcial && ex.gl === hs && ex.gv === as) continue; // ya está idéntico
        const prevR = resultados[pid] || {};
        const rEntry = { gl: hs, gv: as };
        if (prevR.corners  != null) rEntry.corners  = prevR.corners;   // córners se conservan (manual)
        if (prevR.tarjetas != null) rEntry.tarjetas = prevR.tarjetas;
        if (m.pa) rEntry.pa = { l: (hs - as) >= 2, v: (as - hs) >= 2 };
        resultados[pid] = rEntry;
        if (live[pid]) delete live[pid];
        if (firstTouched == null) firstTouched = pid;
        aplicados.push({ partidoId: pid, tipo: "final", label: `${m.local} ${hs}-${as} ${m.visita}` });
      } else if (st === 3) {
        // EN VIVO — actualiza liveScores (nunca pisa un final ya guardado)
        if (resultados[pid] && resultados[pid].gl != null && !resultados[pid].parcial) continue;
        if (hs == null && as == null) continue;
        const entry = { ts: Date.now() };
        if (hs != null) entry.gl = hs;
        if (as != null) entry.gv = as;
        if (live[pid]?.corners  != null) entry.corners  = live[pid].corners;
        if (live[pid]?.tarjetas != null) entry.tarjetas = live[pid].tarjetas;
        live[pid] = entry;
        // Auto-PA en vivo (mismo criterio que setLiveScore)
        if (m.pa && entry.gl != null && entry.gv != null && !resultados[pid]?.pa) {
          const diff = entry.gl - entry.gv, pf = {};
          if (diff >= 2) pf.l = true;
          if (diff <= -2) pf.v = true;
          if ((pf.l || pf.v) && (!resultados[pid] || resultados[pid].gl == null)) {
            resultados[pid] = { pa: { l: !!pf.l, v: !!pf.v }, parcial: true };
          }
        }
        if (firstTouched == null) firstTouched = pid;
        aplicados.push({ partidoId: pid, tipo: "live", label: `${m.local} ${entry.gl ?? "-"}-${entry.gv ?? "-"} ${m.visita} (vivo)` });
      }
    }

    if (!aplicados.length) {
      return res.json({ ok: true, aplicados: [], sinMapear, resultados, liveScores: live, jugadores: publicJugadores(jugadores), apuestas });
    }

    if (firstTouched != null) await snapshotIfFirstTouch(jugadores, firstTouched);
    settleAll(jugadores, apuestas, resultados, campeon, especialesMap, live);
    await kv.set("resultados", resultados);
    await kv.set("liveScores", live);
    await kv.set("jugadores", jugadores);
    await kv.set("apuestas", apuestas);

    // Push a quienes pasaron de pending → won en esta sincronización
    const ganadores = {};
    Object.values(apuestas).forEach(b => {
      if ((statusBefore[b.id] || "pending") === "pending" && b.status === "won" && b.payout)
        ganadores[b.nombre] = (ganadores[b.nombre] || 0) + b.payout;
    });
    const subs = (await kv.get("pushSubs")) || {};
    for (const [nombre, monto] of Object.entries(ganadores)) {
      if (!subs[nombre]) continue;
      try { await sendPush(subs[nombre], { title: "✓ ¡Apuesta cobrada!", body: `Resultados FIFA · +$${monto.toLocaleString()} a tu saldo`, tag: "sync-" + Date.now(), url: "/" }); } catch (e) {}
    }

    return res.json({ ok: true, aplicados, sinMapear, resultados, liveScores: live, jugadores: publicJugadores(jugadores), apuestas });
  }

  // ── ADMIN: SINCRONIZAR CÓRNERS + TARJETAS DESDE ESPN ──
  // La API de FIFA no da córners; la API oculta de ESPN sí (wonCorners), y de paso
  // amarillas/rojas por equipo. boxscore es POR PARTIDO (verificado). Liquida córners.
  // Liga ESPN: fifa.world · scoreboard (ids) → summary?event= (estadísticas).
  if (action === "syncEspnStats") {
    if (!isAdmin()) return res.status(403).json({ error: "No autorizado" });
    const ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world";
    let sb;
    try {
      const resp = await fetch(`${ESPN}/scoreboard?dates=20260611-20260627&limit=200`, { headers: { Accept: "application/json" } });
      if (!resp.ok) return res.status(502).json({ error: `ESPN respondió ${resp.status}` });
      sb = await resp.json();
    } catch (e) {
      return res.status(502).json({ error: "No se pudo conectar con ESPN: " + (e?.message || e) });
    }
    const events = Array.isArray(sb?.events) ? sb.events : [];

    // Par "LOCAL|VISITA" -> partidoId (fase de grupos)
    const pairToId = {};
    for (const p of PARTIDOS) pairToId[p.local + "|" + p.visita] = p.id;

    // Eventos: FINALIZADOS y EN VIVO que mapean a un partido de grupos
    const finished = [], liveEv = [];
    for (const ev of events) {
      const comp = ev?.competitions?.[0]; if (!comp) continue;
      const home = comp.competitors?.find(c => c.homeAway === "home");
      const away = comp.competitors?.find(c => c.homeAway === "away");
      const ha = home?.team?.abbreviation, aa = away?.team?.abbreviation;
      if (!ha || !aa) continue;
      const pid = pairToId[ha + "|" + aa];
      if (!pid) continue;
      if (ev.status?.type?.completed) finished.push({ id: ev.id, pid });
      else if (ev.status?.type?.state === "in") liveEv.push({ id: ev.id, pid });
    }

    // Totales de córners/tarjetas (y por equipo) de un summary. null si faltan estadísticas (evita ceros falsos).
    const espnTotals = (j) => {
      const teams = j?.boxscore?.teams;
      if (!Array.isArray(teams) || teams.length < 2 || !teams.every(t => Array.isArray(t.statistics) && t.statistics.length)) return null;
      let corners = 0, cards = 0; const perTeam = [];
      for (const t of teams) {
        const stat = n => { const s = t.statistics.find(x => x.name === n); return s ? Number(s.displayValue) : null; };
        const c = stat("wonCorners"); if (c != null && !isNaN(c)) corners += c;
        const y = stat("yellowCards"), r = stat("redCards");
        const yy = (y != null && !isNaN(y)) ? y : 0, rr = (r != null && !isNaN(r)) ? r : 0;
        cards += yy + rr; perTeam.push({ abbr: t.team?.abbreviation, yy, rr });
      }
      return { corners, cards, perTeam };
    };
    const fetchSummaries = async (list) => {
      const out = {}; const BATCH = 6;
      for (let i = 0; i < list.length; i += BATCH) {
        const slice = list.slice(i, i + BATCH);
        const datas = await Promise.allSettled(slice.map(f =>
          fetch(`${ESPN}/summary?event=${f.id}`, { headers: { Accept: "application/json" } })
            .then(r => r.ok ? r.json() : null).then(j => ({ f, j }))));
        for (const d of datas) { if (d.status === "fulfilled" && d.value?.j) out[d.value.f.pid] = espnTotals(d.value.j); }
      }
      return out;
    };

    // FINALIZADOS → córners/tarjetas finales + fair play (recuento por equipo)
    const finStats = await fetchSummaries(finished);
    const fp = {}, cornersByPid = {}, cardsByPid = {};
    let procesados = 0, fallidos = 0;
    for (const f of finished) {
      const tot = finStats[f.pid];
      if (!tot) { fallidos++; continue; }
      cornersByPid[f.pid] = tot.corners; cardsByPid[f.pid] = tot.cards;
      for (const pt of tot.perTeam) { if (!pt.abbr) continue; if (!fp[pt.abbr]) fp[pt.abbr] = { a: 0, r: 0 }; fp[pt.abbr].a += pt.yy; fp[pt.abbr].r += pt.rr; }
      procesados++;
    }
    // EN VIVO → córners/tarjetas provisionales (para insta-pago de Over irreversibles)
    const liveStats = await fetchSummaries(liveEv);

    // Fair play: SIEMPRE fusionar tomando el máximo (nunca borra si ESPN devuelve vacío).
    const prev = (await kv.get("fairplay")) || {};
    const storedFp = {};
    const tset = new Set([...Object.keys(fp), ...Object.keys(prev)]);
    for (const t of tset) {
      const n = fp[t] || { a: 0, r: 0 }, o = prev[t] || { a: 0, r: 0 };
      storedFp[t] = { a: Math.max(n.a || 0, o.a || 0), r: Math.max(n.r || 0, o.r || 0) };
    }
    await kv.set("fairplay", storedFp);

    const jugadores  = (await kv.get("jugadores"))  || {};
    const apuestas   = (await kv.get("apuestas"))   || {};
    const resultados = (await kv.get("resultados")) || {};
    const campeon    = (await kv.get("campeon"))    || null;
    const especialesMap = await loadEspeciales();
    const live       = (await kv.get("liveScores")) || {};

    const statusBefore = {};
    Object.values(apuestas).forEach(b => { statusBefore[b.id] = b.status || "pending"; });

    // FINALIZADOS → resultados (el partido terminó: liquidan over Y under)
    let cornersAplicados = 0, tarjetasAplicadas = 0, firstTouched = null;
    for (const pid of new Set([...Object.keys(cornersByPid), ...Object.keys(cardsByPid)])) {
      const r = resultados[pid];
      if (!r || r.gl == null || r.parcial) continue; // sin marcador final aún
      let touched = false;
      if (cornersByPid[pid] != null && r.corners !== cornersByPid[pid]) { r.corners = cornersByPid[pid]; cornersAplicados++; touched = true; }
      if (cardsByPid[pid]   != null && r.tarjetas !== cardsByPid[pid])  { r.tarjetas = cardsByPid[pid]; tarjetasAplicadas++; touched = true; }
      if (touched && firstTouched == null) firstTouched = Number(pid);
    }

    // EN VIVO → liveScores (insta-paga SOLO Over irreversibles; Under/1X2 esperan al final)
    let liveTocados = 0;
    for (const pid of Object.keys(liveStats)) {
      const tot = liveStats[pid];
      if (!tot) continue;
      if (resultados[pid] && resultados[pid].gl != null && !resultados[pid].parcial) continue; // ya finalizado
      const cur = live[pid] || {}, next = { ...cur };
      // Monotónico (solo sube): córners y tarjetas nunca bajan en vivo → un Over ya
      // pagado jamás se revierte por un glitch de datos. Es irreversible de verdad.
      const newC = Math.max(cur.corners || 0, tot.corners);
      const newT = Math.max(cur.tarjetas || 0, tot.cards);
      let changed = false;
      if (cur.corners !== newC) { next.corners = newC; changed = true; }
      if (cur.tarjetas !== newT) { next.tarjetas = newT; changed = true; }
      if (changed) { next.ts = Date.now(); live[pid] = next; liveTocados++; }
    }

    if (cornersAplicados > 0 || tarjetasAplicadas > 0 || liveTocados > 0) {
      if (firstTouched != null) await snapshotIfFirstTouch(jugadores, firstTouched);
      settleAll(jugadores, apuestas, resultados, campeon, especialesMap, live);
      await kv.set("resultados", resultados);
      await kv.set("liveScores", live);
      await kv.set("jugadores", jugadores);
      await kv.set("apuestas", apuestas);
      const ganadores = {};
      Object.values(apuestas).forEach(b => {
        if ((statusBefore[b.id] || "pending") === "pending" && b.status === "won" && b.payout)
          ganadores[b.nombre] = (ganadores[b.nombre] || 0) + b.payout;
      });
      const subs = (await kv.get("pushSubs")) || {};
      for (const [nombre, monto] of Object.entries(ganadores)) {
        if (!subs[nombre]) continue;
        try { await sendPush(subs[nombre], { title: "✓ ¡Apuesta cobrada!", body: `Córners/tarjetas ESPN · +$${monto.toLocaleString()} a tu saldo`, tag: "espn-" + Date.now(), url: "/" }); } catch (e) {}
      }
    }

    return res.json({ ok: true, fairplay: storedFp, cornersAplicados, tarjetasAplicadas, liveTocados, enVivo: liveEv.length, procesados, fallidos, total: finished.length, jugadores: publicJugadores(jugadores), apuestas, resultados, liveScores: live });
  }

  return res.status(400).json({ error: "Acción no reconocida" });
}
