/**
 * Harness local para revisar la pantalla en un Chrome de verdad.
 *
 * Temporal: no se commitea. Es el reemplazo de lo que se borro en la sesion
 * anterior (ver seccion 6 de CONTEXTO-QA-CITAS.md).
 *
 * El Core no se puede levantar (su `index.ts` es un barrel de exports y
 * `startPlatform()` no lo llama nadie), pero `startTestProduct` levanta la app
 * de Express con identidad REAL: el JWT va firmado con el secreto del producto
 * y la cookie se pega en el navegador tal cual, asi que lo que se ve en pantalla
 * es lo que vera el usuario.
 *
 *   npx tsx harness-local.ts
 */
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { startTestProduct } from '@amg/product-runtime/testing';
import { definicion } from './src/app.js';

const PUERTO = 4321;
const BASE = `http://localhost:${PUERTO}`;
const ORG = 'org_local_qa_000000';

/** El taller esta en Mexico City, seis horas antes que UTC. */
const ZONA = 'America/Mexico_City';

/** Fecha de hoy en la zona del taller, no en la del reloj de Node. */
function hoyEnTaller(): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return partes;
}

/**
 * Un instante `hora:minutos` del taller del dia indicado, en ISO UTC.
 *
* Mexico City es UTC-6 fijo (desde 2022 no cambia el horario de verano), asi
 * que la hora de la pared mas seis horas da el instante UTC. Se deja que Node
 * NORMALICE el cruce de dia en vez de armar el string a mano: las 22:00 del dia
 * 5 son las 04:00Z del dia 6, y concatenar "28:00" revienta.
 */
function instanteDelTaller(dia: string, hora: number, minutos = 0): string {
  const [a, m, d] = dia.split('-').map(Number);
  const local = Date.UTC(a, m - 1, d, hora, minutos);
  return new Date(local + 6 * 60 * 60 * 1000).toISOString();
}

