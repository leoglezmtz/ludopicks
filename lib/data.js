// Momios basados en FanDuel Sportsbook (Mayo 2026), formato decimal.
// Over/Under: líneas estimadas con criterio (la mayoría 2.5; partidos disparejos 3.5).
// kickoff: epoch ms calculado desde fecha/hora en horario de Tijuana (UTC-7).

export const SALDO_INICIAL = 10000;
export const APUESTA_MIN = 100;

// Mapa de etiqueta de fecha -> fecha ISO (2026)
const FECHA_ISO = {
  "Jue 11/6":"2026-06-11","Vie 12/6":"2026-06-12","Sáb 13/6":"2026-06-13",
  "Dom 14/6":"2026-06-14","Lun 15/6":"2026-06-15","Mar 16/6":"2026-06-16",
  "Mié 17/6":"2026-06-17","Jue 18/6":"2026-06-18","Vie 19/6":"2026-06-19",
  "Sáb 20/6":"2026-06-20","Dom 21/6":"2026-06-21","Lun 22/6":"2026-06-22",
  "Mar 23/6":"2026-06-23","Mié 24/6":"2026-06-24","Jue 25/6":"2026-06-25",
  "Vie 26/6":"2026-06-26","Sáb 27/6":"2026-06-27",
};
function kickoffMs(fecha, hora){
  // -07:00 = Tijuana (PDT). El offset explícito hace el epoch inequívoco sin importar la tz del server.
  return new Date(`${FECHA_ISO[fecha]}T${hora}:00-07:00`).getTime();
}

