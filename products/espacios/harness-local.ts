/**
 * Harness local para revisar la pantalla de Espacios en un Chrome de verdad.
 *
 * Temporal: no se commitea. Mismo molde que `products/citas/harness-local.ts`.
 *
 * El Core no se levanta (su `index.ts` es un barrel de exports), pero
 * `startTestProduct` levanta la app con identidad REAL: el JWT va firmado con el
 * secreto del producto, asi que lo que se ve es lo que vera el usuario.
 *
 *   npx tsx harness-local.ts       -> entrar por http://localhost:4322/qa
 */
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { startTestProduct } from '@amg/product-runtime/testing';
import { definicion } from './src/app.js';

const PUERTO = 4322;
const BASE = `http://localhost:${PUERTO}`;
const ORG = 'org_local_qa_000000';

/** El salon esta en Mexico City, seis horas antes que UTC. */
const ZONA = 'America/Mexico_City';

function hoyEnTaller(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function enDias(n: number): string {
  const d = new Date(`${hoyEnTaller()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Un instante `hora:minutos` del salon del dia indicado, en ISO UTC.
 *
 * Mexico City es UTC-6 fijo: la hora de la pared MAS 6 horas da el instante UTC.
 * Se deja que Node normalize el cruce de dia en vez de armar el string a mano.
 */
function instanteDelTaller(dia: string, hora: number, minutos = 0): string {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d, hora, minutos) + 6 * 60 * 60 * 1000).toISOString();
}

const tp = startTestProduct(definicion);
const sesion = {
  orgId: ORG,
  role: 'owner' as const,
  email: 'demo@salones.com',
  name: 'Salones del Centro',
};
const cookie = tp.cookie(sesion);

async function sembrar(): Promise<Record<string, unknown>> {
  const hoy = hoyEnTaller();
  const dia3 = enDias(3);
  const dia4 = enDias(4);

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
    currency: '$',
    timezone: ZONA,
    openingMinutes: 8 * 60,
    closingMinutes: 22 * 60,
    slotMinutes: 60,
    minAdvanceMinutes: 0,
  });

  const clientes = await Promise.all(
    [
      { name: 'Bodas Rivera', phone: '+52 55 1111 0001', email: 'rivera@example.com' },
      { name: 'Conference Norte', phone: '+52 55 1111 0002', email: 'cnorte@example.com' },
    ].map((c) => pedir('POST', '/api/customers', c)),
  );

  const espacios = await Promise.all(
    [
      { name: 'Salonprincipal', type: 'salon', capacity: 120, pricePerHourCents: 30000, active: true },
      { name: 'Cancha de futbol', type: 'deporte', capacity: 22, pricePerHourCents: 12000, active: true },
    ].map((s) => pedir('POST', '/api/spaces', s)),
  );

  const extras = await Promise.all(
    [
      { name: 'Proyector', priceCents: 8000, active: true },
      { name: 'Sonido', priceCents: 5000, active: true },
    ].map((x) => pedir('POST', '/api/addons', x)),
  );

  // Horarios de lunes a viernes, de 8 a 14 y de 15 a 22, en minutos del dia.
  for (const e of espacios) {
    for (const dia of [1, 2, 3, 4, 5]) {
      await pedir('POST', '/api/schedules', { spaceId: e.id, weekday: dia, startTime: 8 * 60, endTime: 14 * 60, active: true });
      await pedir('POST', '/api/schedules', { spaceId: e.id, weekday: dia, startTime: 15 * 60, endTime: 22 * 60, active: true });
    }
  }

  await pedir('POST', '/api/blocks', {
    spaceId: espacios[0].id,
    startAt: instanteDelTaller(dia4, 12),
    endAt: instanteDelTaller(dia4, 14),
    reason: 'Mantenimiento del aire',
  });

  const cuerpo = (i: number, spaceId: string, startAt: string, endAt: string, status: string) => ({
    spaceId,
    customerId: clientes[i % clientes.length].id,
    startAt,
    endAt,
    status,
    addons: [{ addonId: extras[i % extras.length].id, priceCents: extras[i % extras.length].priceCents }],
  });

  /**
   * La reserva que prueba la zona horaria: las 20:00 del dia 3 en la cancha son
   * 2026-10-06T02:00Z, que en Mexico City es el dia 3 a las 20:00. Con el rango
   * de la UI (medianoche UTC a medianoche UTC) esa reserva cae en el dia UTC 6:
   * no se ve ni en el dia 3 ni en el 4. Invisible en cualquier fecha.
   */
  const reservas = [
    await pedir('POST', '/api/bookings', cuerpo(0, espacios[0].id, instanteDelTaller(hoy, 10), instanteDelTaller(hoy, 12), 'confirmed')),
    await pedir('POST', '/api/bookings', cuerpo(1, espacios[1].id, instanteDelTaller(dia3, 20), instanteDelTaller(dia3, 22), 'confirmed')),
    await pedir('POST', '/api/bookings', cuerpo(0, espacios[0].id, instanteDelTaller(dia4, 9), instanteDelTaller(dia4, 11), 'pending')),
    await pedir('POST', '/api/bookings', cuerpo(1, espacios[1].id, instanteDelTaller(dia4, 16), instanteDelTaller(dia4, 17), 'cancelled')),
  ];

  const resumen = await pedir('GET', `/api/resumen?date=${hoy}`);
  const agenda = await pedir('GET', `/api/agenda?from=${instanteDelTaller(hoy, 0)}&to=${instanteDelTaller(hoy, 24)}`);
  const disponibilidad = await pedir('GET', `/api/availability?spaceId=${espacios[0].id}&date=${hoy}`);

  return { resumen, reservas: reservas.length, agenda: agenda.bookings.length, franjas: disponibilidad.slots.length };
}

/**
 * `/qa` planta la cookie y manda a la pantalla.
 *
 * El JWT vive 15 minutos, asi que `/qa` se puede volver a cargar para renovar la
 * sesion sin tocar codigo del producto. Todo lo demas lo responde la app.
 */
const servidor = createServer((req, res) => {
  if (req.url === '/qa' || req.url?.startsWith('/qa?')) {
    res.writeHead(302, {
      Location: '/',
      'Set-Cookie': `app_session=${tp.token(sesion)}; Path=/; HttpOnly; SameSite=Lax`,
      'Cache-Control': 'no-store',
    });
    res.end();
    return;
  }
  tp.app(req, res);
});

servidor.listen(PUERTO, async () => {
  try {
    const salida = { url: `${BASE}/qa`, cookie, hoy: hoyEnTaller(), dia3: enDias(3), dia4: enDias(4), ...(await sembrar()) };
    console.log(`[harness] entrar por ${BASE}/qa   |  org ${ORG}`);
    console.log(JSON.stringify(salida, null, 2));
    writeFileSync('harness-local.json', JSON.stringify(salida, null, 2));
  } catch (e) {
    console.error('[harness] fallo al sembrar:', e);
    process.exit(1);
  }
});