import { confirmCheckout } from '../billing/checkout.js';
import { proveedoresRegistrados } from '../billing/index.js';
import { billingProviders } from '../db/schema.js';
import { getCoreDb } from '../db/init.js';
import { platformConfig } from '../config.js';

/**
 * CONFIRMAR UN PAGO (ops)
 * =======================
 *
 *   npm run billing:confirm -w @amg/platform -- transfer tr-a1b2c3
 *
 * Por que esto es una CLI y NO un endpoint:
 *
 * La confirmación es la que ABRE el producto. Si fuera un endpoint con la
 * sesion del cliente, el cliente podria confirmar su propio pago, o sea
 * electrolumbrarse gratis con un curl. Un endpoint de confirmacion tiene que
 * estar autenticado por la PASARELA (webhook firmado), y una pasarela de
 * transferencia en la mano no firma nada: su unica garantia es que una persona
 * de confianza mire la cuenta bancaria. Esa persona es ops, y la herramienta
 * que usa es esta.
 *
 * Cuando exista Stripe, la confirmacion llega por webhook con firma, y esta
 * CLI pasa a ser el camino de emergencia/manual, no el principal.
 */

const [, , proveedorArg, referenciaArg] = process.argv;

if (!proveedorArg || !referenciaArg) {
  console.error('Uso: npm run billing:confirm -w @amg/platform -- <proveedor> <referencia>');
  console.error('');
  console.error(`  proveedores permitidos en la base : ${billingProviders.join(', ')}`);
  console.error(`  proveedores que pueden cobrar    : ${proveedoresRegistrados().join(', ')}`);
  console.error('');
  console.error('Ejemplo:');
  console.error('  npm run billing:confirm -w @amg/platform -- transfer tr-a1b2c3d4');
  process.exit(2);
}

if (!(billingProviders as readonly string[]).includes(proveedorArg)) {
  console.error(`"${proveedorArg}" no es un proveedor válido.`);
  process.exit(2);
}

const provider = proveedorArg as (typeof billingProviders)[number];

getCoreDb();
console.log(`Base: ${platformConfig.dbPath}`);

try {
  const resultado = await confirmCheckout({ provider, providerReference: referenciaArg });

  if (resultado.yaConfirmado) {
    console.log(`Ese pago ya estaba confirmado. No se hizo nada nuevo.`);
  } else {
    console.log(`Pago confirmado.`);
  }
  console.log(`  suscripción : ${resultado.subscription.id} (${resultado.subscription.status})`);
  console.log(`  producto    : ${resultado.payment.product_id ?? '-'}`);
  console.log(`  monto       : ${resultado.payment.amount} ${resultado.payment.currency}`);
  console.log(`  vence       : ${resultado.subscription.current_period_end ?? 'sin fecha'}`);
  console.log('');
  console.log('Verifica contra el comprobante bancario ANTES de correr esto.');
  console.log('Este comando no verifica nada por sí mismo: confía en quien lo ejecuta.');
} catch (err) {
  const mensaje = err instanceof Error ? err.message : String(err);
  console.error(`No se pudo confirmar: ${mensaje}`);
  console.error('');
  console.error('Si el pago NO aparece en la base, el cliente aún no pagó según el sistema.');
  console.error('Si aparece pero con otro monto, no lo fuerces: revisa el acuerdo.');
  process.exitCode = 1;
} finally {
  process.exit(process.exitCode ?? 0);
}
