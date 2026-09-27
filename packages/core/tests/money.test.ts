import { describe, expect, it } from 'vitest';
import {
  MINOR_UNITS,
  formatMinor,
  formatMoney,
  fromMinor,
  minorDecimals,
  multiplyMinor,
  parseMoneyToMinor,
  toMinor,
} from '../src/money.js';

/**
 * El caso que pidio el bug original, fijo: 25000 no puede terminar en $2,50.
 * Si alguien "arregla" money.ts con una division de mas, esto falla.
 */
describe('la regla del dinero', () => {
  it('25000 centavos son $250,00 y no $2,50', () => {
    expect(fromMinor(25_000, 'USD')).toBe(250);
    expect(formatMinor(25_000, 'USD', 'en-US')).toBe('$250.00');
  });

  it('el viaje completo base -> API -> pantalla no pierde nada', () => {
    const enLaBase = 25_000; // entero, centavos
    const enLaApi = fromMinor(enLaBase, 'USD'); // el backend convierte una vez
    const enPantalla = formatMoney(enLaApi, 'USD', 'en-US'); // el frontend solo pinta
    expect(enLaApi).toBe(250);
    expect(enPantalla).toBe('$250.00');
  });

  it('guardar y leer devuelve el mismo numero', () => {
    for (const currency of Object.keys(MINOR_UNITS)) {
      for (const humano of [0, 1, 19.99, 250, 1234.56, 999_999]) {
        const guardado = toMinor(humano, currency);
        expect(Number.isInteger(guardado)).toBe(true);
        // Una moneda sin subdivision no puede guardar 19,99: el dato se pierde en
        // la conversion, no se "guarda casi". El techo es 20. No es un bug de
        // redondeo, es que el centimo no existe.
        const attendu = minorDecimals(currency) === 0 ? Math.round(humano) : humano;
        expect(fromMinor(guardado, currency)).toBeCloseTo(attendu, 6);
      }
    }
  });
});

describe('decimales por moneda', () => {
  it('el peso chileno no tiene centavos', () => {
    expect(minorDecimals('CLP')).toBe(0);
    expect(toMinor(18_500, 'CLP')).toBe(18_500); // $18.500, no 1.850.000
  });

  it('el dollar si, y por eso ahi es donde se dividia dos veces', () => {
    expect(minorDecimals('USD')).toBe(2);
    expect(toMinor(18_500, 'USD')).toBe(1_850_000);
  });

  it('es tolerante a mayusculas y a una moneda desconocida', () => {
    expect(minorDecimals('usd')).toBe(2);
    expect(minorDecimals('xyz')).toBe(2);
  });
});

describe('formatMoney no convierte', () => {
  it('pinta lo que le dan, sin secretly dividir', () => {
    // Si alguien mete una conversion aqui, este test lo delata.
    expect(formatMoney(250, 'USD', 'en-US')).toBe('$250.00');
    expect(formatMoney(120, 'CLP', 'es-CL')).toContain('120');
  });

  it('un numero roto muestra 0 en vez de "NaN" en pantalla', () => {
    expect(formatMoney(Number.NaN, 'USD', 'en-US')).toBe('$0.00');
    expect(formatMoney(Number.POSITIVE_INFINITY, 'CLP', 'es-CL')).toContain('0');
  });
});

describe('multiplicar sin perder centavos', () => {
  it('total de linea se queda en unidades menores', () => {
    expect(multiplyMinor(12_000, 3)).toBe(36_000);
    // El error clasico: 120.00 * 3 = 360.00 -> guardar 360 y leer 3,60.
    const precio = toMinor(120, 'USD');
    const total = multiplyMinor(precio, 3);
    expect(fromMinor(total, 'USD')).toBe(360);
  });

  it('rechaza una cantidad fraccionaria', () => {
    expect(() => multiplyMinor(100, 1.5)).toThrow(/cantidad/);
  });
});

describe('leer el precio de un formulario', () => {
  it('vacio es 0, no NaN', () => {
    expect(parseMoneyToMinor('', 'USD')).toBe(0);
    expect(parseMoneyToMinor(null, 'USD')).toBe(0);
    expect(parseMoneyToMinor('abc', 'USD')).toBe(0);
  });

  it('acepta coma decimal, que es lo que escribe un teclado chileno', () => {
    expect(parseMoneyToMinor('19,90', 'USD')).toBe(1990);
    expect(parseMoneyToMinor('19.90', 'USD')).toBe(1990);
  });
});

describe('formatMinor para lo que sale de la base sin endpoint', () => {
  it('convierte una vez y pinta', () => {
    expect(formatMinor(1_850_000, 'USD', 'en-US')).toBe('$18,500.00');
    expect(formatMinor(18_500, 'CLP', 'es-CL')).toContain('18.500');
  });
});
