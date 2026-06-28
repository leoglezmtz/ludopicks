# LudoPicks — Agente de WhatsApp (voz → cambios → deploy)

Guía para conectar un **Claude Code por WhatsApp** que pueda editar LudoPicks y desplegar,
manejado con **mensajes de texto o notas de voz** entre Sergio y su socio.

> No es esta sesión exacta enchufada a WhatsApp. Es **otra instancia de Claude Code**
> corriendo en una PC tuya, dentro de este mismo repo, así que carga el mismo
> `CLAUDE.md` + memoria y tiene todo el contexto de LudoPicks. Funcionalmente: es como
> hablar conmigo por WhatsApp.

---

## 1. Cómo funciona (mapa mental)

```
Tu nota de voz / texto
        │
        ▼
WhatsApp  ──(librería Baileys, como WhatsApp Web)──►  PC always-on
        │                                                  │
        │                                       transcripción Whisper
        │                                       (local gratis o Groq nube)
        │                                                  ▼
        │                                       Claude Code (en este repo)
        │                                       edita → node --check → commit → push
        │                                                  │
        ▼                                                  ▼
te responde por el chat  ◄───────────────────  Vercel deploya (push a main)
```

### El "número": NO es ficticio
WhatsApp exige un número real. El modelo es como **WhatsApp Web**: la PC se *vincula* a
una cuenta de WhatsApp y actúa en su nombre. Dos opciones:

- **Opción 1 — número dedicado (RECOMENDADA):** consigues un **segundo número** (SIM barato
  o eSIM), registras WhatsApp con él, y **ese se vuelve "el bot"**. Tú y tu socio lo agregan
  como contacto y le escriben ahí. La PC queda vinculada a ese número.
- **Opción 2 — tu propio número + "Mensajearme a mí mismo".** Funciona pero el agente ve
  todos tus chats y tu socio no comparte el hilo. Para dos personas, peor.

👉 Usa la **Opción 1**. Ambos agregan ese contacto = chat de asistente compartido.

### Notas de voz: SÍ
El plugin descarga el audio, lo transcribe (español sin problema) y el texto entra a
Claude Code como si lo hubieras tecleado.

---

## 2. Requisitos

- PC **always-on** (tu Windows 10, o un mini-servidor / Raspberry Pi).
- **Node.js ≥ 18** instalado en esa PC (ver §6 — esta máquina no lo tenía).
- **Git** configurado con push a `leoglezmtz/ludopicks` (este repo ya está clonado en `D:\LULDOPICKS\ludopicks`).
- Una **cuenta de WhatsApp dedicada** (segundo número).
- (Opcional) `GROQ_API_KEY` si quieres transcripción en la nube (más rápida/precisa).

---

## 3. Instalación (Windows, plugin `crisandrews/claude-whatsapp`)

> Elegimos este plugin (no el de Rich627) porque ese transcribe con `mlx-whisper`,
> que es **solo Apple Silicon**. crisandrews corre en Windows/Linux/Mac.

```powershell
# 1. Carpeta aislada solo para el canal de WhatsApp
mkdir $HOME\ludo-whatsapp
cd $HOME\ludo-whatsapp
claude

# 2. Dentro de Claude Code: agregar marketplace e instalar el canal
/plugin marketplace add crisandrews/claude-whatsapp
/plugin install whatsapp@claude-whatsapp      # scope local

# 3. Salir y relanzar Claude Code DENTRO del repo, con el canal cargado
#    (así el agente tiene acceso al código de LudoPicks + CLAUDE.md)
cd D:\LULDOPICKS\ludopicks
claude --dangerously-load-development-channels plugin:whatsapp@claude-whatsapp --dangerously-skip-permissions

# 4. Vincular el WhatsApp dedicado (código de 8 caracteres, sin cámara)
/whatsapp:configure pair +52XXXXXXXXXX
#   → en el teléfono del número dedicado:
#     WhatsApp > Ajustes > Dispositivos vinculados > Vincular con número > teclear el código

# 5. BLINDAR el acceso a SOLO ustedes dos (¡imprescindible!)
/whatsapp:access policy allowlist
/whatsapp:access allow <tu-numero-personal>
/whatsapp:access allow <numero-de-tu-socio>

# 6. Transcripción de voz — elige una:
/whatsapp:configure audio            # LOCAL: gratis, offline, 99 idiomas (~77MB primer uso)
# o en la nube (más rápida/precisa; el audio sale a Groq):
/whatsapp:configure audio provider   # requiere GROQ_API_KEY en el entorno
```

### Que siga vivo 24/7 (Task Scheduler de Windows)
El plugin trae recetas en su `operations.md`. La idea: una tarea programada que lance el
comando del paso 3 al iniciar sesión de Windows y lo reinicie si se cae. Pídele al propio
agente "configúrame la tarea de Task Scheduler según tu operations.md".

---

## 4. ⚠️ Guardrails (LÉELO — esto puede tumbar producción)

LudoPicks está **en vivo** con ~25 jugadores en plena eliminatoria. Un audio mal entendido
no debe romper el juego. Por eso:

1. **`--dangerously-skip-permissions`** = el agente actúa sin pedir confirmación. Combínalo
   con la allowlist SIEMPRE (sin ella, cualquiera que escriba al número manda).
2. **Número dedicado, no tu WhatsApp principal** (Baileys es librería no-oficial; riesgo bajo
   pero real de que WhatsApp marque el número).
3. **Regla de deploy con palabra clave** (ver `CLAUDE.md` → "Modo agente de WhatsApp"):
   - Cambios chicos (texto, color, copy) → puede ir directo a `main`.
   - Cambios estructurales (backend, liquidación, momios, datos) → rama + esperar que digas
     **"deploya"** antes de tocar `main`.
4. **Validación obligatoria** antes de cada push: `node --check` del backend y del script del
   `index.html` (esto habría atrapado el bug de la pantalla en blanco de v1.44.x).
5. **Nunca** poner la `adminKey` ni secretos en archivos commiteados (van por variable de
   entorno / memoria local).

---

## 5. Ejemplos de uso (lo que le mandarías por voz)

- 🎙️ *"Cámbiale el texto del botón de penales a 'Habrá tanda de penales' y deploya."*
- 🎙️ *"Refresca los momios del partido de México contra Ecuador, súbele el momio del empate."*
- 🎙️ *"Manda un push a todos avisando que abren las apuestas de cuartos."*
- 🎙️ *"¿Cuántos jugadores tienen regalos sin cobrar?"* (solo lectura, sin deploy)

El agente transcribe, hace el cambio, valida, despliega (si aplica la regla) y te confirma
por el chat con el número de versión nuevo.

---

## 6. Nota importante sobre Node en la PC

La validación `node --check` es OBLIGATORIA pero requiere Node instalado. Si la PC no lo tiene:

- **Recomendado:** instala Node ≥18 desde https://nodejs.org (el plugin de WhatsApp también lo necesita).
- **Fallback rápido sin instalar Node global** (lo usé en esta sesión): Node embebido vía pip:
  ```bash
  python -m pip install nodejs-bin
  # el binario queda en .../site-packages/nodejs/node.exe
  ```

---

## 7. Costos

- Plugin: gratis (open source).
- Transcripción local: gratis. Groq: prácticamente gratis para 2 personas.
- Lo que consume es tu plan de Claude (cada mensaje = una corrida de Claude Code).

---

## Referencias
- Plugin recomendado: https://github.com/crisandrews/claude-whatsapp
- Alternativa (Mac): https://github.com/Rich627/whatsapp-claude-plugin
