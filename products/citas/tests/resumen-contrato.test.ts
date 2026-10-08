import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { startTestProduct, type TestProduct } from '@amg/product-runtime/testing';
import { definicion } from '../src/app.js';

/**
 * El resumen de la portada y el contrato de las listas.
 *
 * Estos tests cubren dos cosas que en produccion nobody miraba:
 *
 *   1. `/api/resumen` contaba las citas CONFIRMADAS bajo la etiqueta "Por
 *      confirmar", y cortaba el dia por la medianoche UTC en vez de por la del
 *      taller. Las dos cosas se ven en la pantalla, asi que no hacia falta abrir
 *      la base para encontrarlas.
 *   2. Los catalogos se sirven con `crudRouter`, que responde
 *      `{ items, total, limit, offset }`. La UI leia una clave propia
 *      (`{ customers }`) y por eso Clientes, Servicios, Profesionales y Horarios
 *      salian vacios. Los tests de a abajo fijan la forma de la respuesta para
 *      que un cambio de contrato no pueda volver a romper la pantalla en silencio.
 *
 * Cada describe usa su propia organizacion y una base nueva, porque el resumen
 * cuenta sobre filas reales y cualquier otra cita que quedara suelta dejaria el
 * numero movido.
 */

let tp: TestProduct;

const comoAdmin = (orgId: string) => tp.as({ orgId, role: 'admin' });
const comoMiembro = (orgId: string) => tp.as({ orgId, role: 'member' });

beforeAll(() => {
  tp = startTestProduct(definicion);
});

afterAll(() => tp.close());

/**
 * La fecha local (YYYY-MM-DD) de "hoy" en `zone`, no la de UTC.
 *
 * El resumen corta el dia por la medianoche del taller, asi que "hoy" para el
 * backend no es siempre la fecha que da `new Date().toISOString()`: en la
 * madrugada UTC un taller de America ya esta en el dia siguiente local
 * (America/Santiago) o en el anterior (America/Mexico_City). Anclar los turnos
 * a esta fecha es lo que hace que los tests no dependan de la hora de corrida.
 * `saltoDias` desplaza "hoy" N dias hacia adelante en esa misma zona.
 */
