// Momios basados en FanDuel Sportsbook (Mayo 2026)
// Conversión: americano positivo (+X) → decimal = 1 + X/100
//             americano negativo (-X) → decimal = 1 + 100/X
// Momios de partido individual (1X2) estimados desde odds de grupo + rankings FIFA

export const SALDO_INICIAL = 10000;

export const PARTIDOS = [
  // ── JORNADA 1 ──────────────────────────────────────────────────────────
  // Grupo A: MEX favorito claro (-110 grupo), RSA gran underdog
  { id: 1,  fecha:"Jue 11/6", hora:"12:00", local:"MEX", visita:"RSA", grupo:"A", momios:{ local:1.58, empate:3.60, visita:6.00 } },
  { id: 2,  fecha:"Jue 11/6", hora:"19:00", local:"KOR", visita:"CZE", grupo:"A", momios:{ local:2.30, empate:3.20, visita:3.10 } },
  // Grupo B: SUI favorito, CAN sólido, BIH media tabla, QAT gran underdog (+3000)
  { id: 3,  fecha:"Vie 12/6", hora:"12:00", local:"CAN", visita:"BIH", grupo:"B", momios:{ local:2.00, empate:3.30, visita:3.80 } },
  { id: 4,  fecha:"Vie 12/6", hora:"18:00", local:"USA", visita:"PAR", grupo:"D", momios:{ local:1.85, empate:3.40, visita:4.50 } },
  // Grupo B / C
  { id: 5,  fecha:"Sáb 13/6", hora:"12:00", local:"QAT", visita:"SUI", grupo:"B", momios:{ local:7.00, empate:4.50, visita:1.40 } },
  { id: 6,  fecha:"Sáb 13/6", hora:"15:00", local:"BRA", visita:"MAR", grupo:"C", momios:{ local:1.45, empate:4.00, visita:7.00 } },
  { id: 7,  fecha:"Sáb 13/6", hora:"18:00", local:"HAI", visita:"SCO", grupo:"C", momios:{ local:9.00, empate:5.00, visita:1.35 } },
  { id: 8,  fecha:"Sáb 13/6", hora:"21:00", local:"AUS", visita:"TUR", grupo:"D", momios:{ local:3.20, empate:3.30, visita:2.25 } },
  // Grupo E: GER gran favorito (-250), CUW enorme underdog (+12000)
  { id: 9,  fecha:"Dom 14/6", hora:"10:00", local:"GER", visita:"CUW", grupo:"E", momios:{ local:1.22, empate:6.50, visita:16.0 } },
  { id: 10, fecha:"Dom 14/6", hora:"13:00", local:"NED", visita:"JPN", grupo:"F", momios:{ local:1.72, empate:3.60, visita:5.00 } },
  { id: 11, fecha:"Dom 14/6", hora:"16:00", local:"CIV", visita:"ECU", grupo:"E", momios:{ local:2.70, empate:3.20, visita:2.70 } },
  { id: 12, fecha:"Dom 14/6", hora:"19:00", local:"SWE", visita:"TUN", grupo:"F", momios:{ local:2.20, empate:3.30, visita:3.40 } },
  // Grupo H: ESP enorme favorito (-310)
  { id: 13, fecha:"Lun 15/6", hora:"09:00", local:"ESP", visita:"CPV", grupo:"H", momios:{ local:1.20, empate:6.00, visita:14.0 } },
  // Grupo G: BEL sólido favorito (-220)
  { id: 14, fecha:"Lun 15/6", hora:"12:00", local:"BEL", visita:"EGY", grupo:"G", momios:{ local:1.60, empate:3.70, visita:5.50 } },
  { id: 15, fecha:"Lun 15/6", hora:"15:00", local:"KSA", visita:"URU", grupo:"H", momios:{ local:4.50, empate:3.50, visita:1.85 } },
  { id: 16, fecha:"Lun 15/6", hora:"18:00", local:"IRN", visita:"NZL", grupo:"G", momios:{ local:2.10, empate:3.30, visita:3.60 } },
  // Grupo I: FRA fuerte favorito (-215)
  { id: 17, fecha:"Mar 16/6", hora:"12:00", local:"FRA", visita:"SEN", grupo:"I", momios:{ local:1.47, empate:4.00, visita:6.50 } },
  { id: 18, fecha:"Mar 16/6", hora:"15:00", local:"IRQ", visita:"NOR", grupo:"I", momios:{ local:5.00, empate:4.00, visita:1.65 } },
  // Grupo J: ARG favorito (-250)
  { id: 19, fecha:"Mar 16/6", hora:"18:00", local:"ARG", visita:"ALG", grupo:"J", momios:{ local:1.40, empate:4.20, visita:8.00 } },
  { id: 20, fecha:"Mar 16/6", hora:"21:00", local:"AUT", visita:"JOR", grupo:"J", momios:{ local:1.80, empate:3.50, visita:5.00 } },
  // Grupo K: POR favorito (-215)
  { id: 21, fecha:"Mié 17/6", hora:"10:00", local:"POR", visita:"COD", grupo:"K", momios:{ local:1.47, empate:4.00, visita:7.00 } },
  // Grupo L: ENG favorito (-280)
  { id: 22, fecha:"Mié 17/6", hora:"13:00", local:"ENG", visita:"CRO", grupo:"L", momios:{ local:1.60, empate:3.70, visita:5.50 } },
  { id: 23, fecha:"Mié 17/6", hora:"16:00", local:"GHA", visita:"PAN", grupo:"L", momios:{ local:2.40, empate:3.20, visita:3.10 } },
  { id: 24, fecha:"Mié 17/6", hora:"19:00", local:"UZB", visita:"COL", grupo:"K", momios:{ local:5.00, empate:3.80, visita:1.72 } },
  // ── JORNADA 2 ──────────────────────────────────────────────────────────
  { id: 25, fecha:"Jue 18/6", hora:"09:00", local:"CZE", visita:"RSA", grupo:"A", momios:{ local:2.10, empate:3.30, visita:3.60 } },
  { id: 26, fecha:"Jue 18/6", hora:"12:00", local:"SUI", visita:"BIH", grupo:"B", momios:{ local:1.72, empate:3.60, visita:5.00 } },
  { id: 27, fecha:"Jue 18/6", hora:"15:00", local:"CAN", visita:"QAT", grupo:"B", momios:{ local:1.47, empate:4.00, visita:7.50 } },
  { id: 28, fecha:"Jue 18/6", hora:"18:00", local:"MEX", visita:"KOR", grupo:"A", momios:{ local:1.90, empate:3.40, visita:4.20 } },
  { id: 29, fecha:"Vie 19/6", hora:"12:00", local:"USA", visita:"AUS", grupo:"D", momios:{ local:1.72, empate:3.60, visita:5.00 } },
  { id: 30, fecha:"Vie 19/6", hora:"15:00", local:"SCO", visita:"MAR", grupo:"C", momios:{ local:2.80, empate:3.20, visita:2.60 } },
  { id: 31, fecha:"Vie 19/6", hora:"18:00", local:"BRA", visita:"HAI", grupo:"C", momios:{ local:1.18, empate:7.00, visita:18.0 } },
  { id: 32, fecha:"Vie 19/6", hora:"21:00", local:"TUR", visita:"PAR", grupo:"D", momios:{ local:2.00, empate:3.30, visita:3.80 } },
  { id: 33, fecha:"Sáb 20/6", hora:"10:00", local:"NED", visita:"SWE", grupo:"F", momios:{ local:1.80, empate:3.50, visita:4.50 } },
  { id: 34, fecha:"Sáb 20/6", hora:"13:00", local:"GER", visita:"CIV", grupo:"E", momios:{ local:1.55, empate:3.80, visita:5.50 } },
  { id: 35, fecha:"Sáb 20/6", hora:"19:00", local:"ECU", visita:"CUW", grupo:"E", momios:{ local:1.47, empate:4.00, visita:7.00 } },
  { id: 36, fecha:"Sáb 20/6", hora:"21:00", local:"TUN", visita:"JPN", grupo:"F", momios:{ local:3.50, empate:3.30, visita:2.10 } },
  { id: 37, fecha:"Dom 21/6", hora:"09:00", local:"ESP", visita:"KSA", grupo:"H", momios:{ local:1.28, empate:5.50, visita:11.0 } },
  { id: 38, fecha:"Dom 21/6", hora:"12:00", local:"BEL", visita:"IRN", grupo:"G", momios:{ local:1.55, empate:3.80, visita:5.50 } },
  { id: 39, fecha:"Dom 21/6", hora:"15:00", local:"URU", visita:"CPV", grupo:"H", momios:{ local:1.40, empate:4.20, visita:8.50 } },
  { id: 40, fecha:"Dom 21/6", hora:"18:00", local:"NZL", visita:"EGY", grupo:"G", momios:{ local:3.00, empate:3.20, visita:2.40 } },
  { id: 41, fecha:"Lun 22/6", hora:"10:00", local:"ARG", visita:"AUT", grupo:"J", momios:{ local:1.47, empate:4.00, visita:7.00 } },
  { id: 42, fecha:"Lun 22/6", hora:"14:00", local:"FRA", visita:"IRQ", grupo:"I", momios:{ local:1.25, empate:5.50, visita:12.0 } },
  { id: 43, fecha:"Lun 22/6", hora:"17:00", local:"NOR", visita:"SEN", grupo:"I", momios:{ local:1.90, empate:3.40, visita:4.20 } },
  { id: 44, fecha:"Lun 22/6", hora:"20:00", local:"JOR", visita:"ALG", grupo:"J", momios:{ local:3.60, empate:3.30, visita:2.10 } },
  { id: 45, fecha:"Mar 23/6", hora:"10:00", local:"POR", visita:"UZB", grupo:"K", momios:{ local:1.30, empate:5.00, visita:10.0 } },
  { id: 46, fecha:"Mar 23/6", hora:"13:00", local:"ENG", visita:"GHA", grupo:"L", momios:{ local:1.55, empate:3.80, visita:5.50 } },
  { id: 47, fecha:"Mar 23/6", hora:"16:00", local:"PAN", visita:"CRO", grupo:"L", momios:{ local:4.00, empate:3.50, visita:2.00 } },
  { id: 48, fecha:"Mar 23/6", hora:"19:00", local:"COL", visita:"COD", grupo:"K", momios:{ local:1.72, empate:3.60, visita:5.00 } },
  // ── JORNADA 3 ──────────────────────────────────────────────────────────
  { id: 49, fecha:"Mié 24/6", hora:"12:00", local:"SUI", visita:"CAN", grupo:"B", momios:{ local:2.10, empate:3.30, visita:3.40 } },
  { id: 50, fecha:"Mié 24/6", hora:"12:00", local:"BIH", visita:"QAT", grupo:"B", momios:{ local:2.30, empate:3.20, visita:3.10 } },
  { id: 51, fecha:"Mié 24/6", hora:"15:00", local:"SCO", visita:"BRA", grupo:"C", momios:{ local:8.00, empate:5.00, visita:1.33 } },
  { id: 52, fecha:"Mié 24/6", hora:"15:00", local:"MAR", visita:"HAI", grupo:"C", momios:{ local:1.40, empate:4.20, visita:8.50 } },
  { id: 53, fecha:"Mié 24/6", hora:"18:00", local:"CZE", visita:"MEX", grupo:"A", momios:{ local:2.80, empate:3.20, visita:2.55 } },
  { id: 54, fecha:"Mié 24/6", hora:"18:00", local:"RSA", visita:"KOR", grupo:"A", momios:{ local:3.80, empate:3.40, visita:2.00 } },
  { id: 55, fecha:"Jue 25/6", hora:"13:00", local:"CUW", visita:"CIV", grupo:"E", momios:{ local:12.0, empate:6.00, visita:1.25 } },
  { id: 56, fecha:"Jue 25/6", hora:"13:00", local:"ECU", visita:"GER", grupo:"E", momios:{ local:4.50, empate:3.60, visita:1.72 } },
  { id: 57, fecha:"Jue 25/6", hora:"16:00", local:"JPN", visita:"SWE", grupo:"F", momios:{ local:2.60, empate:3.20, visita:2.75 } },
  { id: 58, fecha:"Jue 25/6", hora:"16:00", local:"TUN", visita:"NED", grupo:"F", momios:{ local:5.50, empate:4.00, visita:1.55 } },
  { id: 59, fecha:"Jue 25/6", hora:"19:00", local:"TUR", visita:"USA", grupo:"D", momios:{ local:2.50, empate:3.30, visita:2.75 } },
  { id: 60, fecha:"Jue 25/6", hora:"19:00", local:"PAR", visita:"AUS", grupo:"D", momios:{ local:2.75, empate:3.20, visita:2.60 } },
  { id: 61, fecha:"Vie 26/6", hora:"12:00", local:"NOR", visita:"FRA", grupo:"I", momios:{ local:3.75, empate:3.50, visita:1.90 } },
  { id: 62, fecha:"Vie 26/6", hora:"12:00", local:"SEN", visita:"IRQ", grupo:"I", momios:{ local:1.80, empate:3.50, visita:4.50 } },
  { id: 63, fecha:"Vie 26/6", hora:"17:00", local:"CPV", visita:"KSA", grupo:"H", momios:{ local:7.00, empate:4.50, visita:1.40 } },
  { id: 64, fecha:"Vie 26/6", hora:"17:00", local:"URU", visita:"ESP", grupo:"H", momios:{ local:3.80, empate:3.40, visita:1.95 } },
  { id: 65, fecha:"Vie 26/6", hora:"20:00", local:"EGY", visita:"IRN", grupo:"G", momios:{ local:2.40, empate:3.20, visita:3.00 } },
  { id: 66, fecha:"Vie 26/6", hora:"20:00", local:"NZL", visita:"BEL", grupo:"G", momios:{ local:5.50, empate:4.00, visita:1.55 } },
  { id: 67, fecha:"Sáb 27/6", hora:"14:00", local:"PAN", visita:"ENG", grupo:"L", momios:{ local:6.50, empate:4.50, visita:1.45 } },
  { id: 68, fecha:"Sáb 27/6", hora:"14:00", local:"CRO", visita:"GHA", grupo:"L", momios:{ local:2.00, empate:3.30, visita:3.80 } },
  { id: 69, fecha:"Sáb 27/6", hora:"16:30", local:"COL", visita:"POR", grupo:"K", momios:{ local:3.20, empate:3.30, visita:2.20 } },
  { id: 70, fecha:"Sáb 27/6", hora:"16:30", local:"COD", visita:"UZB", grupo:"K", momios:{ local:1.85, empate:3.40, visita:4.50 } },
  { id: 71, fecha:"Sáb 27/6", hora:"19:00", local:"ALG", visita:"AUT", grupo:"J", momios:{ local:2.50, empate:3.20, visita:2.90 } },
  { id: 72, fecha:"Sáb 27/6", hora:"19:00", local:"JOR", visita:"ARG", grupo:"J", momios:{ local:11.0, empate:6.00, visita:1.27 } },
];
