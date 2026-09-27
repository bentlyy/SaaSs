import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, isAbsolute, sep } from 'node:path';

/**
 * AISLAMIENTO ENTRE PRODUCTOS: UNA BASE POR PRODUCTO
 * ==================================================
 *
 * El aislamiento entre organizaciones lo da `tenant_id` dentro de una base. El
 * aislamiento entre PRODUCTOS es otra cosa: no existe columna que lo separe, es
 * que cada producto tiene su propio archivo de base. Si dos productos se
 * apuntan al mismo archivo, sus tenants se mezclan y no hay ninguna consulta
 * rota que lo delate: el SQL es correcto, la base equivocada.
 *
 * Ese error no se detecta leyendo el código, se detecta mirando las rutas. Y
 * las rutas viven en dos sitios que se desincronizan solos: `docker-compose.yml`
 * (producción) y los `.env.example` de cada producto (desarrollo).
 *
 * El archivo se lee, pero no se toca. Mutar el compose real para comprobar que
 * estas aserciones muerden sería fácil y sería una tontería: el compose tiene
 * cambios sin commitear y un `git checkout` para deshacer la mutación se lleva
 * trabajo ajeno. En vez de eso las reglas se evalúan contra YAML de mentira,
 * abajo, y se verifica que cada regla SALTA cuando debe. Un test de seguridad
 * del que nunca se ha visto fallar no es un test de seguridad: es un comentario.
 */

const RAIZ = resolve(import.meta.dirname, '..', '..', '..');

interface Servicio { nombre: string; volumen: string; rutaVolumen: string; dbPath: string }

/**
 * Extrae nombre, volumen y DB_PATH por servicio. Se parte por servicio de nivel
 * superior en vez de por líneas sueltas, porque si no un DB_PATH se asocia al
 * servicio ANTERIOR: que es exactamente como dos productos acaban compartiendo
 * base sin que nadie lo note en el diff.
 */
export function servicios(yaml: string): Servicio[] {
  const salida: Servicio[] = [];
  const bloques = yaml.split(/\n {2}(?=\S)/);
  for (const bloque of bloques) {
    // El corte se come los dos espacios del sangrado: el nombre queda al
    // principio del bloque.
    const nombre = bloque.match(/^([a-z0-9-]+):\s*$/m)?.[1];
    if (!nombre) continue;
    const dbPath = bloque.match(/^\s+CORE_DB_PATH:\s*(\S+)\s*$/m)?.[1]
      ?? bloque.match(/^\s+DB_PATH:\s*(\S+)\s*$/m)?.[1];
    if (!dbPath) continue;
    const vol = bloque.match(/^\s+-\s*(saasmini_data_\w+):(\S+)\s*$/m);
    salida.push({
      nombre,
      dbPath,
      volumen: vol?.[1] ?? '',
      rutaVolumen: vol?.[2] ?? '',
    });
  }
  return salida;
}

