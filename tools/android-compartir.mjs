// Se ejecuta en el CI después de "npx cap add android" (la carpeta android/ se genera ahí).
// 1) MainActivity acepta imágenes compartidas (ACTION_SEND image/*).
// 2) Si la app ya estaba abierta, el nuevo intent reemplaza al anterior para que send-intent lo lea.
import { globSync, readFileSync, writeFileSync } from 'node:fs';

const man = 'android/app/src/main/AndroidManifest.xml';
let xml = readFileSync(man, 'utf8');
if (!xml.includes('android.intent.action.SEND')) {
  const filtro = `
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="image/*" />
            </intent-filter>
`;
  const i = xml.indexOf('</activity>', xml.indexOf('.MainActivity'));
  if (i < 0) throw new Error('No se encontró MainActivity en el manifest');
  xml = xml.slice(0, i) + filtro.trimStart().replace(/^/, '    ') + '        ' + xml.slice(i);
  writeFileSync(man, xml);
}

const [act] = globSync('android/app/src/main/java/**/MainActivity.java');
if (!act) throw new Error('No se encontró MainActivity.java');
let java = readFileSync(act, 'utf8');
if (!java.includes('onNewIntent')) {
  java = java.replace(/public class MainActivity extends BridgeActivity\s*\{\s*\}/, `public class MainActivity extends BridgeActivity {
    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
    }
}`);
  if (!java.includes('onNewIntent')) throw new Error('No se pudo modificar MainActivity.java');
  writeFileSync(act, java);
}
console.log(xml.match(/<activity[\s\S]*?<\/activity>/)[0]);
console.log(java);