const BASE = [
  { id: 1,  fecha:"Jue 11/6", hora:"12:00", local:"MEX", visita:"RSA", grupo:"A", momios:{ local:1.5, empate:4.5, visita:9 } },
  { id: 2,  fecha:"Jue 11/6", hora:"19:00", local:"KOR", visita:"CZE", grupo:"A", momios:{ local:2.7, empate:3.2, visita:2.83 } },
  { id: 3,  fecha:"Vie 12/6", hora:"12:00", local:"CAN", visita:"BIH", grupo:"B", momios:{ local:1.85, empate:3.7, visita:4.7 } },
  { id: 4,  fecha:"Vie 12/6", hora:"18:00", local:"USA", visita:"PAR", grupo:"D", momios:{ local:2, empate:3.5, visita:4 } },
  { id: 5,  fecha:"Sáb 13/6", hora:"12:00", local:"QAT", visita:"SUI", grupo:"B", momios:{ local:16, empate:6.6, visita:1.24 } },
  { id: 6,  fecha:"Sáb 13/6", hora:"15:00", local:"BRA", visita:"MAR", grupo:"C", momios:{ local:1.62, empate:4, visita:6 } },
  { id: 7,  fecha:"Sáb 13/6", hora:"18:00", local:"HAI", visita:"SCO", grupo:"C", momios:{ local:7.5, empate:4.75, visita:1.5 } },
  { id: 8,  fecha:"Sáb 13/6", hora:"21:00", local:"AUS", visita:"TUR", grupo:"D", momios:{ local:5, empate:3.75, visita:1.8 } },
  { id: 9,  fecha:"Dom 14/6", hora:"10:00", local:"GER", visita:"CUW", grupo:"E", momios:{ local:1.05, empate:21, visita:76 } },
  { id: 10, fecha:"Dom 14/6", hora:"13:00", local:"NED", visita:"JPN", grupo:"F", momios:{ local:2, empate:3.8, visita:3.9 } },
  { id: 11, fecha:"Dom 14/6", hora:"16:00", local:"CIV", visita:"ECU", grupo:"E", momios:{ local:3.75, empate:3, visita:2.34 } },
  { id: 12, fecha:"Dom 14/6", hora:"19:00", local:"SWE", visita:"TUN", grupo:"F", momios:{ local:1.95, empate:3.44, visita:4.25 } },
  { id: 13, fecha:"Lun 15/6", hora:"09:00", local:"ESP", visita:"CPV", grupo:"H", momios:{ local:1.1, empate:12, visita:35 } },
  { id: 14, fecha:"Lun 15/6", hora:"12:00", local:"BEL", visita:"EGY", grupo:"G", momios:{ local:1.68, empate:4, visita:5.33 } },
  { id: 15, fecha:"Lun 15/6", hora:"15:00", local:"KSA", visita:"URU", grupo:"H", momios:{ local:7.5, empate:4.5, visita:1.52 } },
  { id: 16, fecha:"Lun 15/6", hora:"18:00", local:"IRN", visita:"NZL", grupo:"G", momios:{ local:1.95, empate:3.6, visita:4.4 } },
  { id: 17, fecha:"Mar 16/6", hora:"12:00", local:"FRA", visita:"SEN", grupo:"I", momios:{ local:1.46, empate:4.75, visita:8.4 } },
  { id: 18, fecha:"Mar 16/6", hora:"15:00", local:"IRQ", visita:"NOR", grupo:"I", momios:{ local:19, empate:7, visita:1.23 } },
  { id: 19, fecha:"Mar 16/6", hora:"18:00", local:"ARG", visita:"ALG", grupo:"J", momios:{ local:1.41, empate:4.75, visita:9.1 } },
  { id: 20, fecha:"Mar 16/6", hora:"21:00", local:"AUT", visita:"JOR", grupo:"J", momios:{ local:1.33, empate:5.5, visita:10 } },
  { id: 21, fecha:"Mié 17/6", hora:"10:00", local:"POR", visita:"COD", grupo:"K", momios:{ local:1.29, empate:6, visita:13 } },
  { id: 22, fecha:"Mié 17/6", hora:"13:00", local:"ENG", visita:"CRO", grupo:"L", momios:{ local:1.74, empate:3.78, visita:4.85 } },
  { id: 23, fecha:"Mié 17/6", hora:"16:00", local:"GHA", visita:"PAN", grupo:"L", momios:{ local:2.06, empate:3.54, visita:3.95 } },
  { id: 24, fecha:"Mié 17/6", hora:"19:00", local:"UZB", visita:"COL", grupo:"K", momios:{ local:9, empate:4.6, visita:1.43 } },
  { id: 25, fecha:"Jue 18/6", hora:"09:00", local:"CZE", visita:"RSA", grupo:"A", momios:{ local:2.05, empate:3.35, visita:4.1 } },
  { id: 26, fecha:"Jue 18/6", hora:"12:00", local:"SUI", visita:"BIH", grupo:"B", momios:{ local:1.6, empate:4.1, visita:6 } },
  { id: 27, fecha:"Jue 18/6", hora:"15:00", local:"CAN", visita:"QAT", grupo:"B", momios:{ local:1.34, empate:5.5, visita:12 } },
  { id: 28, fecha:"Jue 18/6", hora:"18:00", local:"MEX", visita:"KOR", grupo:"A", momios:{ local:1.85, empate:3.54, visita:4.9 } },
  { id: 29, fecha:"Vie 19/6", hora:"12:00", local:"USA", visita:"AUS", grupo:"D", momios:{ local:1.77, empate:4, visita:4.9 } },
  { id: 30, fecha:"Vie 19/6", hora:"15:00", local:"SCO", visita:"MAR", grupo:"C", momios:{ local:4.1, empate:3.3, visita:2.05 } },
  { id: 31, fecha:"Vie 19/6", hora:"18:00", local:"BRA", visita:"HAI", grupo:"C", momios:{ local:1.08, empate:14, visita:40 } },
  { id: 32, fecha:"Vie 19/6", hora:"21:00", local:"TUR", visita:"PAR", grupo:"D", momios:{ local:2.25, empate:3.2, visita:3.45 } },
  { id: 33, fecha:"Sáb 20/6", hora:"10:00", local:"NED", visita:"SWE", grupo:"F", momios:{ local:1.65, empate:4.2, visita:5.4 } },
  { id: 34, fecha:"Sáb 20/6", hora:"13:00", local:"GER", visita:"CIV", grupo:"E", momios:{ local:1.55, empate:4.34, visita:6 } },
  { id: 35, fecha:"Sáb 20/6", hora:"19:00", local:"ECU", visita:"CUW", grupo:"E", momios:{ local:1.25, empate:6.4, visita:16.5 } },
  { id: 36, fecha:"Sáb 20/6", hora:"21:00", local:"TUN", visita:"JPN", grupo:"F", momios:{ local:4.9, empate:3.55, visita:1.81 } },
  { id: 37, fecha:"Dom 21/6", hora:"09:00", local:"ESP", visita:"KSA", grupo:"H", momios:{ local:1.12, empate:10, visita:30 } },
  { id: 38, fecha:"Dom 21/6", hora:"12:00", local:"BEL", visita:"IRN", grupo:"G", momios:{ local:1.43, empate:4.8, visita:8.1 } },
  { id: 39, fecha:"Dom 21/6", hora:"15:00", local:"URU", visita:"CPV", grupo:"H", momios:{ local:1.45, empate:4.5, visita:7.5 } },
  { id: 40, fecha:"Dom 21/6", hora:"18:00", local:"NZL", visita:"EGY", grupo:"G", momios:{ local:5.75, empate:4, visita:1.75 } },
  { id: 41, fecha:"Lun 22/6", hora:"10:00", local:"ARG", visita:"AUT", grupo:"J", momios:{ local:1.7, empate:3.8, visita:5.5 } },
  { id: 42, fecha:"Lun 22/6", hora:"14:00", local:"FRA", visita:"IRQ", grupo:"I", momios:{ local:1.14, empate:8.5, visita:26 } },
  { id: 43, fecha:"Lun 22/6", hora:"17:00", local:"NOR", visita:"SEN", grupo:"I", momios:{ local:2.15, empate:3.5, visita:3.6 } },
  { id: 44, fecha:"Lun 22/6", hora:"20:00", local:"JOR", visita:"ALG", grupo:"J", momios:{ local:6.2, empate:4.1, visita:1.57 } },
  { id: 45, fecha:"Mar 23/6", hora:"10:00", local:"POR", visita:"UZB", grupo:"K", momios:{ local:1.27, empate:6.5, visita:14 } },
  { id: 46, fecha:"Mar 23/6", hora:"13:00", local:"ENG", visita:"GHA", grupo:"L", momios:{ local:1.35, empate:5.5, visita:12 } },
  { id: 47, fecha:"Mar 23/6", hora:"16:00", local:"PAN", visita:"CRO", grupo:"L", momios:{ local:8.2, empate:4.3, visita:1.5 } },
  { id: 48, fecha:"Mar 23/6", hora:"19:00", local:"COL", visita:"COD", grupo:"K", momios:{ local:1.5, empate:4.3, visita:7.9 } },
  { id: 49, fecha:"Mié 24/6", hora:"12:00", local:"SUI", visita:"CAN", grupo:"B", momios:{ local:2.15, empate:3.4, visita:3.8 } },
  { id: 50, fecha:"Mié 24/6", hora:"12:00", local:"BIH", visita:"QAT", grupo:"B", momios:{ local:1.6, empate:4, visita:6 } },
  { id: 51, fecha:"Mié 24/6", hora:"15:00", local:"SCO", visita:"BRA", grupo:"C", momios:{ local:9, empate:5, visita:1.4 } },
  { id: 52, fecha:"Mié 24/6", hora:"15:00", local:"MAR", visita:"HAI", grupo:"C", momios:{ local:1.25, empate:6.25, visita:16 } },
  { id: 53, fecha:"Mié 24/6", hora:"18:00", local:"CZE", visita:"MEX", grupo:"A", momios:{ local:4.5, empate:3.6, visita:1.87 } },
  { id: 54, fecha:"Mié 24/6", hora:"18:00", local:"RSA", visita:"KOR", grupo:"A", momios:{ local:4, empate:3.44, visita:2.08 } },
  { id: 55, fecha:"Jue 25/6", hora:"13:00", local:"CUW", visita:"CIV", grupo:"E", momios:{ local:11.5, empate:5.35, visita:1.33 } },
  { id: 56, fecha:"Jue 25/6", hora:"13:00", local:"ECU", visita:"GER", grupo:"E", momios:{ local:5.33, empate:4, visita:1.68 } },
  { id: 57, fecha:"Jue 25/6", hora:"16:00", local:"JPN", visita:"SWE", grupo:"F", momios:{ local:2.1, empate:3.45, visita:3.6 } },
  { id: 58, fecha:"Jue 25/6", hora:"16:00", local:"TUN", visita:"NED", grupo:"F", momios:{ local:6.75, empate:4.25, visita:1.53 } },
  { id: 59, fecha:"Jue 25/6", hora:"19:00", local:"TUR", visita:"USA", grupo:"D", momios:{ local:2.77, empate:3.45, visita:2.7 } },
  { id: 60, fecha:"Jue 25/6", hora:"19:00", local:"PAR", visita:"AUS", grupo:"D", momios:{ local:2.21, empate:3.25, visita:3.5 } },
  { id: 61, fecha:"Vie 26/6", hora:"12:00", local:"NOR", visita:"FRA", grupo:"I", momios:{ local:4.5, empate:3.65, visita:1.81 } },
  { id: 62, fecha:"Vie 26/6", hora:"12:00", local:"SEN", visita:"IRQ", grupo:"I", momios:{ local:1.45, empate:4.5, visita:7.6 } },
  { id: 63, fecha:"Vie 26/6", hora:"17:00", local:"CPV", visita:"KSA", grupo:"H", momios:{ local:2.6, empate:3.45, visita:3.03 } },
  { id: 64, fecha:"Vie 26/6", hora:"17:00", local:"URU", visita:"ESP", grupo:"H", momios:{ local:5.33, empate:3.94, visita:1.7 } },
  { id: 65, fecha:"Vie 26/6", hora:"20:00", local:"EGY", visita:"IRN", grupo:"G", momios:{ local:2.4, empate:3.15, visita:3.6 } },
  { id: 66, fecha:"Vie 26/6", hora:"20:00", local:"NZL", visita:"BEL", grupo:"G", momios:{ local:10, empate:6, visita:1.32 } },
  { id: 67, fecha:"Sáb 27/6", hora:"14:00", local:"PAN", visita:"ENG", grupo:"L", momios:{ local:10, empate:6.66, visita:1.32 } },
  { id: 68, fecha:"Sáb 27/6", hora:"14:00", local:"CRO", visita:"GHA", grupo:"L", momios:{ local:1.75, empate:3.7, visita:5 } },
  { id: 69, fecha:"Sáb 27/6", hora:"16:30", local:"COL", visita:"POR", grupo:"K", momios:{ local:3.49, empate:3.4, visita:2.25 } },
  { id: 70, fecha:"Sáb 27/6", hora:"16:30", local:"COD", visita:"UZB", grupo:"K", momios:{ local:2.48, empate:3.4, visita:3.15 } },
  { id: 71, fecha:"Sáb 27/6", hora:"19:00", local:"ALG", visita:"AUT", grupo:"J", momios:{ local:3.5, empate:3.25, visita:2.31 } },
  { id: 72, fecha:"Sáb 27/6", hora:"19:00", local:"JOR", visita:"ARG", grupo:"J", momios:{ local:17, empate:7.5, visita:1.23 } },
];

