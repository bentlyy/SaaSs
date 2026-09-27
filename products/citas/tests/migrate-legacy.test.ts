import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { closeCoreDb } from '@amg/platform';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { ErrorMigracion, migrarLegacy, type FuenteLegacy, type ResultadoMigracion } from '../src/migrate-legacy.js';
import { crearLegacy, type OpcionesFixture } from './legacy-fixture.js';

/**
 * La migración de citas.
 *
 * Lo que se prueba acá no es que "corra": es que NO invente. El legacy tiene
 * precios que se contradicen, una cita que no es una cita, una tabla de
 * asignaciones vacía y dos intentos del mismo aviso. Cada una de esas rarezas
 * tiene una respuesta definida acá, y si alguien la cambia sin cambiar estos
 * tests, los datos de un cliente quedan mal convertidos en silencio.
 */

let dir: string;
let legacyPath: string;
let destinoPath: string;
let salida: ResultadoMigracion | null = null;

/** Crea la base legacy de mentira y devuelve la lista de fuentes a migrar. */
function legacy(opts: OpcionesFixture = {}): FuenteLegacy[] {
  crearLegacy(legacyPath, opts);
  return [{ etiqueta: 'fixture', ruta: legacyPath }];
}

/** Corre la migración y la deja abierta para poder leer el destino. */
function migrar(fuentes: FuenteLegacy[] = [{ etiqueta: 'fixture', ruta: legacyPath }]) {
  salida = migrarLegacy({ destinoPath, fuentes });
  return salida;
}

/**
 * Lee una tabla del destino y CIERRA la conexión.
 *
 * En Windows un handle de SQLite abierto impide borrar el archivo, así que abrir
 * sin cerrar hace fallar el `afterEach` con EBUSY y el error del test real queda
 * tapado por un error de limpieza.
 */
function leerDestino(sql: string, ...params: unknown[]): any[] {
  const db = new Database(destinoPath, { readonly: true });
  try {
    return db.prepare(sql).all(...params) as any[];
  } finally {
    db.close();
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'amg-citas-mig-'));
  legacyPath = join(dir, 'legacy.db');
  destinoPath = join(dir, 'citas.sqlite');
});

afterEach(() => {
  salida?.cerrar();
  salida = null;
  closeCoreDb();
  rmSync(dir, { recursive: true, force: true });
});

describe('lo que se migra', () => {
  it('trae clientes, servicios, profesionales y citas de cada tenant', () => {
    migrar(legacy());
    const c = salida!.resumen.porOrganizacion;

    expect(c).toHaveLength(2);
    // Cada tenant legacy es su propia organización, con su propia cuenta.
    expect(new Set(c.map((x) => x.organizationId)).size).toBe(2);

    const pelu = c.find((x) => x.legacy.includes('demo-pelu'))!;
    expect(pelu.servicios).toBe(2);
    expect(pelu.profesionales).toBe(2);
    expect(pelu.clientes).toBe(2);
    expect(pelu.citas).toBe(2);
    expect(pelu.lineas).toBe(2);

    const crm = c.find((x) => x.legacy.includes('demo-crm'))!;
    expect(crm.servicios).toBe(2);
    expect(crm.citas).toBe(1);
  });

  it('conserva el id legacy, para que la migración sea re-ejecutable', () => {
    migrar(legacy());
    expect(leerDestino('SELECT id FROM appointments').map((r) => r.id).sort()).toEqual(['cit_1', 'cit_2', 'cit_3']);
  });

  it('cada fila queda en la organización de su tenant, no en una sola', () => {
    migrar(legacy());
    const citas = leerDestino('SELECT organization_id FROM appointments ORDER BY id');
    const orgs = new Set(citas.map((c) => c.organization_id));
    expect(orgs.size).toBe(2);
  });

  it('trae el servicio inactivo como inactivo', () => {
    migrar(legacy());
    const retirado = leerDestino("SELECT active FROM services WHERE name = 'Retirado'")[0];
    expect(retirado.active).toBe(0);
  });

  it('lee las preferencias del tenant, que en el legacy vivían en la tabla tenants', () => {
    migrar(legacy());
    const prefs = leerDestino('SELECT timezone, currency, reminder_hours, email_enabled FROM settings ORDER BY reminder_hours');
    expect(prefs).toHaveLength(2);
    expect(prefs[0].reminder_hours).toBe(12);
    expect(prefs[0].email_enabled).toBe(1);
    expect(prefs[1].reminder_hours).toBe(24);
    expect(prefs[1].email_enabled).toBe(0);
  });

  it('calcula el total de cada cita sumando sus líneas', () => {
    migrar(legacy());
    const cita = leerDestino("SELECT total_cents FROM appointments WHERE id = 'cit_1'")[0];
    expect(cita.total_cents).toBe(120);
  });
});

