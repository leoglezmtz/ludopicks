# LudoPicks — Guía para Claude Code

App de apuestas ficticias del Mundial 2026 entre ~10 amigos (sin dinero real).  
**Producción:** https://ludopicks.vercel.app  
**Repo:** leoglezmtz/ludopicks  
**Versión actual en producción:** v1.24.3

---

## ⚠️ REGLAS OBLIGATORIAS — leer primero

### 1. Nunca tocar Vercel
Las tools de Vercel MCP conectadas pertenecen a la cuenta de un compañero, NO a este proyecto.
**Nunca** usar: `Vercel:deploy_to_vercel`, `Vercel:list_projects`, `Vercel:get_project`, ni ninguna tool de Vercel.
El deploy ocurre automáticamente cuando se hace push a `main` en GitHub.

### 2. Versionado obligatorio en cada cambio
**Siempre** que hagas cualquier cambio de código, actualiza la constante `APP_VERSION` en `public/index.html`:
```js
const APP_VERSION='1.24.3'; // → incrementar a 1.24.4, 1.25.0, etc.
```
**Criterio de versión:**
- Patch (1.24.X) → bug fix, ajuste visual, cambio pequeño
- Minor (1.X.0) → feature nueva, mercado nuevo, sección nueva
- El número va en el footer de la app automáticamente

### 3. Validar SIEMPRE antes de commitear
```bash
# Validar backend (ESM)
cp api/game.js /tmp/cg.mjs && node --check /tmp/cg.mjs

# Validar frontend JS
node -e "
const fs=require('fs');
const html=fs.readFileSync('public/index.html','utf8');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(s=>s.trim().length>200);
fs.writeFileSync('/tmp/ci.js',scripts[scripts.length-1]);
" && node --check /tmp/ci.js

# Validar que game.js importa sin errores
node -e "import('/ruta/absoluta/api/game.js').then(()=>console.log('OK')).catch(e=>console.error(e.message));"
```

### 4. Flujo de commit
```bash
git add -A
git commit -m "v1.X.Y: descripción corta del cambio"
git push origin main
# Vercel despliega en ~30 segundos
```

---

## Estructura del proyecto

```
ludopicks/
├── CLAUDE.md              ← este archivo (memoria permanente)
├── api/game.js            ← backend ESM serverless (~1,250 líneas)
│                            único endpoint: /api/game
├── lib/data.js            ← partidos, momios, constantes (~295 líneas)
├── public/
│   ├── index.html         ← SPA completa (~4,400 líneas), todo el frontend
│   ├── sw.js              ← service worker para push notifications
│   ├── manifest.json      ← PWA config, theme_color #0a0a0a
│   └── *.png              ← iconos e ilustraciones
├── package.json           ← única dep: @vercel/kv ^2.0.0
└── vercel.json            ← rewrites /api → api/game.js
```

---

## Arquitectura

### Backend (`api/game.js`)
- **ESM puro** — no CommonJS. Importa con `import`, exporta con `export default`
- Un único handler: `export default async function handler(req, res)`
- `GET /api/game` → devuelve estado completo del juego
- `POST /api/game` → todas las acciones: `{ action, payload }`
- Usa `@vercel/kv` (Redis) para persistencia. Variables de entorno en Vercel.

### Frontend (`public/index.html`)
- SPA sin framework, JS vanilla puro
- Variables globales clave: `state`, `me`, `isAdmin`, `adminKey`, `betslip`, `currentTab`, `lineSel`
- `state` contiene todo lo del GET: jugadores, apuestas, resultados, liveScores, etc.
- La función `api({action, payload})` hace el POST al backend

### Persistencia KV (Vercel KV / Redis)
```
jugadores     → {nombre: {saldo, avatar, tickets, saldoDia, lastTicketDay, doble}}
apuestas      → {id: {tipo, nombre, partidoId, pick, linea, mercado, monto, momio,
                       status, payout, legs?, momioTotal?, ts}}
resultados    → {partidoId: {gl, gv, pa?, parcial?, corners?, tarjetas?}}
liveScores    → {partidoId: {gl, gv, corners, tarjetas, ts}}
rankPrev      → {pos, saldo, partidoId, ts}
campeon       → string | null
especiales    → {id: {titulo, opciones, cierra, res?, archivada?}}
pushSubs      → {nombre: PushSubscription}
jackpot       → number (semilla $30,000)
ruletaHist    → array últimas 60 tiradas
```

---

## Convenciones de código

### Mercados de apuestas
```
b.mercado: 'goles' | 'corners' | 'tarjetas' | '1x2' | 'btts'
```
- Apuestas antiguas sin `mercado` o con `'ou'` → tratar como `'goles'`
- Líneas goles: `[0.5, 1.5, 2.5, 3.5, 4.5, 5.5]`
- Líneas córners: `[6.5, 7.5, 8.5, 9.5, 10.5, 11.5]`
- Líneas tarjetas: `[2.5, 3.5, 4.5, 5.5]`
- Momios están en `lib/data.js`: `MOMIOS_CORNERS`, `MOMIOS_TARJETAS`

