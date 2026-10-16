// Copia www/ a dist/ y empaqueta la conexión con Firebase.
// dist/ es lo que se publica en la web (iPad) y lo que va dentro del APK (Android).
import { build } from 'esbuild';
import { cpSync, rmSync, readFileSync, writeFileSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
cpSync('www', 'dist', { recursive: true });
rmSync('dist/js/firebase-backend.src.js', { force: true });

await build({
  entryPoints: ['www/js/firebase-backend.src.js'],
  bundle: true, format: 'esm', minify: true, target: 'es2020',
  outfile: 'dist/js/firebase-backend.js', legalComments: 'none',
});

const sw = readFileSync('dist/sw.js', 'utf8').replace('__BUILD__', Date.now().toString(36));
writeFileSync('dist/sw.js', sw);
console.log('Listo: dist/');