describe('el dinero', () => {
  it('cuando el precio de la cita es el del catálogo, no lo multiplica', () => {
    migrar(legacy({ preciosCoherentes: true }));
    const linea = leerDestino("SELECT price_cents FROM appointment_services WHERE id = 'lin_1'")[0];
    // 120 se queda en 120: no hay evidencia de que sean unidades.
    expect(linea.price_cents).toBe(120);
    expect(salida!.informe.discrepancias).toHaveLength(0);
  });

  it('cuando el mismo servicio aparece a dos precios, NO convierte y lo reporta', () => {
    migrar(legacy({ preciosCoherentes: false }));
    // El valor viaja tal cual: es el dato que había, no uno inventado.
    expect(leerDestino("SELECT price_cents FROM appointment_services WHERE id = 'lin_1'")[0].price_cents).toBe(120);
    expect(leerDestino("SELECT price_cents FROM appointment_services WHERE id = 'lin_2'")[0].price_cents).toBe(12000);

    const d = salida!.informe.discrepancias;
    expect(d.length).toBeGreaterThan(0);
    // El informe dice qué servicio y qué precios vio, para que se pueda mirar.
    expect(d.some((x) => x.donde.includes('Corte + barba'))).toBe(true);
    expect(d.some((x) => x.motivo.includes('180'))).toBe(true);
  });

  it('reporta una sola vez cada servicio problemático, aunque aparezca en varias citas', () => {
    migrar(legacy({ preciosCoherentes: false }));
    const d = salida!.informe.discrepancias;
    expect(new Set(d.map((x) => x.donde)).size).toBe(d.length);
  });
});

describe('lo que el legacy no tenía', () => {
  it('deriva las asignaciones profesional-servicio del historial cuando la tabla está vacía', () => {
    migrar(legacy({ conAsignaciones: false }));
    // crm no tenía filas en staff_services, pero sí la cita con su profesional y
    // su servicio: sin esta derivación, esa empresa no podría agendar nada.
    expect(salida!.resumen.asignacionesDerivadas).toBeGreaterThan(0);
    const derivadas = leerDestino("SELECT id FROM staff_services WHERE id LIKE 'deriva_%'");
    expect(derivadas.length).toBeGreaterThan(0);
  });

  it('no vuelve a derivar lo que el legacy ya tenía', () => {
    migrar(legacy({ conAsignaciones: true }));
    // pelu tenía 2; crm no tenía ninguna y aporta las suyas del historial.
    const porOrg = leerDestino(
      `SELECT s.organization_id, count(*) n FROM staff_services s GROUP BY s.organization_id`,
    );
    const total = porOrg.reduce((s, o) => s + o.n, 0);
    const derivadas = leerDestino("SELECT id FROM staff_services WHERE id LIKE 'deriva_%'").length;
    expect(total - derivadas).toBe(2);
  });

  it('saca el destino del recordatorio del contacto del cliente, según el canal', () => {
    migrar(legacy());
    const email = leerDestino("SELECT \"to\" FROM reminders WHERE id = 'rec_1'")[0];
    const whatsapp = leerDestino("SELECT \"to\" FROM reminders WHERE id = 'rec_3'")[0];
    expect(email.to).toBe('ana@example.com');
    expect(whatsapp.to).toBe('+52 55 2222 1001');
    expect(salida!.resumen.destinosDerivados).toBe(3);
  });
});

describe('los recordatorios', () => {
  it('trae los tres intentos, aunque dos sean del mismo canal y la misma cita', () => {
    migrar(legacy());
    // Un índice único por (cita, canal) habría descartado al segundo intento.
    expect(leerDestino('SELECT id FROM reminders')).toHaveLength(3);
  });

  it('un aviso fallido no queda con sent_at: no se envió', () => {
    migrar(legacy());
    const r = leerDestino("SELECT status, sent_at, created_at FROM reminders WHERE id = 'rec_1'")[0];
    expect(r.status).toBe('failed');
    expect(r.sent_at).toBeNull();
    // El momento del intento no se pierde: queda en created_at.
    expect(r.created_at).toBe('2026-09-23T17:07:30.456Z');
  });

  it('conserva el motivo del fallo', () => {
    migrar(legacy());
    expect(leerDestino("SELECT error FROM reminders WHERE id = 'rec_1'")[0].error).toBe('SMTP no configurado');
  });
});

