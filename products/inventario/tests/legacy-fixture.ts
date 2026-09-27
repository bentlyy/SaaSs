import Database from 'better-sqlite3';

/**
 * Un inventario legacy de mentira, con la forma mínima que el migrador lee.
 *
 * El legacy real tiene 18 tablas; acá están solo `tenants`, `users`,
 * `inventory_items` e `inventory_movements`. Si el migrador anduviera con la
 * base de verdad, esta no serviría; y ese es el punto: que el test falle apenas
 * el migrador empiece a depender de una tabla que no necesita.
 */
export const LEGACY_DDL = `
CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL);
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL);
CREATE TABLE inventory_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sku TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  min_qty INTEGER NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'unidad',
  price INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE inventory_movements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  user_id TEXT,
  created_at TEXT NOT NULL
);
`;

/** Dos tenants, cuatro artículos, cuatro movimientos y una autora local. */
export function crearLegacyConDatos(path: string): void {
  const db = new Database(path);
  db.exec(LEGACY_DDL);

  const tenant = db.prepare('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)');
  tenant.run('ten_legacy_1', 'Bodega Central', 'demo-inventario');
  tenant.run('ten_legacy_2', 'Sucursal Norte', 'demo-norte');

  db.prepare('INSERT INTO users (id, name, email) VALUES (?, ?, ?)').run(
    'usr_legacy_1',
    'Ana Legacy',
    'ana@legacy.test',
  );

  const item = db.prepare(
    `INSERT INTO inventory_items (id, tenant_id, name, sku, quantity, min_qty, unit, price, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  item.run('itm_1', 'ten_legacy_1', 'Filtro de aire', 'FIL-AIR', 10, 4, 'unidad', 25000, 1, '2026-01-01T00:00:00.000Z');
  item.run('itm_2', 'ten_legacy_1', 'Aceite hidráulico', 'ACE-50', 3, 5, 'litro', 9000, 1, '2026-01-02T00:00:00.000Z');
  item.run('itm_3', 'ten_legacy_2', 'Guantes', 'GUA-M', 40, 10, 'par', 3500, 1, '2026-01-03T00:00:00.000Z');
  // Inactivo: el legacy lo guardaba así, y hay que traerlo como inactivo.
  item.run('itm_4', 'ten_legacy_1', 'Retirado', null, 0, 0, 'unidad', 0, 0, '2026-01-04T00:00:00.000Z');

  const mov = db.prepare(
    `INSERT INTO inventory_movements (id, tenant_id, item_id, delta, reason, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  mov.run('mov_1', 'ten_legacy_1', 'itm_1', 10, 'Recepción', 'usr_legacy_1', '2026-01-01T10:00:00.000Z');
  mov.run('mov_2', 'ten_legacy_1', 'itm_1', -2, 'Venta mostrador', 'usr_legacy_1', '2026-01-05T10:00:00.000Z');
  mov.run('mov_3', 'ten_legacy_1', 'itm_2', 3, 'Compra', null, '2026-01-06T10:00:00.000Z');
  mov.run('mov_4', 'ten_legacy_2', 'itm_3', 40, 'Stock inicial', null, '2026-01-07T10:00:00.000Z');

  db.close();
}

/**
 * Una SEGUNDA base legacy, con la misma forma pero de otro producto.
 *
 * Es el caso real: `deportes` guardaba cuatro artículos que no eran suyos, y
 * `inventario` es su dueño. El `tenant_id` es a propósito distinto del de la
 * principal, porque lo que hay que probar es que dos empresas que viven en dos
 * bases distintas terminen en organizaciones distintas.
 */
export function crearSegundaFuente(path: string): void {
  const db = new Database(path);
  db.exec(LEGACY_DDL);

  db.prepare('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)').run(
    'ten_legacy_3',
    'Sport Center MX',
    'demo-deportes',
  );
  db.prepare('INSERT INTO users (id, name, email) VALUES (?, ?, ?)').run(
    'usr_legacy_2',
    'Alejandro Dueno',
    'dueño@deportes.test',
  );

  const item = db.prepare(
    `INSERT INTO inventory_items (id, tenant_id, name, sku, quantity, min_qty, unit, price, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  item.run('itm_9', 'ten_legacy_3', 'Balon de futbol', null, 12, 5, 'pieza', 0, 1, '2026-02-01T00:00:00.000Z');
  item.run('itm_10', 'ten_legacy_3', 'Colchonetas de yoga', null, 20, 8, 'pieza', 0, 1, '2026-02-02T00:00:00.000Z');

  const mov = db.prepare(
    `INSERT INTO inventory_movements (id, tenant_id, item_id, delta, reason, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  mov.run('mov_9', 'ten_legacy_3', 'itm_9', 12, 'Stock inicial', 'usr_legacy_2', '2026-02-03T10:00:00.000Z');

  db.close();
}

/**
 * Segunda fuente que repite el `tenant_id` de la principal.
 *
 * Sirve para probar que la migración se detiene: dos bases que declaran el
 * mismo tenant son dos empresas que la migración no puede distinguir, y sumarlas
 * sería peor que no migrar.
 */
export function crearFuenteConTenantRepetido(path: string, tenantId: string): void {
  const db = new Database(path);
  db.exec(LEGACY_DDL);
  db.prepare('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)').run(tenantId, 'Otro', 'demo-otro');
  db.prepare(
    `INSERT INTO inventory_items (id, tenant_id, name, sku, quantity, min_qty, unit, price, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('itm_99', tenantId, 'Repetido', null, 1, 0, 'unidad', 0, 1, '2026-03-01T00:00:00.000Z');
  db.close();
}