/** Reglas de aislamiento entre productos. Devuelve los incumplimientos. */
export function problemas(servs: Servicio[]): string[] {
  const fallos: string[] = [];

  for (const s of servs) {
    if (!isAbsolute(s.dbPath)) {
      fallos.push(`${s.nombre}: DB_PATH relativa (${s.dbPath}); con otro cwd abriría el archivo de otro producto`);
    }
    if (!s.volumen) {
      fallos.push(`${s.nombre}: sin volumen con nombre, su base no sobrevive a un down -v`);
    } else if (!s.dbPath.startsWith(s.rutaVolumen)) {
      fallos.push(`${s.nombre}: la base ${s.dbPath} está fuera de su volumen ${s.rutaVolumen}`);
    }
  }

  const porRuta = new Map<string, string[]>();
  for (const s of servs) {
    const clave = s.dbPath.replace(/\//g, sep);
    porRuta.set(clave, [...(porRuta.get(clave) ?? []), s.nombre]);
  }
  for (const [ruta, productos] of porRuta) {
    if (productos.length > 1) fallos.push(`base compartida ${ruta} por ${productos.join(' y ')}`);
  }

  const vols = servs.map((s) => s.volumen).filter(Boolean);
  if (new Set(vols).size !== vols.length) {
    const repetidos = [...new Set(vols.filter((v, i) => vols.indexOf(v) !== i))];
    fallos.push(`volúmenes repetidos: ${repetidos.join(', ')}`);
  }

  return fallos;
}

const compose = readFileSync(join(RAIZ, 'docker-compose.yml'), 'utf8');
const reales = servicios(compose);

/** Los nueve, y el Core. Este es el contrato de despliegue. */
const LOS_NUEVE = [
  'espacios', 'citas', 'inventario', 'solicitudes', 'cotizaciones',
  'clientes', 'activos', 'checklists', 'pagos',
];

/**
 * Los que YA están sobre el runtime y tienen su compose definitivo.
 *
 * SeVa llenando producto por producto. El día del último, esta lista es igual a
 * `LOS_NUEVE` y `catalog.test.ts` pasa a ser el que hace cumplir el número. Se
 * separan para que cada commit quede con sus pruebas en verde: un test rojo en
 * un commit intermedio entrena al equipo a ignorar los tests rojos.
 */
const NAVEGAN_AHORA = ['inventario', 'citas', 'espacios', 'solicitudes'];

/**
 * Producto retirado -> el slug que lo absorbe. Mismo mapa que `RETIRED_SLUGS` en
 * packages/platform/src/seed.ts, que se copia en vez de importarse para que este
 * test no dependa de la plataforma.
 */
const RETIRADO_ABSORBIDO_POR: Record<string, string> = {
  'inventario-v2': 'inventario',
  peluqueria: 'citas',
  deportes: 'espacios',
  talleres: 'solicitudes',
  crm: 'clientes',
  documentos: 'cotizaciones',
  recordatorios: 'citas',
};

/**
 * El bloque de un servicio, para poder mirarle el environment.
 *
 * OJO: el corte de arriba se COME los dos espacios del sangrado, así que un
 * bloque empieza en `nombre:`, no en `  nombre:`.
 */
function bloqueDe(nombre: string): string {
  return compose.split(/\n {2}(?=\S)/).find((b) => b.startsWith(`${nombre}:`)) ?? '';
}

describe('aislamiento entre productos en producción', () => {
  it('declara cada producto ya migrado y el Core', () => {
    const declarados = reales.map((s) => s.nombre);
    for (const nombre of [...NAVEGAN_AHORA, 'landing']) {
      expect(declarados, `falta el servicio ${nombre} en docker-compose.yml`).toContain(nombre);
    }
  });

  it('cada producto retirado desaparece en cuanto su reemplazo está en el aire', () => {
    // El viejo puede quedarse mientras su reemplazo no exista — es lo que evita
    // dejar a un cliente sin servicio a mitad de la migración. Pero en cuanto el
    // nuevo está arriba, los dos a la vez son un incidente: dos puertas, dos
    // dominios y dos bases para el mismo producto.
    const declarados = reales.map((s) => s.nombre);
    for (const [viejo, nuevo] of Object.entries(RETIRADO_ABSORBIDO_POR)) {
      if (!NAVEGAN_AHORA.includes(nuevo)) continue;
      expect(declarados, `${viejo} sigue en el compose y ${nuevo} ya lo reemplaza`).not.toContain(viejo);
    }
  });

  it('cada producto migrado tiene su base con el nombre del slug', () => {
    for (const slug of NAVEGAN_AHORA) {
      const servicio = reales.find((s) => s.nombre === slug);
      expect(servicio, `falta el servicio ${slug}`).toBeDefined();
      expect(
        servicio!.dbPath.endsWith(`/${slug}.sqlite`),
        `${slug} guarda su base en ${servicio!.dbPath} y se espera ${slug}.sqlite`,
      ).toBe(true);
    }
  });

  it('no repite base, no usa rutas relativas y no saca la base de su volumen', () => {
    // Un único expect con la lista completa: si mañana falla, el mensaje dice
    // las tres cosas rotas, no "algo falló".
    expect(problemas(reales), `docker-compose.yml:\n- ${problemas(reales).join('\n- ')}`).toEqual([]);
  });

  it('el Core guarda su base en su propio volumen, no en el de un producto', () => {
    const landing = reales.find((s) => s.nombre === 'landing');
    expect(landing, 'landing no declara CORE_DB_PATH').toBeDefined();
    expect(landing!.dbPath.endsWith('core.sqlite')).toBe(true);
    for (const slug of NAVEGAN_AHORA) {
      expect(landing!.dbPath).not.toBe(reales.find((s) => s.nombre === slug)?.dbPath);
    }
  });

  it('ningún producto migrado declara un JWT propio', () => {
    // La identidad es del Core, por SSO. Un JWT_SECRET por producto es la firma
    // de un producto que todavía tiene su propio login, que es exactamente lo
    // que esta arquitectura elimina.
    for (const slug of NAVEGAN_AHORA) {
      expect(bloqueDe(slug), `${slug} declara JWT_SECRET`).not.toMatch(/JWT_SECRET/);
      expect(bloqueDe(slug), `${slug} no declara su client_id de SSO`).toMatch(/AMG_SSO_CLIENT_ID/);
      expect(bloqueDe(slug), `${slug} no apunta al Core`).toMatch(/CORE_URL: https:\/\/desarrollador\.amgdeveloper\.cl/);
    }
  });

  it('ningún producto migrado monta la lista de clientes', () => {
    // clients.json era la puerta de los legacy. Sobre el runtime la puerta es
    // la suscripción en el Core; si un producto vuelve a montarlo, tiene dos
    // puertas y no se sabe cuál manda.
    for (const slug of NAVEGAN_AHORA) {
      expect(bloqueDe(slug), `${slug} monta clients.json`).not.toMatch(/clients\.json/);
    }
  });
});

describe('las reglas muerden (compose de mentira)', () => {
  const base = [
    'services:',
    '  citas:',
    '    volumes:',
    '      - saasmini_data_citas:/app/data',
    '    environment:',
    '      DB_PATH: /app/data/citas.sqlite',
    '  solicitudes:',
    '    volumes:',
    '      - saasmini_data_solicitudes:/app/data',
    '    environment:',
    '      DB_PATH: /app/data/solicitudes.sqlite',
    '',
  ].join('\n');

  it('un compose sano no reporta nada', () => {
    expect(problemas(servicios(base))).toEqual([]);
  });

  it('detecta dos productos con la misma base', () => {
    const roto = base.replace('/app/data/solicitudes.sqlite', '/app/data/citas.sqlite');
    expect(problemas(servicios(roto)).join()).toMatch(/base compartida/);
  });

  it('detecta una ruta relativa', () => {
    const roto = base.replace('/app/data/solicitudes.sqlite', './data/app.db');
    expect(problemas(servicios(roto)).join()).toMatch(/relativa/);
  });

  it('detecta una base fuera de su volumen', () => {
    const roto = base.replace('DB_PATH: /app/data/solicitudes.sqlite', 'DB_PATH: /tmp/app.db');
    expect(problemas(servicios(roto)).join()).toMatch(/fuera de su volumen/);
  });

  it('detecta volúmenes repetidos', () => {
    const roto = base.replace('saasmini_data_solicitudes:/app/data', 'saasmini_data_citas:/app/data');
    expect(problemas(servicios(roto)).join()).toMatch(/volúmenes repetidos/);
  });
});

describe('desarrollo: el cwd es la única garantía, y hay que saberlo', () => {
  const productos = readdirSync(join(RAIZ, 'products'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  function leerEnvEjemplo(producto: string): Record<string, string> {
    const ruta = join(RAIZ, 'products', producto, '.env.example');
    if (!existsSync(ruta)) return {};
    const salida: Record<string, string> = {};
    for (const linea of readFileSync(ruta, 'utf8').split(/\r?\n/)) {
      const m = linea.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) salida[m[1]] = m[2].trim();
    }
    return salida;
  }

  it('ningún producto declara la base compartida de la raíz del repo', () => {
    for (const producto of productos) {
      const env = leerEnvEjemplo(producto);
      const declarada = env.DB_PATH ?? env.CORE_DB_PATH;
      if (!declarada) continue;
      expect(
        isAbsolute(declarada) || declarada.startsWith('./data/'),
        `products/${producto} declara ${declarada}, que no apunta dentro de su propia carpeta data/`,
      ).toBe(true);
    }
  });

  it('ningún producto migrado usa el app.db compartido en desarrollo', () => {
    // `./data/app.db` era el convenio legacy y era la trampa: dos productos con el
    // cwd equivocado abrían el MISMO archivo. En la arquitectura final cada
    // producto escribe un archivo con su nombre, así que un cwd equivocado abre
    // otra base en vez de la del vecino.
    //
    // Solo se mira lo migrado: los legacy siguen con la convención vieja
    // mientras su reemplazo no exista, y eso es lo que se está migrando.
    for (const producto of NAVEGAN_AHORA) {
      const declarada = leerEnvEjemplo(producto).DB_PATH;
      if (!declarada) continue;
      expect(declarada, `products/${producto} sigue en el app.db compartido`).not.toBe('./data/app.db');
      expect(declarada, `products/${producto} sigue en el app.db compartido`).not.toBe('data/app.db');
    }
  });

  it('el data/app.db de la raíz existe: la huella del cwd incorrecto', () => {
    // Si este archivo aparece, es que algún proceso abrió la base desde la raíz
    // en vez de desde la carpeta de su producto. No se falla el test porque la
    // raíz también es el DB_PATH por defecto de la suite de tests; se registra
    // aquí para que no se descubra de nuevo por un `cat` casual.
    const raiz = join(RAIZ, 'data', 'app.db');
    if (!existsSync(raiz)) return;
    expect(readFileSync(raiz).byteLength).toBeGreaterThan(0);
  });
});
