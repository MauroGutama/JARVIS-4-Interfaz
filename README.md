# JARVIS 4.0 · Interfaz para iPhone

Asistente web con **voz**, **inteligencia artificial**, **cámara con análisis de imágenes**, **memoria persistente con controles de privacidad** e **interfaz holográfica**, optimizado para Safari en iPhone. Se puede instalar en la pantalla de inicio como app web (PWA).

> Los prototipos aprobados `JARVIS_4_Voz.html` y `JARVIS_4_Voz_corregido.html` se conservan sin cambios. La nueva versión vive en `web/` y mantiene el mismo diseño (núcleo azul, paleta, consola).

## Estructura

```
web/                 Interfaz (HTML/CSS/JS sin dependencias, PWA)
  app.js             Orquestador de la interfaz
  js/speech-in.js    Entrada de voz: Safari nativo → grabar y transcribir → dictado del teclado
  js/speech-out.js   Salida de voz: voz natural del servidor → voz del iPhone
  js/camera.js       Cámara en vivo + subir foto, reducción a JPEG de 1024 px
  js/memory.js       Memoria local con controles de privacidad
  js/local-brain.js  Respuestas sin conexión
server/              Servidor Node (sin dependencias): sirve web/ y protege las claves
  ai.js              Registro de proveedores: GitHub Models, Gemini, Groq, OpenRouter, OpenAI, Claude
tests/unit/          Pruebas de lógica y del servidor (IA simulada)
tests/e2e/           Pruebas en navegador real con tamaño de iPhone (Playwright)
docs/PRUEBAS_SAFARI.md  Despliegue, pruebas paso a paso y limitaciones de iOS
```

## Arranque rápido

Requiere Node 20 o superior.

```bash
cp .env.example .env        # pon tu clave en .env (nunca la subas a GitHub)
npm run check               # verifica la conexión real con la IA
npm start                   # http://localhost:8787
```

Sin clave, JARVIS funciona en **modo básico** (hora, fecha, memoria y comandos locales).

### Proveedores de IA (v4.2)
Elige el proveedor en ⚙ AJUSTES › Cerebro de IA: **GitHub Models** (gratis, 13+), Gemini, Groq u OpenRouter (gratis, 18+), OpenAI o Claude (de pago, desactivados por defecto) o **Básico (sin API)**. La protección `FREE_ONLY` está activada por defecto. Consulta [docs/PROVEEDORES_GRATIS.md](docs/PROVEEDORES_GRATIS.md).

## Pruebas

```bash
npm test            # 39 pruebas unitarias y del servidor
npm run test:e2e    # 11 pruebas en navegador (requiere Playwright + Chromium)
```

## Probar en el iPhone

Safari solo permite micrófono y cámara en **HTTPS**. Consulta [docs/PRUEBAS_SAFARI.md](docs/PRUEBAS_SAFARI.md) para desplegar (Render o Docker) y para los pasos exactos de prueba.

## Seguridad y privacidad

- Las claves de IA solo existen en las variables de entorno del servidor; el navegador nunca las ve.
- Protección contra cargos: solo proveedores gratuitos salvo `FREE_ONLY=0`, modelos `:free` obligatorios en OpenRouter y tope diario.
- `JARVIS_ACCESS_CODE` impide que otras personas usen tu servidor (y tu saldo de IA).
- Hay un límite de peticiones por minuto, cabeceras de seguridad (CSP) y validación de entradas.
- La memoria y el historial se guardan **solo en el iPhone**. Se pueden ver, exportar y borrar, y se puede desactivar que se compartan con la IA.
- Las fotos no se guardan: se envían solo al pulsar ANALIZAR.
