# IA-Dinosaurio 🦖

Bot que juega solo al dinosaurio de Chrome (T-Rex Runner) en el navegador. Mira la pantalla del juego (lee los píxeles del canvas) y presiona las teclas, igual que una persona.

## Cómo usarlo

1. Abre https://chromedino.com/embed/ en Chrome.
2. Abre la consola: `Ctrl + Shift + J` (en Mac: `Cmd + Option + J`).
3. Pega el contenido de `dino-bot.js` y presiona Enter.
4. El bot inicia el juego solo y se reinicia cuando choca.

En pantalla aparece un recuadro verde con lo que ve el bot: distancia al próximo cactus, pájaros, estado del dino (suelo / saltando / cayendo / agachado) y el plan de salto.

### Comandos en la consola

| Comando | Qué hace |
|---|---|
| `dinoBot.stop()` / `dinoBot.start()` | Apagar / encender |
| `dinoBot.stats()` | Partidas, promedio, mejor partida |
| `dinoBot.caja()` | Muestra la "caja negra" del último choque |
| `dinoBot.cfg` | Ajustes (por ejemplo `dinoBot.cfg.jumpTime = 180`) |

## Cómo funciona

- **Visión:** revisa dos franjas de la imagen: una justo sobre el suelo (cactus y pájaros bajos) y otra a media altura (pájaros que hay que esquivar agachándose). Agrupa los píxeles en obstáculos y mide dónde empieza y termina cada uno.
- **Velocidad:** mide cuánto se mueven los obstáculos en una ventana de ~120 ms. Tiene un tope de 0,8 px/ms, porque el juego no va más rápido que eso.
- **Plan:** mira el obstáculo de al frente y el siguiente:
  - si alcanza a aterrizar entre los dos → salta, cae rápido y vuelve a saltar;
  - si no alcanza, pero caben en un solo salto → **combo**, un salto largo que pasa los dos.
- **Caída rápida:** apenas la cola del dino pasa el obstáculo, mantiene apretada la flecha abajo. La suelta cuando ve al dino agachado, que es justo cuando toca el suelo, y en ese mismo cuadro puede volver a saltar.
- **Pájaros a media altura:** se agacha hasta que el pájaro termina de pasar.
- **Caja negra:** cuando choca, muestra en la consola qué vio y qué decidió en el último segundo y medio.

## Simulador

`simulador/sim.js` reproduce el juego con física aproximada de Chromium, incluidos los cuadros irregulares de un PC real, para probar cambios del bot sin abrir el navegador:

```bash
node simulador/sim.js dino-bot.js 6 21 160
# bot, número de partidas, semilla, segundos máximos por partida
```

Con `LOG=1` muestra la caja negra de cada choque, y con `DETALLE=1` el detalle de cada partida.

## Historia

El bot se mejoró en 14 versiones, analizando videos de los choques y luego con el simulador y la caja negra. La versión final superó los 1.300 puntos en el juego real y no chocó ni una vez en 30 partidas simuladas a velocidad máxima.

> Proyecto hecho para aprender. Es para el dinosaurio de Chrome, que no tiene premios ni rankings.
