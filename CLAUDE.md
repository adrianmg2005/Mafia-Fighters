# Mafia Fighters — Guía del proyecto

**Platform fighter** 2D pixel art estilo Smash Bros. (daño por porcentaje, stocks, blast zones, plataformas semisólidas, agarre de bordes) con multijugador LAN, sobre Node.js/Express/Socket.io en el servidor y Canvas 2D + Gamepad API en el cliente. Simulación determinista a 60 Hz, host-autoritativa. Un personaje (Samuel, súper pesado, con su Modo Despertado) y un escenario (Patio Flotante).

Esta es la guía CORTA. **La referencia completa está en `docs/diseno.md`** (física, fórmulas, tablas de calibración, cada golpe de Samuel, arte y animación, cinemáticas, HUD, servidor) y el historial de mutaciones de la suite en `docs/mutaciones.md`. Antes de tocar un sistema, lee su sección de `docs/diseno.md` (índice abajo): casi todo número tiene detrás una medición y un bug que ya costó.

> Hasta septiembre de 2026 era un juego de lucha tradicional (barras de vida, rondas). Se reescribió entero; aquella versión está en `Desktop\mafiafighters_backup_pre_platform` (solo en el PC del autor). Nada de su motor de combate sobrevive: si se lee código viejo, no se mezcla.

## Arrancar, probar y mirar

```
npm install
npm start           # 0.0.0.0:3000; desde la LAN http://<IP>:3000, ?room=nombre separa partidas
npm test            # node --test tests/*.test.mjs (183 tests, ~35 s)
npm run smoke       # carga el main.js REAL con DOM/socket/reloj falsos y juega una partida entera
npm run stage:png | sprite:png | moves:png | vfx:png | cutin:png | moves:despertado:png | battle:png
```

Los `*:png` y el smoke vuelcan capturas a `tests/_*.png` para MIRARLAS (se pueden abrir con Read). Están en `.gitignore`: se regeneran, no se versionan. `node_modules` tampoco se versiona (`npm install`).

Con un solo cliente se juega contra un muñeco de prácticas (P2 sin input).

## Arquitectura en una pantalla

```
server.js                 relay LAN: SANEA los snapshots del host (isSaneSnapshot) y los reenvía; no simula
public/src/main.js        orquesta bucles, red, eventos -> VFX/SFX, dibujado. No decide nada del combate
public/src/engine/
  simulation.js           LA PARTIDA: step(inputs) = 1 frame. Sin canvas/red/reloj/Math.random
  physics.js              constantes globales, moveBody por ejes, semisólidas, bordes
  combat.js               knockback, vectorización, hitstun, DI, Sakurai, entierro. Pura
  inputManager.js         lectura (booleanos por red) + interpretación (InputTracker, buffer, resolveAttack)
  killPredictor.js        ¿K.O. seguro con todo el abanico de DI? (Special Zoom y hitstun largo)
  movePhase.js / keyedPoses.js / poseLibrary.js / pixelFighterArt.js / spriteAtlasBuilder.js / spriteAnimator.js   sprites
  renderer.js, platformHud.js, hud.js, pauseMenu.js, moveGuide.js, awakenCutin.js, battleFinale.js, impactFrames.js, ...
public/src/characters/
  fighter.js              máquina de estados 100% GENÉRICA
  commonMoves.js          esquivas, borde, levantadas, techs
  samuel.js               stats + moveTable, y los del MODO DESPERTADO (config.awakened)
  roster.js               la única lista de personajes
public/src/stages/        patioFlotante.js (combate), highSchoolCourtyard.js (fondo lejano)
tests/                    platform.test.mjs (167), stage.test.mjs (16), fakeCanvas.mjs, mainSmoke.mjs, render*.mjs
```

- **Solo el host (`p1`) ejecuta `sim.step`** y manda `{...sim.serialize(), seq, events}` cada tick. El remoto nunca simula: aplica el snapshot y reproduce los eventos con la misma `presentEvent`.
- **El render y el HUD leen solo VISTAS** (`Fighter#view()`), en el host y en el remoto. Si algo hace falta para dibujar, va en la vista; y si es un campo nuevo del snapshot o de la vista, **el servidor lo valida** (`server.js`), o descartará los paquetes.
- Dos bucles: simulación en el reloj de Web Worker (`engine/clock.js`), dibujado en `requestAnimationFrame`.
- La pausa, el hitlag, la cinemática del Final Smash (`sim.cine`) y la del Despertar (`sim.cutin`) son **estado de la simulación**: las dos pantallas se congelan en el mismo frame por construcción.

## Reglas que no se rompen

