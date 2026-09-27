import { getCoreDb } from '../db/init.js';
import { ensurePlatformSeed } from '../seed.js';
import { ensureSsoClient, findSsoClient, rotateSsoClientSecret } from '../sso/registry.js';

/**
 * Imprime (o rota) el secreto SSO de un producto, para ponerlo en su .env:
 *
 *   npm run sso:secret -w @amg/platform -- inventario
 *   npm run sso:secret -w @amg/platform -- inventario --rotate
 *
 * Con `--rotate` el secreto anterior deja de servir al instante, así que hay que
 * reiniciar el producto con el nuevo valor en AMG_SSO_CLIENT_SECRET.
 */
const args = process.argv.slice(2);
const productSlug = args.find((a) => !a.startsWith('--'));
const rotate = args.includes('--rotate');

if (!productSlug) {
  console.error('Uso: npm run sso:secret -w @amg/platform -- <producto> [--rotate]');
  process.exit(1);
}

getCoreDb();
ensurePlatformSeed();

const existing = findSsoClient(productSlug);
const client = rotate ? rotateSsoClientSecret(productSlug) : existing ?? ensureSsoClient(productSlug);
if (!client) {
  console.error(`No existe el cliente SSO "${productSlug}". ¿Está el producto en el catálogo?`);
  process.exit(1);
}

console.log('');
console.log(`  cliente_id     ${client.clientId}`);
console.log(`  nombre         ${client.name}`);
console.log(`  client_secret  ${client.secret}`);
console.log(`  redirect_uris  ${client.redirectUris.join('\n                 ') || '(ninguno: el producto no tiene app_url)'}`);
console.log('');
console.log('  En el .env del producto:');
console.log(`    AMG_SSO_CLIENT_ID=${client.clientId}`);
console.log(`    AMG_SSO_CLIENT_SECRET=${client.secret}`);
console.log(`    CORE_URL=${process.env.CORE_URL ?? 'https://desarrollador.amgdeveloper.cl'}`);
console.log('');