function hoyEn(zone: string, saltoDias = 0): string {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const pronto = new Date(Date.now() + saltoDias * 86_400_000);
  const p = Object.fromEntries(f.formatToParts(pronto).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** Crea una cita para `org` en el instante dado. */
async function cita(
  orgId: string,
  profesional: string,
  startAt: string,
  endAt: string,
  status = 'confirmed',
): Promise<void> {
  const res = await comoMiembro(orgId).post('/api/appointments').send({
    customerId: null,
    staffId: profesional,
    startAt,
    endAt,
    status,
    services: [],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}

async function profesional(orgId: string): Promise<string> {
  const res = await comoAdmin(orgId).post('/api/staff').send({ name: 'Yuki', color: '#4f46e5' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id;
}

async function zona(orgId: string, timezone: string): Promise<void> {
  const res = await comoAdmin(orgId)
    .put('/api/settings')
    .send({ timezone, currency: '$', reminderHours: 12, emailEnabled: false });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

describe('el resumen de la portada', () => {
  const ORG = 'org_resumen_00000000000';
  // La zona por defecto de una organizacion nueva es America/Santiago; los
  // turnos se anclan a su fecha local, no a la de UTC, para que el test no
  // dependa de que hora es cuando corre.
  const HOY = hoyEn('America/Santiago');
  const turno = (hora: string) => `${HOY}T${hora}:00.000Z`;

  it('"Por confirmar" cuenta las pending, no las confirmadas', async () => {
    const org = `${ORG}_pending`;
    const pro = await profesional(org);
    // Tres confirmadas y dos pendientes: la tarjeta tiene que decir 2.
    await cita(org, pro, turno('12:00'), turno('13:00'), 'confirmed');
    await cita(org, pro, turno('14:00'), turno('15:00'), 'confirmed');
    await cita(org, pro, turno('16:00'), turno('17:00'), 'confirmed');
    await cita(org, pro, turno('18:00'), turno('19:00'), 'pending');
    await cita(org, pro, turno('20:00'), turno('21:00'), 'pending');

    const res = await comoAdmin(org).get('/api/resumen');
    expect(res.status).toBe(200);
    expect(res.body.porConfirmar).toBe(2);
  });

  it('"Hoy" y "Futuras" no cuentan lo cancelado ni lo que no se hizo', async () => {
    const org = `${ORG}_vigentes`;
    const pro = await profesional(org);
    await cita(org, pro, turno('12:00'), turno('13:00'), 'confirmed');
    await cita(org, pro, turno('14:00'), turno('15:00'), 'cancelled');
    await cita(org, pro, turno('16:00'), turno('17:00'), 'no_show');

    const res = await comoAdmin(org).get('/api/resumen');
    expect(res.body.hoy).toBe(1);
    expect(res.body.futuras).toBe(1);
    // Una cancelada tampoco es "por confirmar".
    expect(res.body.porConfirmar).toBe(0);
  });

  it('corta el día en la zona del taller, no en la medianoche UTC', async () => {
    const org = `${ORG}_zona`;
    const pro = await profesional(org);
    await zona(org, 'America/Mexico_City');

    // 02:00 UTC del dia siguiente a hoy-en-Mexico son las 20:00 de este mismo
    // dia en Mexico City (UTC-6): un turno del atardecer del taller cae en
    // "hoy" con el corte del taller siempre, y cuando Mexico y UTC comparten
    // fecha, el corte UTC lo leería como "manana". Eso es lo que fija el test:
    // la hora local manda, no la de Greenwich.
    const mananaMexico = hoyEn('America/Mexico_City', 1);
    const inicioMananaUtc = `${mananaMexico}T02:00:00.000Z`;
    await cita(org, pro, inicioMananaUtc, `${mananaMexico}T03:00:00.000Z`, 'confirmed');

    const res = await comoAdmin(org).get('/api/resumen');
    expect(res.body.hoy).toBe(1);
  });

  it('cada organización ve su propio resumen', async () => {
    const orgA = `${ORG}_aisla_a`;
    const orgB = `${ORG}_aisla_b`;
    const proA = await profesional(orgA);
    await cita(orgA, proA, turno('12:00'), turno('13:00'), 'confirmed');

    const a = await comoAdmin(orgA).get('/api/resumen');
    const b = await comoAdmin(orgB).get('/api/resumen');
    expect(a.body.hoy).toBe(1);
    expect(b.body.hoy).toBe(0);
    expect(b.body.futuras).toBe(0);
  });
});

describe('el contrato de las listas', () => {
  const ORG = 'org_contrato_0000000000';

  /**
   * Los catalogos salen de `crudRouter`, que pagina. La UI lee `items`.
   *
   * Estos tests son la red que habria atrapado los cuatro paneles vacios: si
   * `crudRouter` cambia la forma de la respuesta, o la UI vuelve a pedir
   * `{ customers }`, uno de los dos falla aca en vez de en produccion.
   */
  for (const recurso of ['customers', 'services', 'staff'] as const) {
    it(`/api/${recurso} responde \`items\` y pagina en \`limit\`/\`offset\``, async () => {
      const org = `${ORG}_${recurso}`;
      const res = await comoAdmin(org).get(`/api/${recurso}?limit=1`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('items');
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body).toHaveProperty('total');
      expect(res.body.limit).toBe(1);
      expect(res.body.offset).toBe(0);
      // La clave por nombre no puede volver a aparecer: la UI no la lee, y que
      // este ahi fue lo que la hizo leerla.
      expect(res.body).not.toHaveProperty(recurso);
    });
  }

  it('/api/schedules y /api/blocks tambien usan `items`', async () => {
    const org = `${ORG}_agenda`;
    const pro = await profesional(org);
    for (const recurso of ['schedules', 'blocks'] as const) {
      const res = await comoAdmin(org).get(`/api/${recurso}?staffId=${pro}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items), `${recurso} sin items`).toBe(true);
    }
  });

  it('/api/agenda y /api/reminders usan su clave propia', async () => {
    const org = `${ORG}_agenda2`;
    for (const [ruta, clave] of [
      ['/api/agenda', 'appointments'],
      ['/api/reminders?limit=10', 'reminders'],
    ] as const) {
      const res = await comoAdmin(org).get(ruta);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body[clave]), `${ruta} sin ${clave}`).toBe(true);
    }
  });
});
