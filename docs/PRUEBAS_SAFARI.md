# JARVIS 4.0 · Despliegue y pruebas en Safari (iPhone)

## 1. Requisito clave: HTTPS

Safari en iOS **solo permite micrófono y cámara en páginas seguras (`https://`)**. Si abres `http://192.168.x.x:8787` desde el iPhone, JARVIS cargará, pero la cámara, la grabación y, a menudo, el reconocimiento de voz no estarán disponibles. Tienes tres opciones:

### Opción A: desplegar en Render (recomendada, gratuita)
1. En https://render.com (se puede hacer desde Safari en el iPhone) → **Sign in with GitHub** → **New → Blueprint** → repositorio `JARVIS-4-Interfaz`, rama `claude/jarvis-4-iphone-dev-yit5er` (o `main` tras aprobar la PR; cambia también `branch:` en `render.yaml`). Render lee `render.yaml`.
2. Cuando lo pida, introduce en el panel (no en el código):
   - `OPENAI_API_KEY` = tu clave de OpenAI.
   - `JARVIS_ACCESS_CODE` = una palabra secreta que inventes, por ejemplo `stark-2026`.
3. Espera a que el estado sea **Live**. Abre `https://<tu-app>.onrender.com/api/health`: debe mostrar `"chat":true`.
4. Nota: en el plan gratuito, el servidor se duerme tras 15 minutos sin uso y la primera petición tarda unos 30-50 segundos.

### Opción B: Docker en cualquier servidor con HTTPS
```bash
docker build -t jarvis4 .
docker run -d -p 8787:8787 --env-file .env jarvis4
```
Ponlo detrás de un proxy con HTTPS (Caddy, Nginx, Cloudflare) y usa `TRUST_PROXY=1`.

### Opción C: prueba local con un túnel HTTPS temporal
```bash
npm start
# en otra terminal (crea una URL https pública temporal):
npx cloudflared tunnel --url http://localhost:8787
```
Usa siempre `JARVIS_ACCESS_CODE` cuando la URL sea pública.

> **Nota sobre los certificados autofirmados** (`HTTPS_CERT`/`HTTPS_KEY`): están soportados, pero iOS los rechaza salvo que instales y confíes el certificado en Ajustes › General › Información › Confianza de certificados. Usa A o C.

## 2. Pasos exactos para probar en el iPhone

1. **Ajustes del iPhone** → Siri → activa **Siri** y **Dictado** en Ajustes › General › Teclado. Sin ellos, Safari no ofrece reconocimiento de voz nativo.
2. Abre la URL `https://…` en **Safari**.
3. Si configuraste un código: toca **⚙ AJUSTES** → escribe el código. El diagnóstico debe decir *Servidor: conectado* y *IA: openai · gpt-4o-mini*.
4. **Voz de salida:** toca **🔊 PROBAR VOZ**. Con OpenAI configurado oirás la voz natural (*onyx*); si no, la mejor voz española del iPhone.
   - Si no oyes nada, revisa el **interruptor de silencio** y el volumen.
   - Para una voz del iPhone mejor: Ajustes › Accesibilidad › Contenido leído › Voces › Español → descarga una voz «Mejorada» o «Premium» y elígela en ⚙ AJUSTES › Voz del iPhone.
5. **Voz de entrada:** toca **🎙 HABLAR**, acepta el permiso del micrófono y di: «¿Qué hora es?». La frase aparece en la consola y JARVIS responde en voz alta.
   - Si Safari falla, JARVIS cambia solo a **grabar y transcribir** en el servidor la próxima vez. También puedes forzarlo en ⚙ AJUSTES › Entrada de voz.
6. **Conversación con IA:** pregunta «Explícame en dos frases qué es un agujero negro».
7. **Cámara:** toca **📷 CÁMARA**, acepta el permiso, apunta a un objeto, escribe la pregunta si quieres y pulsa **◉ ANALIZAR**. Prueba también **⟲ GIRAR** y **🖼 SUBIR FOTO**.
8. **Memoria:** di o escribe «Recuerda que mi color favorito es el azul». Después pregunta «¿Cuál es mi color favorito?». Abre **🧠 MEMORIA** para verlo, borrarlo o exportarlo. Cierra Safari, vuelve a abrirlo y comprueba que el recuerdo sigue ahí.
9. **Privacidad:** en 🧠 MEMORIA desactiva «Compartir recuerdos con la IA» y repite la pregunta: la IA ya no lo sabrá. Usa «BORRAR TODO» para eliminarlo todo.
10. **Instalar como app:** botón Compartir → **Añadir a pantalla de inicio**. Ábrela desde el icono y repite los pasos 4-8.

## 3. Limitaciones conocidas de Safari / iOS

| Función | Limitación | Cómo lo resuelve JARVIS |
|---|---|---|
| Reconocimiento de voz nativo | Requiere Siri y Dictado. En algunas versiones de iOS falla o termina sin transcribir, sobre todo en la app instalada en la pantalla de inicio. No hay modo continuo fiable ni palabra de activación («Oye JARVIS»). | Aviso «Te escucho» antes de escuchar (mitigación de la versión 4.0.2), cambio automático a grabación y transcripción en el servidor, y dictado del teclado como último recurso. |
| Escucha | iOS solo deja empezar a escuchar tras un toque del usuario; no puede escuchar en segundo plano ni con la pantalla bloqueada. | Se pulsa 🎙 cada vez. La escucha se detiene al salir de la app. |
| Audio | Safari bloquea el audio que no surge de un toque. El interruptor de silencio puede silenciar la voz. | Desbloqueo del audio en el primer toque, `audioSession = playback` en iOS 17 o posterior. |
| Voces del iPhone | La lista de voces se carga de forma asíncrona y varía según el dispositivo. Las voces de calidad «Mejorada» hay que descargarlas. | Selección automática de la mejor voz española y selector manual en Ajustes. |
| Cámara/micrófono | Solo con HTTPS. Safari puede volver a pedir permiso en cada visita. | Para que no lo pregunte: aA › Ajustes del sitio web › Cámara/Micrófono › Permitir. |
| Memoria | `localStorage` puede borrarse si no usas la web durante unos 7 días (la app instalada en la pantalla de inicio está mejor protegida). Al borrar los datos de Safari también se borra. | Se pide almacenamiento persistente. Botón ⇩ EXPORTAR para tener una copia de seguridad. |
| Fotos HEIC | Algunas fotos antiguas en HEIC pueden no decodificarse. | Al elegir fotos, Safari suele convertirlas a JPEG. Si no, aparece un mensaje de error. |
| Voz natural / transcripción | Necesitan `OPENAI_API_KEY` (con solo Claude, el chat y la visión funcionan, pero la voz es la del iPhone). | Respaldo automático a la voz del dispositivo. |

## 4. Variables de entorno

Consulta `.env.example` y [PROVEEDORES_GRATIS.md](PROVEEDORES_GRATIS.md). Las mínimas para usarlo gratis: `GITHUB_MODELS_TOKEN` y `JARVIS_ACCESS_CODE` (`FREE_ONLY` está activado por defecto).

## 5. Verificar la IA real

```bash
npm run check
```
Hace un chat y una síntesis de voz cortos con tu clave y muestra ✅/❌.



## 6. Lista de pruebas reales

Usa [CHECKLIST_PRUEBAS_REALES.md](CHECKLIST_PRUEBAS_REALES.md) y envíame los resultados.
