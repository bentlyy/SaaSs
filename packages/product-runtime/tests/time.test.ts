import { describe, expect, it } from 'vitest';
import { diaEnZona, hhmm, inicioDelDiaEnZona, localDe, offsetMinutos, zonaHoraria } from '../src/time.js';

/**
 * La hora del taller, no la del que mira.
 *
 * El servidor guarda UTC, asi que en algun momento hay que traducir. Casi todo
 * el codigo de fechas de este producto se apoya en estos helpers por lo mismo:
 * comparar una cita contra la medianoche UTC mete las citas de la madrugada del
 * taller en el dia que no es, y el error se ve en la pantalla como un numero
 * movido sin explicacion.
 *
 * Mexico City (UTC-6 fijo) y Santiago (UTC-3, y UTC-4 antes del cambio de
 * horario) estan de contrapeso porque las dos cosas se notan: Chile cambia, Mexico
 * no. Un helper que solo funciona con una de las dos no sirve.
 */

const CDMX = 'America/Mexico_City';
const SCL = 'America/Santiago';
const UTC = 'UTC';

describe('localDe', () => {
  it('descompone un instante en la zona pedida', () => {
    // 2026-10-06T04:00Z: en Mexico City es el 5 a las 22:00, en Santiago el 6 a la 01:00.
    const enCdmx = localDe('2026-10-06T04:00:00.000Z', CDMX);
    expect([enCdmx.year, enCdmx.month, enCdmx.day]).toEqual([2026, 10, 5]);
    expect(enCdmx.minutes).toBe(22 * 60);

    const enScl = localDe('2026-10-06T04:00:00.000Z', SCL);
    expect([enScl.year, enScl.month, enScl.day]).toEqual([2026, 10, 6]);
    expect(enScl.minutes).toBe(60);
  });

  it('la medianoche es 0 y no 1440', () => {
    // `hour: '2-digit'` sin `hourCycle` puede dar "24" en algunos runtimes, y
    // 24:00 en el dia anterior es una fecha distinta.
    expect(localDe('2026-10-06T06:00:00.000Z', CDMX).minutes).toBe(0);
  });

  it('el dia de la semana usa 0 = domingo, como las tablas de disponibilidad', () => {
    // 2026-10-04 es domingo.
    expect(localDe('2026-10-04T15:00:00.000Z', UTC).weekday).toBe(0);
    expect(localDe('2026-10-05T15:00:00.000Z', UTC).weekday).toBe(1);
  });
});

describe('offsetMinutos', () => {
  it('es 0 en UTC y negativo en las zonas de America', () => {
    const t = '2026-10-06T04:00:00.000Z';
    expect(offsetMinutos(UTC, t)).toBe(0);
    expect(offsetMinutos(CDMX, t)).toBe(-360);
    expect(offsetMinutos(SCL, t)).toBe(-180);
  });
});

describe('inicioDelDiaEnZona', () => {
  it('la medianoche del taller, expresada en UTC', () => {
    // 2026-10-06T04:00Z es el 5 a las 22:00 en Mexico City, asi que el "dia de
    // hoy" del taller es el 5, y su medianoche son las 06:00 UTC del 5.
    expect(inicioDelDiaEnZona(CDMX, 0, '2026-10-06T04:00:00.000Z')).toBe('2026-10-05T06:00:00.000Z');
    // El mismo instante en Santiago es el 6 a la 01:00: dia 6, medianoche 03:00 UTC.
    expect(inicioDelDiaEnZona(SCL, 0, '2026-10-06T04:00:00.000Z')).toBe('2026-10-06T03:00:00.000Z');
    expect(inicioDelDiaEnZona(UTC, 0, '2026-10-06T04:00:00.000Z')).toBe('2026-10-06T00:00:00.000Z');
  });

  it('`dias` cuenta desde el dia LOCAL del instante, no desde su fecha en UTC', () => {
    // Este es el punto: si `dias` se contara desde la fecha UTC, el taller de
    // Mexico City arrancaria el dia en la fecha de ayer y el resumen de "hoy"
    // miraria un dia que no es.
    const ref = '2026-10-06T04:00:00.000Z'; // dia local 5 en Mexico City
    expect(inicioDelDiaEnZona(CDMX, 0, ref)).toBe('2026-10-05T06:00:00.000Z');
    expect(inicioDelDiaEnZona(CDMX, 1, ref)).toBe('2026-10-06T06:00:00.000Z');
    expect(inicioDelDiaEnZona(CDMX, -1, ref)).toBe('2026-10-04T06:00:00.000Z');
  });

  it('cambia de largo cuando cambia el horario de verano', () => {
    // Chile es UTC-4 entre abril y septiembre, y UTC-3 de septiembre a abril.
    // El mismo dia del año, la misma medianoche, un UTC distinto: por eso el
    // offset no se puede calcular una vez y cachearlo.
    const agosto = inicioDelDiaEnZona(SCL, 0, '2026-08-15T12:00:00.000Z');
    const octubre = inicioDelDiaEnZona(SCL, 0, '2026-10-15T12:00:00.000Z');
    expect(agosto).toBe('2026-08-15T04:00:00.000Z'); // UTC-4
    expect(octubre).toBe('2026-10-15T03:00:00.000Z'); // UTC-3

    // Mexico City no cambia nunca: el mismo dia del año mantiene el mismo UTC.
    expect(inicioDelDiaEnZona(CDMX, 0, '2026-08-15T12:00:00.000Z')).toBe('2026-08-15T06:00:00.000Z');
    expect(inicioDelDiaEnZona(CDMX, 0, '2026-10-15T12:00:00.000Z')).toBe('2026-10-15T06:00:00.000Z');
  });

  it('el instante que devuelve cae dentro del dia que pide', () => {
    const t = Date.parse('2026-10-06T04:00:00.000Z');
    for (const z of [CDMX, SCL, UTC]) {
      const desde = Date.parse(inicioDelDiaEnZona(z, 0, '2026-10-06T04:00:00.000Z'));
      const hasta = Date.parse(inicioDelDiaEnZona(z, 1, '2026-10-06T04:00:00.000Z'));
      expect(t, z).toBeGreaterThanOrEqual(desde);
      expect(t, z).toBeLessThan(hasta);
    }
  });
});

describe('diaEnZona', () => {
  it('el mismo instante puede ser un dia distinto segun donde se mire', () => {
    const t = '2026-10-06T04:00:00.000Z';
    expect(diaEnZona(CDMX, t)).toBe('2026-10-05');
    expect(diaEnZona(SCL, t)).toBe('2026-10-06');
    expect(diaEnZona(UTC, t)).toBe('2026-10-06');
  });
});

describe('zonaHoraria', () => {
  it('rechaza las zonas que no existen, con un mensaje que dice cual es el campo', () => {
    const r = zonaHoraria.safeParse('Marte/Olympus');
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toMatch(/zona horaria/i);
  });

  it('acepta las zonas IANA de verdad', () => {
    expect(zonaHoraria.safeParse('America/Mexico_City').success).toBe(true);
    expect(zonaHoraria.safeParse('America/Santiago').success).toBe(true);
    expect(zonaHoraria.safeParse('UTC').success).toBe(true);
  });
});

describe('hhmm', () => {
  it('minutos a "HH:MM", sin desbordarse a la decena siguiente', () => {
    expect(hhmm(0)).toBe('00:00');
    expect(hhmm(600)).toBe('10:00');
    expect(hhmm(1439)).toBe('23:59');
    // 24:00 no existe como hora de reloj.
    expect(hhmm(1440)).toBe('00:00');
  });
});