// ── Modelo Poisson para momios Over/Under por línea ──
function factorial(n){ let f=1; for(let i=2;i<=n;i++) f*=i; return f; }
function poissonP(k,mu){ return Math.exp(-mu)*Math.pow(mu,k)/factorial(k); }
function muEsperado(favMin){
  if(favMin<=1.20) return 3.7;
  if(favMin<=1.35) return 3.3;
  if(favMin<=1.55) return 3.0;
  if(favMin<=1.75) return 2.8;
  if(favMin<=2.0)  return 2.6;
  if(favMin<=2.5)  return 2.5;
  return 2.4;
}
export const LINEAS_OU = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5];
export const LINEA_DEFAULT = 2.5;

// ── MERCADO: TIROS DE ESQUINA (córners) ─────────────────────
// Líneas y momios reales típicos del mercado (Pinnacle/Bet365 promedios).
// Media histórica de mundiales: ~10 córners/partido.
export const LINEAS_CORNERS = [6.5, 7.5, 8.5, 9.5, 10.5, 11.5];
export const LINEA_CORNERS_DEFAULT = 9.5;
export const MOMIOS_CORNERS = {
  6.5:  { over: 1.20, under: 4.50 },
  7.5:  { over: 1.35, under: 2.85 },
  8.5:  { over: 1.55, under: 2.25 },
  9.5:  { over: 1.85, under: 1.85 },
  10.5: { over: 2.25, under: 1.55 },
  11.5: { over: 2.85, under: 1.35 },
};

