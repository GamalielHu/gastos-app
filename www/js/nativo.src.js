// Funciones del celular (Android) que no existen en el navegador.
// Se empaqueta con esbuild (npm run build) y genera nativo.js.
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { SendIntent } from 'send-intent';

export const esNativo = () => Capacitor.isNativePlatform();

// Guarda el texto en un archivo y abre "Compartir" (Drive, WhatsApp, correo, Archivos…).
export async function compartirArchivo(nombre, texto) {
  const { uri } = await Filesystem.writeFile({ path: nombre, data: texto, directory: Directory.Cache, encoding: Encoding.UTF8 });
  await Share.share({ title: nombre, files: [uri], dialogTitle: 'Guardar copia de seguridad' });
}

// Imagen compartida desde otra app (galería, app del banco) con "Compartir → Cuentas Claras".
// Devuelve un Blob o null. La copia temporal se borra para no procesarla dos veces.
export async function imagenCompartida() {
  if (!Capacitor.isNativePlatform()) return null;
  let r;
  try { r = await SendIntent.checkSendIntentReceived(); } catch { return null; }
  if (!r?.url || !String(r.type || '').startsWith('image/')) return null;
  const ruta = decodeURIComponent(r.url);
  try {
    const res = await fetch(Capacitor.convertFileSrc(ruta));
    if (!res.ok) return null;
    return await res.blob();
  } catch { return null; }
  finally { Filesystem.deleteFile({ path: ruta }).catch(() => {}); }
}
