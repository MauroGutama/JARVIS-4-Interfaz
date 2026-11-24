# JARVIS 4.2 · Proveedores de IA gratuitos

Investigación hecha en noviembre de 2026. Los límites gratuitos cambian a menudo: confírmalos en la consola de cada proveedor.

## Comparativa

| Proveedor | Edad mínima (términos) | Coste / tarjeta | Límites gratuitos aproximados | Cámara (visión) | Transcripción de voz |
|---|---|---|---|---|---|
| **GitHub Models** | **13+** (términos de GitHub) | Gratis con tu cuenta de GitHub; no pide tarjeta. Solo cobra si activas el pago por uso. | Unas 50-150 peticiones al día según el modelo, 10-15 por minuto, unos 8.000 tokens de entrada por petición | Sí (`openai/gpt-4.1-mini`) | No |
| **Google Gemini** | **18+** (términos adicionales de la API de Gemini) | Nivel gratuito sin facturación activada | Por proyecto; puede ser muy bajo (unas 20 peticiones al día en los Flash recientes). Se ve en AI Studio | Sí | No |
| **Groq** | **18+** (Groq Services Agreement) | Nivel gratuito sin tarjeta | Unas 30 por minuto y de 1.000 a 14.400 al día según el modelo | Sí (Llama 4 Scout) | **Sí, Whisper gratis** |
| **OpenRouter** | **18+** (términos de openrouter.ai) | Solo modelos `:free` | 20 por minuto y unas 50 al día. Los fallos también cuentan | No (en la configuración por defecto) | No |
| OpenAI | 13+ con permiso de los padres | **De pago** (créditos) | Ninguno | Sí | Sí |
| **Básico (sin API)** | Cualquiera | Gratis, sin internet | Ilimitado | No | Usa Safari |

**Si tienes menos de 18 años, usa GitHub Models o el modo básico.** No crees cuentas en servicios cuya edad mínima no cumples. Para el reconocimiento de voz, usa el de Safari, que es gratuito.

## Cómo evita JARVIS los cargos

1. `FREE_ONLY` está **activado por defecto**: OpenAI, Claude y la voz y la transcripción de pago se ocultan aunque haya claves configuradas. Solo se permiten con `FREE_ONLY=0`.
2. En OpenRouter se bloquea cualquier modelo que no termine en `:free`.
3. Hay un tope diario global (`DAILY_REQUEST_LIMIT`, 300 por defecto) y un límite por minuto.
4. La voz de JARVIS y el reconocimiento de voz son los de **Safari** por defecto, sin coste.
5. **No añadas nunca un método de pago** en GitHub, Google, Groq ni OpenRouter. Sin método de pago no pueden cobrarte. Si se agota la cuota, JARVIS muestra un aviso y responde con el modo básico.

## Crear el token de GitHub Models (recomendado)

1. En github.com (también desde Safari) ve a tu foto → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. Nombre: `jarvis-models`. Caducidad: 90 días.
3. En **Repository access** elige **Public repositories** (no le des acceso a tus repositorios privados).
4. En **Permissions → Account permissions → Models**, elige **Read-only**. No marques ningún otro permiso.
5. Copia el token, que empieza por `github_pat_`. **No lo pegues en el chat ni en el código.**

## Activarlo en Render (después de aprobar el despliegue)

Render → tu servicio `jarvis-4` → **Environment**:
- `GITHUB_MODELS_TOKEN` = el token.
- `FREE_ONLY` = `1` y `AI_PROVIDER` = `github`.
- (Opcional, solo si tienes 18 años o más) `GROQ_API_KEY` y/o `GEMINI_API_KEY`.
- Pulsa **Save changes**. Render se reinicia solo.

Comprueba: `https://<tu-app>.onrender.com/api/health` → `"provider":"github"`, `"freeOnly":true`.

En el iPhone: ⚙ AJUSTES → **Cerebro de IA** → elige el proveedor. «Básico (sin API)» siempre está disponible.

## Fuentes consultadas
- Términos de la API de Gemini (18+): https://ai.google.dev/gemini-api/terms-archive/terms_05_20_25
- Groq Services Agreement (18+): https://console.groq.com/docs/legal/services-agreement
- Términos de OpenRouter (18+): https://openrouter.ai/terms
- Límites de GitHub Models: https://www.freellms.org/providers/github-models
- Límites de Groq: https://benchlm.ai/free-tier/groq
- Límites de Gemini: https://www.memetik.ai/guides/gemini-api-free-tier-limits
- Límites de OpenRouter: https://www.requesty.ai/blog/openrouter-free-models
