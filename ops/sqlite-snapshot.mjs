// Snapshot consistente de una SQLite + verificacion de integridad.
// Se ejecuta DENTRO del contenedor de la app, y el script debe montarse dentro
// de /app: es desde ahi donde la imagen resuelve node_modules.
//
//   node sqlite-snapshot.mjs <origen.db> <destino.db>
//
// Por que no basta con copiar el archivo: la BD esta en WAL y la app escribe
// mientras tanto, asi que un `cp` puede capturar una transaccion a medias.
// db.backup() hace una copia transaccional consistente sin detener la app.
//
// Sale con codigo != 0 si la copia no supera integrity_check o si el WAL de
// destino quedo con contenido pendiente, para que el backup del dia quede
// marcado como fallido y no se tome por bueno.
import { statSync, rmSync, existsSync } from 'node:fs';
import Database from 'better-sqlite3';

const [, , origen, destino] = process.argv;
if (!origen || !destino) {
  console.error('uso: node sqlite-snapshot.mjs <origen.db> <destino.db>');
  process.exit(2);
}

const contar = (db, tabla) => {
  try {
    return db.prepare(`select count(*) as n from ${tabla}`).get().n;
  } catch {
    return null;
  }
};

const origenDb = new Database(origen, { readonly: true, fileMustExist: true });
try {
  await origenDb.backup(destino);
} finally {
  origenDb.close();
}

const copia = new Database(destino, { readonly: true, fileMustExist: true });
const integridad = copia.pragma('integrity_check', { simple: true });
const info = {
  origen,
  destino,
  integridad,
  bytes: statSync(destino).size,
  tenants: contar(copia, 'tenants'),
  usuarios: contar(copia, 'users'),
  citas: contar(copia, 'appointments'),
  servicios: contar(copia, 'services'),
};
copia.close();

// El .db que dejo db.backup() ya es autonomo: no tiene transactions a medias.
// Los -wal/-shm que quedan son residuo de haberlo abierto para verificar, y son
// peligroso si quedan sueltos: un -wal con contenido que alguien restaure junto
// al .db cambia los datos, y sin el -wal se pierden. Se comprueba y se borran.
const wal = destino + '-wal';
const shm = destino + '-shm';
let walPENDiente = 0;
if (existsSync(wal)) {
  walPENDiente = statSync(wal).size;
  rmSync(wal, { force: true });
}
if (existsSync(shm)) rmSync(shm, { force: true });
info.walPENDiente = walPENDiente;

console.log(JSON.stringify(info));

const malo = integridad !== 'ok' || walPENDiente > 0;
if (malo) {
  if (walPENDiente > 0) {
    console.error(`el WAL de destino tenia ${walPENDiente} bytes pendientes; la copia no es autonoma`);
  } else {
    console.error(`integrity_check devolvio: ${integridad}`);
  }
}
process.exit(malo ? 1 : 0);
