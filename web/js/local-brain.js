// Cerebro local de JARVIS: respuestas sin servidor ni IA (modo sin conexión).
// Módulo puro: se usa en el navegador y también en el servidor como respaldo.

export function localReply(q, { now = new Date(), memories = [] } = {}) {
  const t = String(q || '').toLocaleLowerCase('es');
  if (/viernes/.test(t)) return 'VIERNES será mi compañera de sistema. Todavía está en desarrollo y sigue fuera de mi alcance por ahora.';
  if (/^(hola|buenos|buenas|saludos)/.test(t) || /\bhola\b/.test(t)) return 'Saludos. JARVIS 4.0 operativo. ¿En qué puedo ayudarte?';
  if (/quién eres|quien eres|tu nombre|cómo te llamas|como te llamas/.test(t)) return 'Soy JARVIS 4.0, tu asistente digital. Ahora mismo funciono en modo local, sin conexión con mi núcleo de inteligencia artificial.';
  if (/qué hora|que hora|\bhora\b/.test(t)) return 'Son las ' + now.toLocaleTimeString('es', { hour: 'numeric', minute: '2-digit' }) + '.';
  if (/fecha|qué día|que dia|día es|dia es/.test(t)) return 'Hoy es ' + now.toLocaleDateString('es', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) + '.';
  if (/gracias/.test(t)) return 'Para servirte. Sin embargo, todavía no cobro horas extras.';
  if (/qué sabes de mí|que sabes de mi|qué recuerdas|que recuerdas/.test(t)) {
    if (!memories.length) return 'No tengo recuerdos guardados sobre ti todavía.';
    return 'Esto es lo que recuerdo: ' + memories.map(m => m.text).join('; ') + '.';
  }
  if (/voz|habla|sonido/.test(t)) return 'Mi sistema de voz está activo. Puedes escucharme con el botón Probar voz.';
  return 'Estoy en modo local, sin conexión con mi núcleo de inteligencia artificial, así que solo puedo responder a lo básico: la hora, la fecha o lo que recuerdo. Comprueba la conexión con el servidor en Ajustes.';
}
