# Cartas Contra la Humanidad: Edición Criolla Sin Filtro

El juego de cartas irreverente con sabor a Venezuela y Sudamérica. Crea una sala, comparte el código por WhatsApp y que tus amigos se arrepientan de haber aceptado la invitación.

> **+18. Humor negro, política, religión, sexo, corrupción y malas decisiones.**  
> Es un fan game no oficial y sin fines de lucro. Si algo te ofende, probablemente el juego está haciendo su trabajo.

---

## Lo que trae

- Salas privadas de **3 a 12 jugadores** con código de 5 caracteres y link para compartir.
- El flujo clásico de *Cards Against Humanity*: mano de 10 cartas blancas, juez rotativo, respuestas anónimas, un punto por ronda y primera persona en llegar a la meta.
- **Cartas negras con uno o dos huecos**: si la pregunta pide dos respuestas, eliges dos.
- **608 cartas originales**: 203 negras y 405 blancas. El mazo fue depurado: fuera las cartas de nevera, adentro corrupción, religión, herencias, sexo adulto, crimen, funerales, traiciones y humor bastante más ácido. También incluye modismos de oriente y Maracaibo: naguará, qué molleja, vai, cobres, enenante, purito, hecho molleja, primo y compañía.
- **Mazo personalizado**: el anfitrión puede pegar sus propias cartas negras y blancas, elegir jugar solo con ellas o mezclarlas con el mazo de la casa, y reutilizar el último mazo guardado en el navegador.
- **Texto adaptativo**: las cartas y el chat aumentan de tamaño automáticamente en celulares y pantallas táctiles; en escritorio se mantiene una lectura cómoda.
- **Chat de sala** para el bochinche, la conspiración y el “yo no fui”.
- **Reconexión automática**: si se cae el wifi o recargas la página, vuelves a tu puesto y a tu mano.
- **Herramientas de anfitrión**: expulsar en el lobby, cerrar una votación trancada, reasignar juez, volver al lobby o armar revancha.
- **Compartir por WhatsApp**, copiar código y copiar link. El link de sala es un deep link (`?sala=CODIGO`).
- Diseño responsive: se juega cómodo desde teléfono, tablet o laptop.
- Confeti, mala leche y un sol con cara de arepa.

---

## Requisitos

- **Node.js 18 o superior** (recomendado Node 20+).
- Navegador moderno con JavaScript.
- Para jugar en red local: todos en la misma wifi.
- Para jugar a distancia: despliega el juego o usa un túnel (abajo lo explico).

---

## Arrancar en tu compu (Windows / macOS / Linux)

```bash
cd cartas-criollas
npm install
npm start
```

Abre `http://localhost:3000` en el navegador.

Al arrancar, la consola imprime algo así:

```text
Local:  http://localhost:3000
Red:    http://192.168.1.42:3000
```

Ese segundo link es el que tienes que pasarle a tus amigos si están en tu misma wifi. Si Windows pregunta por el Firewall, permite el acceso a Node.js en redes privadas.

### Crear la sala

1. Escribe tu nombre y confirma que tienes 18+.
2. Pulsa **Crear sala**.
3. El código grande de la sala (por ejemplo `6KHAX`) es lo que comparten.
4. Tus amigos abren el link, escriben su nombre y entran.
5. Cuando estén todos, el anfitrión pulsa **Comenzar la fiesta**.

Cada ronda:

1. Un jugador es el **juez**.
2. El juez lee la carta negra.
3. Los demás eligen una respuesta (o dos si la carta lo pide) y la mandan en secreto.
4. El juez ve las jugadas sin saber de quién son y elige la que más le arruina la vida.
5. El ganador suma un punto. La primera persona en llegar a la meta gana la partida.

### Crear tu propio mazo

En el lobby, el anfitrión tiene un bloque llamado **Mazo de la mesa**:

1. Pulsa **Crear mi mazo**.
2. Pega una carta por línea en las cajas de cartas blancas y negras.
3. En las cartas negras usa `_` para cada hueco. Puedes usar uno o dos.
4. Elige **Mezclar con la casa** o **Solo mi mazo**.
5. Guarda el mazo. Se activa en esa sala y queda guardado en el navegador para la próxima.

El modo **Solo mi mazo** exige al menos 10 cartas blancas por jugador y una negra. Si faltan, el botón de comenzar se bloquea y te dice cuántas faltan. El editor permite máximo 300 blancas y 200 negras; cada carta hasta 180 caracteres.

El mazo oficial evita racismo, xenofobia y burlas a víctimas reales. El editor es tuyo: lo que cargues y compartas corre por tu cuenta.

---

## Jugar con amigos que no están en tu wifi

Hay dos caminos: el rápido y el definitivo.

### Opción rápida: túnel temporal

Si tienes `cloudflared` instalado:

```bash
npm start
# En otra terminal:
cloudflared tunnel --url http://localhost:3000
```

Cloudflare te da un link público tipo `https://algo-random.trycloudflare.com`. Comparte ese link. Es temporal: cuando cierras el túnel, se cae.