// ── MERCADO: TARJETAS (amarillas + rojas combinadas) ────────
// Media histórica de mundiales: ~3.8 tarjetas/partido.
export const LINEAS_TARJETAS = [2.5, 3.5, 4.5, 5.5];
export const LINEA_TARJETAS_DEFAULT = 3.5;
export const MOMIOS_TARJETAS = {
  2.5: { over: 1.40, under: 2.65 },
  3.5: { over: 1.75, under: 1.95 },
  4.5: { over: 2.30, under: 1.55 },
  5.5: { over: 3.10, under: 1.30 },
};

const MARGEN = 1.05, FLOOR = 1.02, CAP = 26;
function ouOdds(mu){
  const pk = []; for(let k=0;k<=15;k++) pk.push(poissonP(k,mu));
  const out = {};
  for(const L of LINEAS_OU){
    const need = Math.ceil(L);
    let pOver = 0; for(let k=need;k<=15;k++) pOver += pk[k];
    const pUnder = 1 - pOver;
    const o = Math.min(CAP, Math.max(FLOOR, Math.round((1/pOver)/MARGEN*100)/100));
    const u = Math.min(CAP, Math.max(FLOOR, Math.round((1/pUnder)/MARGEN*100)/100));
    out[L] = { over:o, under:u };
  }
  return out;
}

