// Funciones del celular (Android) que no existen en el navegador.
// Se empaqueta con esbuild (npm run build) y genera nativo.js.
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export const esNativo = () => Capacitor.isNativePlatform();

// Guarda el texto en un archivo y abre "Compartir" (Drive, WhatsApp, correo, Archivos…).
export async function compartirArchivo(nombre, texto) {
  const { uri } = await Filesystem.writeFile({ path: nombre, data: texto, directory: Directory.Cache, encoding: Encoding.UTF8 });
  await Share.share({ title: nombre, files: [uri], dialogTitle: 'Guardar copia de seguridad' });
}