En esta copia local, el ejecutable quedó descargado en `tools\cloudflared.exe`, así que también puedes lanzarlo directo desde PowerShell:

```powershell
.\tools\cloudflared.exe tunnel --url http://localhost:3000 --no-autoupdate
```

También puedes usar:

```bash
npx localtunnel --port 3000
```

Localtunnel a veces pide una contraseña o muestra una pantalla intermedia; funciona, pero es menos estable. Para una noche de juego, Cloudflare Quick Tunnel suele portarse mejor.

### Opción recomendada: desplegar en Render

El proyecto ya trae `render.yaml` para desplegarlo como Web Service.

1. Sube la carpeta a un repositorio de GitHub. Por ejemplo:

   ```bash
   git init
   git add .
   git commit -m "Cartas Criollas"
   git branch -M main
   git remote add origin https://github.com/TU-USUARIO/cartas-criollas.git
   git push -u origin main
   ```

2. Entra a [render.com](https://render.com), crea una cuenta y elige **New > Blueprint** (o **New Web Service** si prefieres hacerlo a mano).
3. Conecta el repo. Render detecta `render.yaml` y usa:
   - Build: `npm ci`
   - Start: `npm start`
   - Health check: `/health`
4. Cuando termine el deploy, Render te da una URL pública (`https://cartas-criollas.onrender.com` o similar). Esa es la que compartes. Socket.IO funciona sin configuración extra.
5. El plan gratuito de Render duerme el servicio tras un rato sin uso. Abre el link unos minutos antes de jugar para despertarlo.

También sirve en Railway, Fly.io, Koyeb, un VPS o cualquier hosting de Node con WebSockets. Con Docker:

```bash
docker build -t cartas-criollas .
docker run -p 3000:3000 cartas-criollas
```

---

## Cómo probar

```bash
npm test
```

Las pruebas cubren:

- Flujo completo de una ronda y rotación del juez.
- Validación de manos, permisos y cartas de dos huecos.
- Reconexión con token.
- Reasignación de juez y cierre forzado de votación.
- Final de partida, revancha y vuelta al lobby.
- Salas, unión, chat, expulsión y bloqueo de entrada cuando la partida ya comenzó, probados por sockets reales.

Para desarrollo con recarga automática:

```bash
npm run dev
```

---

## Estructura

```text
cartas-criollas/
├── server.js              # Express + Socket.IO, eventos de red
├── src/
│   ├── cards.js           # Las 608 cartas del mazo Sin Filtro
│   └── room.js            # Estado de salas, reglas y validaciones
├── public/
│   ├── index.html         # Landing, lobby, mesa y modales
│   ├── styles.css         # Diseño responsive
│   ├── app.js             # Cliente en JavaScript puro
│   └── favicon.svg
├── test/
│   ├── room.test.js
│   └── socket.test.js
├── render.yaml
├── Dockerfile
└── package.json
```

El servidor guarda las salas **en memoria**. Si reinicias el proceso, las partidas desaparecen. Para una noche de juego no hace falta base de datos; para un servicio permanente, habría que añadir persistencia.

Los tokens de reconexión se guardan en `localStorage`. Si borras los datos del navegador o abres el juego en modo incógnito, pierdes la sesión de esa sala.

---

## Apagar incendios

**Mis amigos no pueden entrar desde otra casa.**  
Estás compartiendo un link `localhost` o una IP privada. Usa Render, un túnel o abre el juego desde el link de red que imprime la consola y asegúrate de estar todos en la misma wifi.

**El link de red no funciona.**  
Puede ser el Firewall de Windows, una red de invitados que aísla dispositivos, o que estás usando una VPN. Prueba con el link público de Render/túnel.

**El puerto 3000 está ocupado.**

```powershell
$env:PORT=3100
npm start
```

En macOS/Linux:

```bash
PORT=3100 npm start
```

**Se desconectó alguien justo cuando era juez.**  
El anfitrión puede abrir el menú y usar **Reasignar juez**. Si solo falta una jugada, también puede **Cerrar la votación**. Así el juego no se queda trancado.

**La sala desapareció.**  
El servidor se reinició o el hosting gratuito se durmió. Vuelvan a crear la sala. Es el precio de no tener base de datos y de jugar gratis.

**No cargan las fuentes.**  
El juego usa Google Fonts. Sin internet usa fuentes del sistema; se ve menos bonito, pero funciona.

---

## Créditos y advertencia legal

- **Fan game no oficial** inspirado por *Cards Against Humanity*, creado por Cards Against Humanity, LLC. No está afiliado, patrocinado ni respaldado por ellos.
- El texto de las cartas de esta edición es original. No se reutilizan las cartas de la edición oficial.
- Ningún político, pastor, suegra, ex pareja ni vecino real fue consultado para este mazo.
- El código se publica bajo licencia MIT. Las cartas y el contenido satírico se comparten bajo **CC BY-NC-SA 4.0** para uso no comercial, con atribución.
- Si vas a usar esto comercialmente, primero revisa las marcas y derechos correspondientes. Y, sobre todo, consulta con un abogado; nosotros solo sabemos de arepas.

Hecho con harina PAN, mala leche y un poquito de odio.