- **Determinismo**: la simulación no usa `Math.random`, `Date` ni `performance`. Si hace falta azar, RNG sembrado (`pixelGrid.js`). La presentación sí puede. Hay un test de 3000 frames que exige `serialize()` idéntico.
- **Nada de `if (personaje === ...)` en `fighter.js`**. Un movimiento especial se expresa como DATOS en su entrada de moveTable y se interpreta genéricamente (campos documentados en la cabecera de `samuel.js` y en `docs/diseno.md` §5).
- **Unidades px/frame y px/frame², sin `dt`.** `DEFAULT_STATS` usa las constantes de `physics.js`, nunca copias.
- **Un campo que nadie lee es peor que no tenerlo**: todo campo nuevo necesita una aserción sobre su EFECTO en el juego, no sobre su presencia en la tabla.
- Cliente ESM en `public/src` (`public/src/package.json` existe solo para que Node lo importe como ESM); servidor CommonJS.
- Todo el HUD se dibuja en el canvas (1280×720 lógicos, letterbox por `viewport.js`), nunca como HTML.
- Invariantes: 20.000 frames de machaque aleatorio sin valores no finitos ni nadie atascado > 10 s en el mismo estado.

## Tests: las dos reglas

1. **Un test que no puede fallar no sirve.** Cada aserción se comprueba rompiendo a propósito lo que vigila (mutación) y viendo que falla. Varios mutantes supervivientes destaparon bugs reales (ver `docs/mutaciones.md`).
2. **No derives lo esperado de la constante que quieres proteger.** Los números del diseño se escriben LITERALES en el test.

`tests/fakeCanvas.mjs` es un canvas 2D headless que **rasteriza de verdad** (composición, degradados, `drawImage` espejado, recortes) y vuelca PNG: los tests CUENTAN píxeles y miden luminancias, que es como se ha encontrado todo bug de arte. **No admite rotación**: `rotate()` no gira nada y lo cuenta en `unsupportedRotations`. Por eso el arte evita `rotate()` donde un test tiene que medir.

## Números y decisiones que es fácil romper sin querer

- **KB → velocidad**: `KB_TO_SPEED` 0.1 px/f por unidad, `KB_DECAY` 0.17 px/f² (la única desviación del diseño original). Los BKB/KBG de los smashes salen de una búsqueda en rejilla contra los umbrales de K.O. de `docs/diseno.md` §3. **Si cambian blast zones, gravedad, pesos o la regla del salto, la tabla se rehace con la rejilla, no a ojo.**
- **Hitstun desacoplado**: golpe que no mata `min(22, floor(KB·0.4))`; el largo sin tope solo si `killPredictor` declara K.O. seguro con cualquier DI. Zoom, bloqueo largo y K.O. van juntos.
- **Tumble si KB > 32**, hitlag `min(18, floor(daño·0.45 + 4))`, buffer de 6 frames, jump squat de 3, caída rápida 1.6× la terminal.
- **Fase canónica** (`movePhase.js`): el `progress` de un golpe pone los frames activos en [0.3, 0.5), así las poses cuadran con cualquier frame data.
- `CELL_PADDING_X/Y` (84/72) en el atlas: quedarse corto **recorta sprites en silencio**.
- Intangibilidad desde el frame 0 del movimiento; el agarre gana al escudo; `resolveHits` recoge todos los impactos del frame antes de aplicarlos (trades).

## Índice de `docs/diseno.md`

| § | tema |
|---|---|
| 1 | Arquitectura, red, bucles |
| 2 | Física: `moveBody`, semisólidas, caída rápida, pie en rombo, borde y robo de borde |
| 3 | Knockback, hitstun, tumble, Sakurai, **tabla de umbrales de K.O.**, DI, Special Zoom, `receiveHit`, trades, hitlag |
| 4 | Controles (teclado/mando), buffer, SOCD, jump squat |
| 5 | Fighter: estados, campos de moveTable, movilidad, tech, escudo, agarre, respawn |
| 6 | Samuel: stats y moveset normal |
| 6.1 | Pausa y guía de combate |
| 6.2 | Samuel DESPERTADO (tecla Ñ): pasivas y moveset |
| 7 | Partida a stocks y fases |
| 8 / 8.1 / 8.2 / 8.3 | Final Smash, Modo Despertar y su cinemática, Batalla de Gallos definitiva, impact frames |
| 9 | Cámara y Special Zoom |
| 10 | Escenario y fondo lejano |
| 11 | Sprites: atlas, anatomía, brazos por capas, poses por fotogramas clave |
| 12 | HUD y efectos |
| 13 | Servidor |
| 14 | Audio |

Al cambiar un sistema, actualiza su sección de `docs/diseno.md` (y aquí solo si cambia una regla o un número de los de arriba).