// Ambos Anotan (BTTS): goles esperados de favorito y no-favorito según lo disparejo
function muSides(favMin){
  if(favMin<=1.25) return [2.6,0.45];
  if(favMin<=1.45) return [2.2,0.70];
  if(favMin<=1.70) return [1.9,0.95];
  if(favMin<=2.10) return [1.7,1.10];
  return [1.45,1.35];
}
function bttsOdds(favMin){
  const [muFav,muDog]=muSides(favMin);
  const pBoth=(1-Math.exp(-muFav))*(1-Math.exp(-muDog));
  const pNo=1-pBoth;
  const M=1.06, F=1.02, C=15;
  return {
    si: Math.min(C, Math.max(F, Math.round((1/pBoth)/M*100)/100)),
    no: Math.min(C, Math.max(F, Math.round((1/pNo)/M*100)/100)),
  };
}

// ── PAGO ANTICIPADO (regla "2 Up") ─────────────────────────────
// Aplica desde el partido Haití–Escocia (id 7) en adelante: una apuesta a
// ganador (local/visita) se paga como GANADA si ese equipo llegó a tener
// ventaja de 2 goles en cualquier momento, sin importar el marcador final.
const _pa7 = BASE.find(p => p.id === 7);
export const PA_DESDE = _pa7 ? kickoffMs(_pa7.fecha, _pa7.hora) : 0;

// Enriquecer cada partido con: kickoff, momios 1X2, tabla O/U y Ambos Anotan.
export const PARTIDOS = BASE.map(p => {
  const favMin = Math.min(p.momios.local, p.momios.visita);
  const k = kickoffMs(p.fecha, p.hora);
  return {
    ...p,
    kickoff: k,
    pa: k >= PA_DESDE,   // Pago Anticipado disponible
    mu: muEsperado(favMin),
    ou: ouOdds(muEsperado(favMin)),
    btts: bttsOdds(favMin),  // { si, no }
  };
});

