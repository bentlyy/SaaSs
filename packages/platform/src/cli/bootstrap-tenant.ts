import { getCoreDb } from '../db/init.js';
import { ensurePlatformSeed, EXPECTED_SLUGS } from '../seed.js';
import { hashPassword } from '../auth/passwords.js';
import { createOrganization, findOrganizationBySlug, setOrganizationStatus } from '../domain/organizations.js';
import { createUser, findUserByEmail, setUserStatus } from '../domain/users.js';
import { createMembership, findMembership } from '../domain/memberships.js';
import { createSubscription, hasActiveSubscription } from '../domain/subscriptions.js';
import { requireProductBySlug } from '../domain/products.js';
import { isRole, type Role } from '../domain/roles.js';

/**
 * Da de alta una empresa real en el Core: organizacion, usuario con contrasena,
 * membresia y suscripcion a los productos que se pidan.
 *
 *   npm run bootstrap -w @amg/platform -- --slug talleres-el-mecanico \
 *     --name "Talleres El Mecanico" --email demo@talleres.com --role owner
 *
 * La contrasena NO va en la linea de comandos (queda en el historial del shell y
 * en `ps` de todo el mundo). Va en la variable `AMG_BOOTSTRAP_PASSWORD`, que el
 * deploy escribe en el `.env` del servidor con permisos 600.
 *
 * IDEMPOTENTE, y eso no es un detalle: `deploy.sh` lo corre en cada despliegue.
 * Sin idempotencia, el segundo deploy crearia una organizacion duplicada, un
 * segundo usuario con el mismo correo, y las migraciones—which resuelven la
 * organizacion por slug— ya no encontrarian la de siempre.
 *
 * Que sea idempotente NO significa que no avise: al final imprime que hizo y que
 * encontro, para que un despliegue que no hizo lo que se esperaba se note en el
 * log y no tres semanas despues.
 */

function bandera(nombre: string): string | undefined {
  const args = process.argv.slice(2);
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 ? args[i + 1] : undefined;
}

const slug = bandera('slug');
const name = bandera('name');
const email = bandera('email');
const role = (bandera('role') ?? 'owner') as Role;
const soloProductos = bandera('productos');
const password = process.env.AMG_BOOTSTRAP_PASSWORD;

if (!slug || !name || !email) {
  console.error('Uso: bootstrap-tenant --slug <slug> --name <nombre> --email <correo> [--role owner|admin|member] [--productos a,b,c]');
  console.error('La contrasena va en AMG_BOOTSTRAP_PASSWORD, no en la linea de comandos.');
  process.exit(1);
}
if (!isRole(role)) {
  console.error(`Rol desconocido: ${role}. Validos: owner, admin, member.`);
  process.exit(1);
}
if (!password) {
  // Fallar aqui y no a mitad es lo importante: una organizacion creada sin
  // usuario se descubre cuando alguien intenta entrar y no puede.
  console.error('Falta AMG_BOOTSTRAP_PASSWORD. No se crea nada.');
  process.exit(1);
}
if (password.length < 12) {
  console.error(`La contrasena tiene ${password.length} caracteres y el minimo son 12. No se crea nada.`);
  process.exit(1);
}

getCoreDb();
ensurePlatformSeed();

const productos = soloProductos
  ? soloProductos.split(',').map((s) => s.trim()).filter(Boolean)
  : [...EXPECTED_SLUGS];

console.log(`\n  Empresa: ${name}  (${slug})\n`);

// ── Organizacion ───────────────────────────────────────────────────────────
let org = findOrganizationBySlug(slug);
let orgAccion: string;
if (org) {
  if (org.name !== name) {
    console.warn(`  [warn] la organizacion ${slug} ya existe con el nombre "${org.name}", no "${name}".`);
    console.warn(`         Se conserva el nombre existente: renombrarla a mano si el nombre nuevo es el bueno.`);
  }
  if (org.status !== 'active') {
    setOrganizationStatus(org.id, 'active');
    orgAccion = 'reactivada';
  } else {
    orgAccion = 'ya existia';
  }
} else {
  org = createOrganization({ name, slug });
  orgAccion = 'creada';
}
console.log(`  organizacion  ${org.name} (${org.slug})  -> ${orgAccion}`);

// ── Usuario ────────────────────────────────────────────────────────────────
let user = findUserByEmail(email);
let userAccion: string;
if (user) {
  // La contrasena NO se toca a proposito. Este comando es idempotente y se corre
  // en cada deploy: si tocara la contrasena, un despliegue restaurado desde un
  // `.env` viejo dejaria a los usuarios sin poder entrar, y nadie se entera hasta
  // que alguien intenta iniciar sesion. Cambiarla es una operacion explicita.
  if (user.status !== 'active') {
    setUserStatus(user.id, 'active');
    userAccion = 'reactivado (sin tocar su contrasena)';
  } else {
    userAccion = 'ya existia';
  }
} else {
  user = createUser({ name, email, passwordHash: await hashPassword(password), emailVerifiedAt: new Date().toISOString() });
  userAccion = 'creado';
}
console.log(`  usuario       ${user.email}  -> ${userAccion}`);

// ── Membresia ──────────────────────────────────────────────────────────────
const membresia = findMembership(user.id, org.id);
if (membresia) {
  console.log(`  membresia     ${membresia.role}  -> ya existia`);
} else {
  const creada = createMembership({ userId: user.id, organizationId: org.id, role });
  console.log(`  membresia     ${creada.role}  -> creada`);
}

// ── Suscripciones ──────────────────────────────────────────────────────────
let creadas = 0;
let yaHabia = 0;
const fallidas: string[] = [];
for (const s of productos) {
  let product;
  try {
    product = requireProductBySlug(s);
  } catch (e) {
    // Un slug que no esta en el catalogo no se puede suscribir. Se anota y se
    // sigue con los demas: un producto que falta no debe impedir dar de alta la
    // empresa entera, que es lo que el operador quiere.
    fallidas.push(`${s} (no esta en el catalogo)`);
    continue;
  }
  if (hasActiveSubscription(org.id, s)) {
    yaHabia++;
    continue;
  }
  createSubscription({ organizationId: org.id, productId: product.id, status: 'active', activate: true });
  creadas++;
}
console.log(`  suscripciones ${creadas} creada(s), ${yaHabia} ya existia(n)`);
if (fallidas.length > 0) {
  console.log(`  [warn] no se pudieron suscribir: ${fallidas.join(', ')}`);
  if (creadas === 0 && yaHabia === 0) {
    console.error('\n  Ningun producto quedo suscrito. Revisar el catalogo.\n');
    process.exit(1);
  }
}

console.log(`\n  Listo. Entrar con ${email} y la contrasena que esta en AMG_BOOTSTRAP_PASSWORD.\n`);
