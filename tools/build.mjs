// Copia www/ a dist/ y empaqueta la conexión con Firebase.
// dist/ es lo que se publica en la web (iPad) y lo que va dentro del APK (Android).
import { build } from 'esbuild';
import { gunzipSync } from 'node:zlib';
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
cpSync('www', 'dist', { recursive: true });
rmSync('dist/js/firebase-backend.src.js', { force: true });
rmSync('dist/js/xlsx-lector.src.js', { force: true });
rmSync('dist/js/nativo.src.js', { force: true });

const empaquetar = (src, out) => build({
  entryPoints: [src], bundle: true, format: 'esm', minify: true, target: 'es2020',
  outfile: out, legalComments: 'none',
});
await empaquetar('www/js/firebase-backend.src.js', 'dist/js/firebase-backend.js');
// Lector de Excel: se carga solo al importar un .xlsx.
await empaquetar('www/js/xlsx-lector.src.js', 'dist/js/xlsx-lector.js');
// Guardar y compartir archivos en Android (copia de seguridad).
await empaquetar('www/js/nativo.src.js', 'dist/js/nativo.js');

// OCR de comprobantes sin internet: tesseract.js + núcleo wasm + idioma español.
const T = 'dist/vendor/tesseract';
mkdirSync(`${T}/lang`, { recursive: true });
for (const f of ['tesseract.esm.min.js', 'worker.min.js']) cpSync(`node_modules/tesseract.js/dist/${f}`, `${T}/${f}`);
for (const f of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js']) cpSync(`node_modules/tesseract.js-core/${f}`, `${T}/${f}`);
// Sin comprimir: Android (aapt) descomprime los .gz de assets y les quita la extensión.
writeFileSync(`${T}/lang/spa.traineddata`, gunzipSync(readFileSync('node_modules/@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz')));

const sw = readFileSync('dist/sw.js', 'utf8').replace('__BUILD__', Date.now().toString(36));
writeFileSync('dist/sw.js', sw);
console.log('Listo: dist/');
