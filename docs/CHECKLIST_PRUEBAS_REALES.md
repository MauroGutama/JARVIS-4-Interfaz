# JARVIS 4.0 · Lista de pruebas reales (iPhone + Safari)

Anota ✅ / ❌ y, si falla, el mensaje que aparece bajo los botones (o en ⚙ AJUSTES › diagnóstico).
Modelo de iPhone: ______ · Versión de iOS: ______ · URL: https://______.onrender.com

## 0. Servidor
- [ ] `https://<tu-app>.onrender.com/api/health` muestra `"chat":true,"tts":true,"stt":true,"requiresCode":true`
- [ ] ⚙ AJUSTES › código introducido → diagnóstico: «Servidor: conectado», «Contexto seguro (HTTPS): sí»

## 1. Conexión con IA
- [ ] Escribir «Explícame en dos frases qué es un agujero negro» → respuesta coherente (no «modo local»)
- [ ] Insignia superior derecha de la consola muestra «IA · GPT-4O-MINI»

## 2. Voz de salida
- [ ] 🔊 PROBAR VOZ con el interruptor de silencio APAGADO → voz natural (masculina, fluida)
- [ ] ⚙ Voz de JARVIS = «Voz del iPhone» → suena la voz del dispositivo
- [ ] ■ SILENCIO corta la voz al instante

## 3. Voz de entrada
- [ ] Entrada «Automática»: 🎙 HABLAR → «Te escucho» → decir «¿Qué hora es?» → aparece y responde
- [ ] Entrada «Grabar y transcribir»: 🎙 → hablar → se detiene solo tras ~1,5 s de silencio → responde
- [ ] Entrada «Dictado del teclado»: se abre el teclado; dictar con 🎙 del teclado funciona
- [ ] Lo mismo desde la app instalada en pantalla de inicio

## 4. Cámara
- [ ] 📷 CÁMARA → permiso → vista trasera en vivo
- [ ] ⟲ GIRAR cambia a cámara frontal
- [ ] ◉ ANALIZAR sobre un objeto → descripción correcta
- [ ] 🖼 SUBIR FOTO desde la galería → descripción correcta

## 5. Memoria y privacidad
- [ ] «Recuerda que mi color favorito es el azul» → confirmación
- [ ] «¿Cuál es mi color favorito?» → responde azul
- [ ] Cerrar Safari por completo, reabrir → recuerdo e historial siguen
- [ ] 🧠 MEMORIA › desactivar «Compartir recuerdos con la IA» → la IA ya no lo sabe
- [ ] ⇩ EXPORTAR descarga `jarvis-memoria.json`
- [ ] BORRAR TODO → memoria vacía

## 6. Rendimiento
- [ ] Animaciones fluidas; sin calentamiento notable en 5 minutos
- [ ] ⚙ Modo ahorro reduce efectos