// ── CAMPEÓN DEL MUNDIAL (outright) ─────────────────────────────
// Momios reales de los favoritos (oddschecker/casas, jun 2026); resto estimado por nivel.
// Se apuesta una sola vez; cierra al iniciar el primer partido. Se queda fijo.
export const CAMPEON = {
  ESP:6, FRA:6.6, ENG:7, BRA:9, ARG:10, POR:13, GER:15, NED:17, BEL:34,
  CRO:41, URU:41, MAR:51, COL:51, USA:67, MEX:67, JPN:67, NOR:67, SUI:81, SEN:81,
  TUR:101, AUT:101, ECU:126, KOR:151, CZE:151, SWE:151, EGY:151, CIV:151, CAN:151,
  GHA:201, SCO:201, ALG:251, TUN:251, IRN:251, AUS:251, PAR:251,
  QAT:301, KSA:301, RSA:301, BIH:301, COD:501, NZL:501,
  CPV:751, UZB:751, IRQ:751, HAI:1001, JOR:1001, PAN:1001, CUW:2000,
};
// Cierre = arranque del primer partido del torneo
export const CAMPEON_CIERRA = Math.min(...PARTIDOS.map(p => p.kickoff));

// ── APUESTA ESPECIAL (novelty / evento sorpresa) ───────────────
// Cierra 10:00 am hora Tijuana (UTC-7) del 11 jun 2026 → 17:00 UTC.
export const ESPECIAL = {
  id: 'belinda-inauguracion',
  activo: true,
  titulo: 'Especial Inauguración',
  emoji: '👗',
  pregunta: '¿De qué color será el vestido o blusa de Belinda en la inauguración del Mundial?',
  nota: 'Apuesta sorpresa · una sola vez · cierra 10:00 am (Tijuana)',
  cierra: Date.UTC(2026, 5, 11, 17, 0, 0),
  opciones: [
    { key: 'rojo',       label: 'Rojo',       emoji: '🔴', momio: 3.0 },
    { key: 'negro',      label: 'Negro',      emoji: '⚫', momio: 3.5 },
    { key: 'otro',       label: 'Otro color', emoji: '🎨', momio: 3.5 },
    { key: 'blanco',     label: 'Blanco',     emoji: '⚪', momio: 4.5 },
    { key: 'dorado',     label: 'Dorado',     emoji: '🥇', momio: 6.0 },
    { key: 'rosa',       label: 'Rosa',       emoji: '🌸', momio: 6.0 },
    { key: 'verde',      label: 'Verde',      emoji: '🟢', momio: 6.5 },
    { key: 'azul',       label: 'Azul',       emoji: '🔵', momio: 9.0 },
    { key: 'plateado',   label: 'Plateado',   emoji: '🥈', momio: 9.0 },
    { key: 'multicolor', label: 'Multicolor', emoji: '🌈', momio: 9.0 },
  ],
};

