// Conexión con Firebase (Auth + Firestore). Este archivo se empaqueta con
// esbuild en la compilación (npm run build) y genera firebase-backend.js.
// Los datos de cada persona viven en users/{uid}/... y se guardan también
// en el dispositivo, así la app funciona sin internet y sincroniza después.
import { initializeApp } from 'firebase/app';
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence,
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail,
} from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc,
} from 'firebase/firestore';

export function createFirebaseBackend(config) {
  const app = initializeApp(config);
  const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  let fs;
  try {
    fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch {
    fs = initializeFirestore(app, {});
  }

  let user = null;
  const pending = new Map(); // colección -> hay escrituras pendientes
  const statusCbs = new Set();
  const currentStatus = () => {
    if (!navigator.onLine) return 'offline';
    for (const v of pending.values()) if (v) return 'pending';
    return 'synced';
  };
  const emitStatus = () => statusCbs.forEach((cb) => cb(currentStatus()));
  window.addEventListener('online', emitStatus);
  window.addEventListener('offline', emitStatus);

  const col = (name) => collection(fs, 'users', user.uid, name);
  const ref = (name, id) => doc(fs, 'users', user.uid, name, id);
  const fail = (e) => console.error('Error al guardar', e);

  return {
    mode: 'cloud',
    onAuth(cb) { return onAuthStateChanged(auth, (u) => { user = u; cb(u ? { uid: u.uid, email: u.email } : null); }); },
    signIn: (email, pass) => signInWithEmailAndPassword(auth, email, pass),
    signUp: (email, pass) => createUserWithEmailAndPassword(auth, email, pass),
    signOut: () => signOut(auth),
    resetPassword: (email) => sendPasswordResetEmail(auth, email),
    onStatus(cb) { statusCbs.add(cb); cb(currentStatus()); return () => statusCbs.delete(cb); },

    watch(name, cb) {
      return onSnapshot(col(name), { includeMetadataChanges: true }, (snap) => {
        pending.set(name, snap.metadata.hasPendingWrites);
        emitStatus();
        cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }, (e) => console.error(name, e));
    },
    watchAjustes(cb) {
      return onSnapshot(ref('ajustes', 'general'), { includeMetadataChanges: true }, (snap) => {
        cb(snap.exists() ? snap.data() : null, snap.metadata.fromCache);
      }, (e) => console.error('ajustes', e));
    },
    // Las escrituras no se esperan: con o sin internet aparecen al instante
    // y Firestore las envía a la nube cuando hay conexión.
    add(name, data) { const r = doc(col(name)); setDoc(r, data).catch(fail); return r.id; },
    set(name, id, data) { setDoc(ref(name, id), data).catch(fail); },
    update(name, id, data) { updateDoc(ref(name, id), data).catch(fail); },
    remove(name, id) { deleteDoc(ref(name, id)).catch(fail); },
    saveAjustes(data) { setDoc(ref('ajustes', 'general'), data, { merge: true }).catch(fail); },
  };
}
