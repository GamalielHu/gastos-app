# Cuentas Claras

Registro de gastos e ingresos por cuenta (efectivo, bancos, billeteras) y, si quieres, por proyecto de obra. Los gastos de cada obra también cuentan en el total general. Tiene gráfico de torta que se actualiza solo.

- **Android:** descarga `CuentasClaras.apk` desde [la última versión](../../releases/latest) y ábrelo para instalar.
- **iPad:** abre la página de la app en Safari → Compartir → **Añadir a pantalla de inicio**.
- **Sincronización:** entra con el mismo correo y contraseña en los dos dispositivos. Funciona sin internet y se sincroniza al reconectar.

## Cómo se compila

Cada cambio que se sube a `main` ejecuta `.github/workflows/build.yml`, que:

1. Copia `www/` a `dist/` y empaqueta la conexión con Firebase (`npm run build`).
2. Publica `dist/` en GitHub Pages (versión para el iPad).
3. Envuelve `dist/` con Capacitor y genera el APK, que queda en *Releases*.

## Firebase

- Pega tu `firebaseConfig` en `www/js/firebase-config.js`.
- En Firebase → Authentication activa **Correo electrónico/contraseña**.
- En Firestore → Reglas pega el contenido de `firestore.rules`.

Sin configuración, la app funciona igual pero guarda los datos solo en el dispositivo.

## Estructura de datos (Firestore)

`users/{uid}/cuentas`, `users/{uid}/proyectos`, `users/{uid}/movimientos`, `users/{uid}/ajustes/general`.

Un movimiento: `tipo` (gasto, ingreso, transferencia), `monto`, `fecha` (AAAA-MM-DD), `cuentaId`, `cuentaDestinoId` (transferencias), `proyectoId` (opcional), `etiqueta`, `descripcion`, `cantidad` y `unidad` (materiales).