// ── SIEMBRA DE APUESTAS ESPECIALES (Claude las prepara; aparecen solas al desplegar) ──
// Se inyectan una sola vez por id (idempotente). Si el admin borra una, NO revive.
export const ESPECIALES_SEED = [
  {
    id: 'hosts-apertura-v1',
    titulo: '¿Ganan los 3 anfitriones?',
    emoji: '🏆',
    pregunta: '¿Ganarán México, Canadá y USA sus partidos de apertura? (México ya ganó 2-0)',
    nota: 'Cierra antes del Canadá–Bosnia (viernes 12:00 pm Tijuana)',
    cierra: Date.UTC(2026, 5, 12, 19, 0, 0), // vie 12 jun, 12:00 pm Tijuana
    img: '/esp-hosts.png', tint: ['#1FC43A', '#0C8C26'],
    opciones: [
      { key: 'si', label: 'Sí, ganan los 3', emoji: '✅', momio: 2.4 },
      { key: 'no', label: 'No, alguno falla', emoji: '❌', momio: 1.55 },
    ],
    res: null, activo: true, creado: 1749700001000,
  },
  {
    id: 'katy-primera-cancion-v1',
    titulo: 'Primera canción de Katy Perry',
    emoji: '🎤',
    pregunta: '¿Con qué canción ABRIRÁ Katy Perry su show en la inauguración de USA (SoFi)?',
    nota: 'Ceremonia 6:30 pm Tijuana · cierra al empezar',
    cierra: Date.UTC(2026, 5, 13, 1, 30, 0), // vie 12 jun, 6:30 pm Tijuana
    img: '/esp-katy.png', tint: ['#E5402A', '#FFB400'],
    opciones: [
      { key: 'firework',        label: 'Firework',        emoji: '🎆', momio: 3.2 },
      { key: 'californiagurls', label: 'California Gurls', emoji: '🌴', momio: 3.8 },
      { key: 'roar',            label: 'Roar',            emoji: '🦁', momio: 4.5 },
      { key: 'teenagedream',    label: 'Teenage Dream',   emoji: '💋', momio: 6.5 },
      { key: 'darkhorse',       label: 'Dark Horse',      emoji: '🐎', momio: 8.0 },
      { key: 'otro',            label: 'Otro',            emoji: '🎵', momio: 2.8 },
    ],
    res: null, activo: true, creado: 1749700000000,
  },
];

// ── RULETA DE LA SUERTE ─────────────────────────────────────────
// Cada giro cuesta 1 ticket. Los tickets se dan 2/día por jugador (máx 4 acumulados).
// Sólo gira quien tiene MENOS de $10,000 entre saldo + apuestas activas (candado de rescate).
// El servidor elige el premio (cliente sólo anima al segmento devuelto).
// 10 segmentos, 36° cada uno · pesos en porcentaje (suman 100).
export const RULETA = {
  ticketsDia: 2,
  ticketsMax: 4,
  jackpotAporte: 100,    // cada giro mete $100 al pozo común
  jackpotSemilla: 30000, // valor inicial del pozo
  lockLimit: 10000,      // sólo gira quien tiene < $10K (saldo + apuestas activas)
  segmentos: [
    { key:'c1000',   label:'$1,000',   color:'#1b9e6e', text:'#fff',    tipo:'money',  valor:1000,  prob:0.26 },
    { key:'social',  label:'QUITA',    sub:'al líder',  color:'#c0392b', text:'#fff',  tipo:'social', valor:2000, prob:0.13, emoji:'😈' },
    { key:'c4000',   label:'$4,000',   color:'#15835b', text:'#fff',    tipo:'money',  valor:4000,  prob:0.14 },
    { key:'jackpot', label:'JACKPOT',  color:'#f5c24b', text:'#3a2a00', tipo:'jackpot', prob:0.003, emoji:'🎰' },
    { key:'c2000',   label:'$2,000',   color:'#1b9e6e', text:'#fff',    tipo:'money',  valor:2000,  prob:0.22 },
    { key:'c10000',  label:'$10,000',  color:'#0f9b8e', text:'#fff',    tipo:'money',  valor:10000, prob:0.04,  emoji:'💰' },
    { key:'nada',    label:'NADA',     color:'#34435c', text:'#aab8d0', tipo:'nada',   prob:0.10, emoji:'😅' },
    { key:'c6000',   label:'$6,000',   color:'#157a54', text:'#fff',    tipo:'money',  valor:6000,  prob:0.08 },
    { key:'c20000',  label:'$20,000',  color:'#f0b73e', text:'#3a2a00', tipo:'money',  valor:20000, prob:0.009, emoji:'👑' },
    { key:'c15000',  label:'$15,000',  color:'#d9a83f', text:'#2a1f00', tipo:'money',  valor:15000, prob:0.018, emoji:'💎' },
  ],
};