/** El dia `n` del taller a partir de hoy, para que el harness sea reproducible. */
function enDias(n: number): string {
  const d = new Date(`${hoyEnTaller()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const tp = startTestProduct(definicion);
const sesion = {
  orgId: ORG,
  role: 'owner' as const,
  email: 'demo@talleres.com',
  name: 'Talleres El Mecanico',
};
const cookie = tp.cookie(sesion);

async function sembrar(): Promise<{ resumen: any; citas: any[] }> {
  const hoy = hoyEnTaller();

  const pedir = async (method: string, ruta: string, cuerpo?: unknown) => {
    const r = await fetch(`${BASE}${ruta}`, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    const texto = await r.text();
    const datos = texto ? JSON.parse(texto) : null;
    if (!r.ok) throw new Error(`${method} ${ruta} -> ${r.status} ${texto}`);
    return datos;
  };

  await pedir('PUT', '/api/settings', {
    timezone: ZONA,
    currency: '$',
    reminderHours: 12,
    emailEnabled: false,
  });

  const clientes = await Promise.all(
    [
      { name: 'Irene Campos', phone: '+52 55 0000 0001', email: 'irene@example.com', tags: 'vip' },
      { name: 'Marco Ruiz', phone: '+52 55 0000 0002', email: null, tags: null },
      { name: 'Ana Torres', phone: null, email: 'ana@example.com', tags: null },
    ].map((c) => pedir('POST', '/api/customers', c)),
  );

  const servicios = await Promise.all(
    [
      { name: 'Corte', durationMin: 30, priceCents: 12000, active: true },
      { name: 'Alineacion', durationMin: 45, priceCents: 15000, active: true },
    ].map((s) => pedir('POST', '/api/services', s)),
  );

  const profesionales = await Promise.all(
    [
      { name: 'Marco Ruiz', phone: null, email: null, color: '#4f46e5', active: true },
      { name: 'Lucia Ortega', phone: null, email: null, color: '#0ea5e9', active: true },
    ].map((s) => pedir('POST', '/api/staff', s)),
  );

  // Horarios: de 9:00 a 14:00 y de 16:00 a 20:00, de lunes a viernes. En
  // minutos desde medianoche, que es como los entiende el que configura.
  const DIAS_LABORABLES = [1, 2, 3, 4, 5];
  for (const p of profesionales) {
    for (const dia of DIAS_LABORABLES) {
      await pedir('POST', '/api/schedules', { staffId: p.id, weekday: dia, startTime: 9 * 60, endTime: 14 * 60, active: true });
      await pedir('POST', '/api/schedules', { staffId: p.id, weekday: dia, startTime: 16 * 60, endTime: 20 * 60, active: true });
    }
  }

  // Un bloqueo, para que el panel no se vea vacio del todo.
  await pedir('POST', '/api/blocks', {
    staffId: profesionales[1].id,
    startAt: instanteDelTaller(enDias(2), 12),
    endAt: instanteDelTaller(enDias(2), 13),
    reason: 'Almuerzo',
  });

  /**
   * La cita que prueba la zona horaria: `instanteDelTaller(dia5, 22)` es
   * 2026-10-06T04:00Z, que en Mexico City es el dia 5 a las 22:00. Con el huso
   * del navegador (Santiago, UTC-3) la UI la archivaba en el dia 6 a la 01:00.
   */
  const dia5 = enDias(3);
  const dia6 = enDias(4);
  const diaHoy = hoy;

  const cuerpo = (
    i: number,
    startAt: string,
    endAt: string,
    status: string,
    servicio: any,
  ) => ({
    customerId: clientes[i].id,
    staffId: profesionales[i % profesionales.length].id,
    startAt,
    endAt,
    status,
    services: [{ serviceId: servicio.id, serviceName: servicio.name, priceCents: servicio.priceCents }],
  });

  const citas = [
    // Hoy, para que la tarjeta "Hoy" tenga algo que mostrar.
    await pedir('POST', '/api/appointments', cuerpo(0, instanteDelTaller(diaHoy, 9), instanteDelTaller(diaHoy, 9, 30), 'confirmed', servicios[0])),
    // La del dia 5 a las 22:00: la prueba de la zona horaria.
    await pedir('POST', '/api/appointments', cuerpo(1, instanteDelTaller(dia5, 22), instanteDelTaller(dia5, 22, 45), 'confirmed', servicios[1])),
    // Futura y sin confirmar: la tarjeta "Por confirmar" tiene que contar ESTA.
    await pedir('POST', '/api/appointments', cuerpo(2, instanteDelTaller(dia6, 11), instanteDelTaller(dia6, 12), 'pending', servicios[0])),
    // Cancelada: no puede sumar en ninguna tarjeta.
    await pedir('POST', '/api/appointments', cuerpo(0, instanteDelTaller(dia6, 16), instanteDelTaller(dia6, 16, 30), 'cancelled', servicios[0])),
  ];

  const resumen = await pedir('GET', '/api/resumen');
  return { resumen, citas };
}

/**
 * `/qa` planta la cookie y manda a la pantalla.
 *
 * El JWT vive 15 minutos, asi que `/qa` se puede volver a cargar para renovar la
 * sesion sin tocar codigo del producto: es un atajo del harness, no una ruta de
 * la app. Todo lo demas lo responde la app de Express tal cual.
 */
const servidor = createServer((req, res) => {
  if (req.url === '/qa' || req.url?.startsWith('/qa?')) {
    const token = tp.token(sesion);
    res.writeHead(302, {
      Location: '/',
      'Set-Cookie': `app_session=${token}; Path=/; HttpOnly; SameSite=Lax`,
      'Cache-Control': 'no-store',
    });
    res.end();
    return;
  }
  tp.app(req, res);
});

servidor.listen(PUERTO, async () => {
  try {
    const { resumen, citas } = await sembrar();
    const salida = {
      url: `${BASE}/qa`,
      cookie,
      resumen,
      citas: citas.length,
      dia5: enDias(3),
      hoy: hoyEnTaller(),
    };
    console.log(`[harness] entrar por ${BASE}/qa   |  org ${ORG}`);
    console.log(JSON.stringify(salida, null, 2));
    writeFileSync('harness-local.json', JSON.stringify(salida, null, 2));
  } catch (e) {
    console.error('[harness] fallo al sembrar:', e);
    process.exit(1);
  }
});