### settleAll — siempre pasar liveScores
```js
// Firma completa:
settleAll(jugadores, apuestas, resultados, campeon, especiales, liveScores)
// Llamar siempre así:
settleAll(jugadores, apuestas, resultados, campeon, especialesMap, (await kv.get("liveScores")) || {});
```

### snapshotIfFirstTouch — para ranking delta
```js
await snapshotIfFirstTouch(jugadores, partidoId);
// Solo toma snapshot si no hay uno ya para ese partido
// Se llama en: setLiveScore, aplicarPA, resultado
```

### Insta-pago en vivo
Al actualizar `liveScores`, `settleAll` paga automáticamente mercados irrevocables:
- ✅ **BTTS Sí** → cuando ambos anotaron
- ✅ **Over X.Y** → cuando el contador superó la línea
- ❌ NO insta-paga: 1X2, Under, BTTS No (pueden cambiar)

### Pago Anticipado (PA / "2 Up")
- Solo en partidos con `p.pa === true`
- Admin aplica PA → pago inmediato simples, parlays esperan
- En KV: `resultados[pid] = { pa: {l, v}, parcial: true }` (sin gl/gv)

---

## UI — Dos vistas según el usuario

### Vista jugador
Tabs: Partidos · Especiales · Mis Picks · Ranking · Récords · Liguilla

### Vista admin (`isAdmin === true`)
Tabs que VE el admin: **solo las de admin** (Mis Picks, Récords, Liguilla se ocultan)
```
⚽ Resultados | 🎁 Regalar | ✨ Especiales | 👥 Jugadores | 📣 Push | 🎰 Casino
```

### Modal de resultado del partido (`openScore`)
Secciones ordenadas:
1. Marcador (inputs con botones +/− `bumpScore`)
2. Córners y tarjetas (opcionales)
3. PA si `p.pa === true` — dos botones grandes por equipo (`aplicarPaQuick`)
4. Acciones: "🔴 Actualizar en vivo" (`saveLiveScore`) | "🏁 Guardar resultado final" (`saveScore`) | "↩ Revertir"

### Lista de partidos en admin
Ordenados por urgencia:
1. 🔴 EN VIVO AHORA (kickoff ≤ now ≤ kickoff+2.5h, sin marcador final)
2. ⏰ PENDIENTES DE LIQUIDAR (ya pasaron, sin marcador)
3. 📅 PRÓXIMOS (kickoff futuro) — primeros 6 + "Ver más"
4. ✅ COMPLETADOS — colapsados por defecto

---

## Diseño y estilo

```css
--bg: #060606
--green: #1FC43A
--gold: #FFDB00 (también --al)
--rl: color rojo para pérdidas
```
- Sin frameworks CSS — vanilla puro con custom properties
- Mobile-first, diseñado para iOS/Android
- PWA con push notifications via service worker
- Avatares: SVG generado (`buildAvSvg`) o foto dataURL en KV (max ~30KB JPEG)
- Confeti: canvas-confetti desde cdnjs, colores: `['#FFDB00','#1FC43A','#ffffff','#E5402A']`

---

## La Ruleta

- 10 segmentos, EV ~$2,590 por giro
- Jackpot: semilla $30K, +$100 por giro sin jackpot
- Candado: saldo + apuestas activas ≥ $10K para poder girar
- Robo $2,000 al líder (no de la casa — lo pierde el líder)
- Tickets: 2 por día, máximo 4 acumulados (se dan en `grantTicketsIfNew`)

---

## Historial de versiones recientes

| Versión | Cambio principal |
|---------|-----------------|
| v1.20.0 | Mercados córners y tarjetas |
| v1.21.0 | Sistema live scores + barras de progreso estilo Draftea + push PA |
| v1.22.0 | Admin reorganizado por urgencia + PA simplificado a 2 botones |
| v1.22.1 | Mini-barras en patas de parlay (bubble + línea de meta) |
| v1.23.0 | Insta-pago automático en vivo para mercados irrevocables |
| v1.24.0 | Fix delta ranking (snapshotIfFirstTouch) + UI admin limpiada |
| v1.24.3 | **VERSIÓN ACTUAL EN PRODUCCIÓN** |

---

## Checklist antes de cada commit

- [ ] `APP_VERSION` incrementado en `public/index.html`
- [ ] `node --check /tmp/cg.mjs` pasa sin errores
- [ ] `node --check /tmp/ci.js` pasa sin errores
- [ ] Probado mentalmente el flujo completo del cambio
- [ ] Commit message incluye el número de versión: `"v1.X.Y: descripción"`
