import { getCoreDb } from '../db/init.js';
import { platformConfig } from '../config.js';
import { createDiscount, listDiscounts, setDiscountStatus } from '../domain/discounts.js';
import { findProductBySlug } from '../domain/products.js';

/**
 * ADMINISTRACIÓN DE DESCUENTOS (ops)
 * ==================================
 *
 *   npm run discounts -w @amg/platform -- create --code PREPAID50 --kind percent --value 50 --max-redemptions 200 --per-org-limit 2 --ends-at 2026-12-31T23:59:59-03:00 --note "Lanzamiento"
 *   npm run discounts -w @amg/platform -- create --code TRIAL7 --kind trial --value 7
 *   npm run discounts -w @amg/platform -- create --code AMIGO10K --kind fixed --value 10000 --product taller
 *   npm run discounts -w @amg/platform -- list
 *   npm run discounts -w @amg/platform -- status --code PREPAID50 disabled
 *
 * Comandos:
 *
 *   create   Crea un cupón. El tipo obliga el valor:
 *              percent  -> % de descuento (1..100)
 *              fixed    -> monto fijo en la moneda (CLP)
 *              trial    -> días de prueba gratis (el producto se abre sin cobro)
 *            Opciones: --product <slug> (si falta, aplica a todo el catálogo),
 *            --currency CLP, --max-redemptions N, --per-org-limit N,
 *            --starts-at ISO, --ends-at ISO, --note "..."
 *
 *   list     Lista todos los cupones con uso total y estado.
 *
 *   status   active | disabled. Deshabilitar corta el código de inmediato sin
 *            tocar las redemptions ya hechas.
 */

const [, , sub] = process.argv;

const flag = (nombre: string): string | undefined => {
  const i = process.argv.indexOf(`--${nombre}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
};

function requireFlag(nombre: string): string {
  const valor = flag(nombre);
  if (!valor) {
    console.error(`Falta --${nombre}`);
    process.exit(2);
  }
  return valor;
}

function enteroPositivo(nombre: string): number | null {
  const valor = flag(nombre);
  if (!valor) return null;
  const n = Number.parseInt(valor, 10);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`--${nombre} debe ser un entero positivo`);
    process.exit(2);
  }
  return n;
}

getCoreDb();
console.log(`Base: ${platformConfig.dbPath}`);

try {
  if (sub === 'create') {
    const code = requireFlag('code').toUpperCase().trim();
    const kind = requireFlag('kind');
    if (!['percent', 'fixed', 'trial'].includes(kind)) {
      console.error('--kind debe ser percent | fixed | trial');
      process.exit(2);
    }

    const value = enteroPositivo('value');
    if (value === null) {
      console.error(`Falta --value (${kind === 'percent' ? '1..100' : kind === 'trial' ? 'días' : 'monto CLP'})`);
      process.exit(2);
    }

    const productSlug = flag('product');
    if (productSlug && !findProductBySlug(productSlug)) {
      console.error(`No existe el producto "${productSlug}"`);
      process.exit(2);
    }

    const cupon = createDiscount({
      code,
      kind: kind as 'percent' | 'fixed' | 'trial',
      value,
      productSlug,
      currency: flag('currency') ?? 'CLP',
      maxRedemptions: enteroPositivo('max-redemptions'),
      perOrgLimit: enteroPositivo('per-org-limit'),
      startsAt: flag('starts-at'),
      endsAt: flag('ends-at'),
      note: flag('note'),
    });

    console.log(`Cupón creado:`);
    console.log(`  código   : ${cupon.code}`);
    console.log(`  tipo     : ${cupon.kind} (${cupon.value})`);
    console.log(`  producto : ${cupon.product_slug ?? 'todo el catálogo'}`);
    console.log(`  vigencia : ${cupon.starts_at ?? 'inmediata'} → ${cupon.ends_at ?? 'sin fin'}`);
    console.log(`  topes    : ${cupon.max_redemptions ?? 'ilimitado'} usos totales · ${cupon.per_org_limit ?? 'ilimitado'} por organización`);
  } else if (sub === 'list') {
    const todos = listDiscounts();
    if (todos.length === 0) {
      console.log('No hay cupones creados todavía.');
    } else {
      console.log(`${'CÓDIGO'.padEnd(16)} ${'TIPO'.padEnd(10)} ${'VALOR'.padEnd(10)} ${'USOS'.padEnd(6)} ${'PRODUCTO'.padEnd(12)} ${'ESTADO'}`);
      for (const d of todos) {
        const usos = d.max_redemptions === null ? '/' : `${d.max_redemptions} tot·${d.per_org_limit ?? '∞'} org`;
        console.log(
          `${d.code.padEnd(16)} ${d.kind.padEnd(10)} ${String(d.value).padEnd(10)} ${usos.padEnd(6)} ${String(d.product_slug ?? '-').padEnd(12)} ${d.status}`,
        );
      }
    }
  } else if (sub === 'status') {
    const code = requireFlag('code').toUpperCase().trim();
    const estado = process.argv[process.argv.indexOf('status') + 1];
    if (estado !== 'active' && estado !== 'disabled') {
      console.error('Uso: discounts status --code <CÓDIGO> active|disabled');
      process.exit(2);
    }
    const actualizado = setDiscountStatus(code, estado);
    console.log(`Cupón ${actualizado.code} ahora está "${actualizado.status}".`);
  } else {
    console.error(`Comando desconocido: "${sub ?? '(vacío)'}". Usa create | list | status.`);
    process.exit(2);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally {
  process.exit(process.exitCode ?? 0);
}