describe('lo que no se inventa', () => {
  it('un estado de cita desconocido queda en pending y se reporta', () => {
    migrar(legacy({ estadosRaros: true }));
    const cita = leerDestino("SELECT status FROM appointments WHERE id = 'cit_2'")[0];
    // No se lo marca como confirmada: eso sería afirmar algo que nadie sabe.
    expect(cita.status).toBe('pending');
    expect(salida!.resumen.estadosDesconocidos.some((e) => e.includes('rescheduled'))).toBe(true);
  });

  it('una autora que no está en el Core se reporta y no se le inventa una cuenta', () => {
    migrar(legacy({ autoresDesconocidos: true }));
    expect(salida!.informe.autoresSinCore.some((a) => a.includes('ana@legacy.test'))).toBe(true);
  });

  it('una cita con resource_id detiene la migración: es de espacios, no de citas', () => {
    crearLegacy(legacyPath, {});
    // Se agrega la cita con recurso sobre la base ya creada.
    const db = new Database(legacyPath);
    db.prepare(
      `INSERT INTO appointments (id, tenant_id, customer_id, staff_id, resource_id, start_at, end_at, status, created_at)
       VALUES ('cit_espacio', 'ten_pelu', 'cli_pelu_1', NULL, 'cancha_1', '2026-09-25T10:00:00.000Z', '2026-09-25T11:00:00.000Z', 'confirmed', '2026-01-01T00:00:00.000Z')`,
    ).run();
    db.close();

    expect(() => migrar([{ etiqueta: 'fixture', ruta: legacyPath }])).toThrow(/espacios/);
  });

  it('no fusiona a la misma persona en dos organizaciones', () => {
    migrar(legacy());
    // Están en el MISMO tenant acá, así que la repetición es entre dos filas
    // distintas: cada una conserva su id y su teléfono.
    const rows = leerDestino("SELECT id, phone FROM customers WHERE name = 'María Sosa' ORDER BY id");
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.phone)).size).toBe(2);
  });
});

describe('las propiedades del migrador', () => {
  it('es re-ejecutable: la segunda pasada no duplica nada', () => {
    migrar(legacy());
    const primera = leerDestino('SELECT count(*) c FROM appointments')[0].c;
    const organizacionesPrimera = salida!.informe.organizaciones.length;

    salida!.cerrar();
    salida = null;
    migrar([{ etiqueta: 'fixture', ruta: legacyPath }]);

    expect(leerDestino('SELECT count(*) c FROM appointments')[0].c).toBe(primera);
    expect(leerDestino('SELECT count(*) c FROM customers')[0].c).toBe(4);
    expect(salida!.informe.omitidas).toBeGreaterThan(0);
    // Y no crea organizaciones nuevas: la segunda pasada las encuentra por slug.
    expect(salida!.informe.organizaciones).toHaveLength(organizacionesPrimera);
    expect(salida!.informe.organizaciones.every((o) => o.accion === 'ya migrada')).toBe(true);
  });

  it('no toca la base legacy', () => {
    legacy();
    const antes = new Database(legacyPath, { readonly: true });
    const total = antes.prepare('SELECT count(*) c FROM appointments').get() as { c: number };
    const suma = antes.prepare('SELECT sum(price_at) s FROM appointment_services').get() as { s: number };
    antes.close();

    migrar([{ etiqueta: 'fixture', ruta: legacyPath }]);

    const despues = new Database(legacyPath, { readonly: true });
    expect((despues.prepare('SELECT count(*) c FROM appointments').get() as { c: number }).c).toBe(total.c);
    // Y los precios de origen tampoco cambian: leer en solo lectura de verdad.
    expect((despues.prepare('SELECT sum(price_at) s FROM appointment_services').get() as { s: number }).s).toBe(suma.s);
    despues.close();
  });

  it('si un dato no cierra, la migración se revierte entera', () => {
    crearLegacy(legacyPath, {});
    const db = new Database(legacyPath);
    // Un aviso que apunta a una cita que no está en la base. Las claves foráneas
    // están activas, así que insertarlo fallaría: la migración tiene que echarse
    // atrás, no dejar tres clientes y dos citas a medias.
    db.prepare(
      `INSERT INTO reminder_logs (id, tenant_id, appointment_id, channel, status, sent_at)
       VALUES ('rec_roto', 'ten_pelu', 'cit_inexistente', 'email', 'sent', '2026-01-01T00:00:00.000Z')`,
    ).run();
    db.close();

    expect(() => migrar([{ etiqueta: 'fixture', ruta: legacyPath }])).toThrow();

    // La base destino puede existir (el runtime crea el archivo y el esquema al
    // abrirla) pero no puede tener ni una fila de negocio a medias.
    const destino = new Database(destinoPath, { readonly: true });
    const citas = destino.prepare('SELECT count(*) c FROM appointments').get() as { c: number };
    const clientes = destino.prepare('SELECT count(*) c FROM customers').get() as { c: number };
    destino.close();
    expect(citas.c).toBe(0);
    expect(clientes.c).toBe(0);
  });

  it('avisa si el archivo legacy no está, en vez de crear una base vacía', () => {
    expect(() => migrar([{ etiqueta: 'fantasma', ruta: join(dir, 'no-existe.db') }])).toThrow(/No se encontró/);
    // Y lo importante: ni siquiera abre el destino, así que no deja una base
    // nueva que parezca una migración exitosa con cero datos.
    expect(existsSync(destinoPath)).toBe(false);
  });
});
