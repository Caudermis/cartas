# Cartas multijugador (2 a 4 jugadores)

Servidor Node sin dependencias. Las reglas se validan en el servidor y cada jugador solo recibe las cartas que tiene derecho a ver.

## Probarlo en tu ordenador
1. Instala Node 18 o superior (https://nodejs.org).
2. En esta carpeta: `node server.js`
3. Abre http://localhost:3000, crea una sala y entra desde otras pestañas o dispositivos de tu red.

## Subirlo a Render (gratis)
1. Crea una cuenta en https://github.com y un repositorio nuevo (por ejemplo `cartas`).
2. En la página del repositorio: **Add file → Upload files**. Arrastra el CONTENIDO de esta carpeta
   (`server.js`, `rules.js`, `package.json`, `render.yaml`, la carpeta `public`, etc.) y pulsa **Commit changes**.
3. Crea una cuenta en https://render.com (puedes entrar con GitHub).
4. **New → Web Service** y elige tu repositorio. Si te lo pide:
   - Runtime / Language: **Node**
   - Build Command: `echo ok`
   - Start Command: `node server.js`
   - Instance Type: **Free**
5. Pulsa **Create Web Service**. En unos minutos tendrás una dirección `https://algo.onrender.com`.
6. Ábrela, escribe tu nombre, crea la sala y comparte el enlace (o el código de 5 letras) con tus amigos.

### Limitaciones del plan gratuito
- Se duerme tras 15 minutos sin tráfico y tarda alrededor de un minuto en despertar.
- El disco es temporal: las partidas guardadas se pierden si el servicio se duerme o reinicia. Mientras haya jugadores conectados todo se conserva y recargar la página no pierde la partida.

## Ajustar reglas
Al principio de `rules.js` está `CFG`:
- `CLOSE_RULE`: `'lastTurn'` (al plantarse el primero, cada rival juega un último turno) o `'allPlanted'` (solo cierra cuando todos estén plantados).
- `ABILITY_QD`: si el 11/12 usado abre descarte rápido.
- `QD_ON_REPLACE`: si la carta cambiada por sustitución abre descarte rápido.
- `QD_MS`: duración de la ventana de descarte rápido (milisegundos).

## Pruebas
`node test.js` arranca el servidor y juega partidas completas de 2, 3 y 4 jugadores simulados comprobando reglas, privacidad, reconexión y persistencia.

## Cómo funciona la privacidad
- Las manos viajan siempre como huecos vacíos (`null`), también las propias, hasta que termina la ronda.
- Una carta solo llega a quien la mira (mirar al inicio, habilidad del 11, habilidad del 12), en la respuesta de esa acción.
- El mazo nunca se envía. Los intentos de descarte rápido se ordenan en el servidor y gana el primero válido.
