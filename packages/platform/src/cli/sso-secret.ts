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
/**
 * Imprime SOLO el secreto, en una linea, sin nada mas.
 *
 * Es para `ops/deploy.sh`, que tiene que escribir nueve secretos en el `.env` del
 * servidor y no debe hacerlo parseando la salida humana de arriba: en cuanto ese
 * formato cambia (una linea de mas, una traduccion), el deploy sigue funcionando
 * y escribe un secreto ROTO en el `.env`, y el sintoma es que un producto no
 * entra y no dice por que. Con un modo de una sola linea, o sale el secreto o
 * falla el deploy.
 */
const soloSecreto = args.includes('--solo-secreto');

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

if (soloSecreto) {
  process.stdout.write(client.secret);
  process.exit(0);
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
console.log(`    CORE_URL=${process.env.CORE_URL ?? 'https://desarrollo.amgdeveloper.cl'}`);
console.log('');
