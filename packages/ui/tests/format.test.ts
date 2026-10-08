import { describe, expect, it } from 'vitest';
import { dinero, fecha, iniciales, numero } from '../src/lib/format';

/**
 * El formato compartido contra un caso de verdad.
 *
 * Estas funciones las usa cada pantalla para pintar montos y fechas: un cambio
 * aca no revienta un test de backend, se ve como una cifra sin formato, una
 * hora corrida o un signo de menos en el lado equivocado. El port cubre los
 * mismos casos que protegia el formateador del shell viejo.
 */

describe('dinero', () => {
  it('formatea centavos enteros sin decimales de mas', () => {
    expect(dinero(1453000)).toBe('$14.530');
    expect(dinero(12000, { minimumFractionDigits: 2 })).toBe('$120,00');
  });

  it('respeta el simbolo de la organizacion', () => {
    expect(dinero(50000, 'CLP$')).toBe('CLP$500');
  });

  it('negativos salen con el signo delante', () => {
    expect(dinero(-50000)).toBe('-$500');
  });

  it('vacio pinta cero y no revienta', () => {
    expect(dinero(null)).toBe('$0');
    expect(dinero(undefined)).toBe('$0');
  });
});

describe('fecha', () => {
  it('pinta el dia en la zona pedida, no la del navegador', () => {
    // 2026-10-06T04:00Z: en Mexico City (UTC-6 fijo) son las 22:00 del 5,
    // y es-CL escribe la hora en formato 12h: "10:00 p. m." (con un espacio
    // angosto U+202F entre "p." y "m.", por eso el regex y no un toContain).
    const enCdmx = fecha('2026-10-06T04:00:00.000Z', true, 'America/Mexico_City');
    expect(enCdmx).toContain('5');
    expect(enCdmx).toContain('10:00');
    expect(enCdmx).toMatch(/p\.\s*m\./);
    expect(enCdmx).not.toContain('04');
  });

  it('sin hora devuelve solo el dia', () => {
    const soloDia = fecha('2026-10-06T04:00:00.000Z', false, 'America/Mexico_City');
    expect(soloDia).toContain('2026');
    expect(soloDia).not.toMatch(/\d{2}:\d{2}/);
  });

  it('lo que no es fecha se devuelve tal cual, y lo vacio da vacio', () => {
    expect(fecha('ayer')).toBe('ayer');
    expect(fecha(null)).toBe('');
  });
});

describe('iniciales', () => {
  it('toma la primera letra de las dos primeras palabras reales', () => {
    expect(iniciales('Deportes y Salud')).toBe('DS');
    expect(iniciales('Maria Jose Rojas')).toBe('MJ');
  });

  it('las palabras de relleno no cuentan', () => {
    expect(iniciales('de la Vega')).toBe('VE');
  });

  it('sin nombre hay un signo, no un error', () => {
    expect(iniciales('')).toBe('?');
    expect(iniciales(null)).toBe('?');
  });
});

describe('numero', () => {
  it('separa los miles y marca lo que no viene', () => {
    expect(numero(1500)).toBe('1.500');
    expect(numero(null)).toBe('—');
  });
});
