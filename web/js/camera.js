// Cámara: vista previa en vivo, captura reducida y alternativa con selector de fotos.
import { scaledSize } from './text.js';

export function createCamera(video) {
  let stream = null;
  let facing = 'environment';

  async function open() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no permite usar la cámara en vivo. Usa «Subir foto».');
    if (globalThis.isSecureContext === false) throw new Error('La cámara requiere HTTPS. Abre JARVIS desde una dirección https://.');
    close();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } } });
    } catch (e) {
      if (e?.name === 'NotAllowedError') throw new Error('Permiso de cámara denegado. Actívalo en Ajustes › Safari › Cámara (o en aA › Ajustes del sitio).');
      if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') throw new Error('No se encontró una cámara disponible.');
      throw new Error('No se pudo abrir la cámara: ' + (e?.message || e));
    }
    video.setAttribute('playsinline', ''); video.muted = true;
    video.srcObject = stream;
    await video.play().catch(() => {});
    return stream;
  }

  function close() {
    stream?.getTracks().forEach(t => t.stop());
    stream = null;
    if (video) video.srcObject = null;
  }

  async function flip() { facing = facing === 'environment' ? 'user' : 'environment'; return open(); }

  function capture(maxSide = 1024, quality = 0.8) {
    if (!stream || !video.videoWidth) throw new Error('La cámara aún no está lista.');
    return drawToJpeg(video, video.videoWidth, video.videoHeight, maxSide, quality);
  }

  return { open, close, flip, capture, get isOpen() { return Boolean(stream); } };
}

export function drawToJpeg(source, w, h, maxSide = 1024, quality = 0.8) {
  const { width, height } = scaledSize(w, h, maxSide);
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  c.getContext('2d').drawImage(source, 0, 0, width, height);
  const dataUrl = c.toDataURL('image/jpeg', quality);
  return { dataUrl, mediaType: 'image/jpeg', data: dataUrl.split(',')[1], width, height };
}

/** Convierte una foto elegida (archivo) en JPEG reducido. */
export async function fileToJpeg(file, maxSide = 1024) {
  if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('El archivo no es una imagen.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('No se pudo leer la imagen (¿formato HEIC?).')); i.src = url; });
    return drawToJpeg(img, img.naturalWidth, img.naturalHeight, maxSide);
  } finally { URL.revokeObjectURL(url); }
}
