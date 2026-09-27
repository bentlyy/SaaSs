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

describe('aislamiento entre productos en producción', () => {
  it('declara los nueve productos, v2 incluido', () => {
    const declarados = reales.map((s) => s.nombre);
    for (const nombre of [
      'peluqueria', 'deportes', 'talleres', 'inventario', 'inventario-v2',
      'cotizaciones', 'documentos', 'recordatorios', 'crm',
    ]) {
      expect(declarados, `falta el servicio ${nombre} en docker-compose.yml`).toContain(nombre);
    }
  });

  it('no repite base, no usa rutas relativas y no saca la base de su volumen', () => {
    // Un único expect con la lista completa: si mañana falla, el mensaje dice
    // las tres cosas rotas, no "algo falló".
    expect(problemas(reales), `docker-compose.yml:\n- ${problemas(reales).join('\n- ')}`).toEqual([]);
  });

  it('landing guarda el Core en su propio volumen, no en el de un producto', () => {
    const landing = reales.find((s) => s.nombre === 'landing');
    expect(landing, 'landing no declara CORE_DB_PATH').toBeDefined();
    expect(landing!.dbPath).not.toBe(reales.find((s) => s.nombre === 'peluqueria')?.dbPath);
  });
});

describe('las reglas muerden (compose de mentira)', () => {
  const base = [
    'services:',
    '  peluqueria:',
    '    volumes:',
    '      - saasmini_data_peluqueria:/app/data/peluqueria',
    '    environment:',
    '      DB_PATH: /app/data/peluqueria/app.db',
    '  talleres:',
    '    volumes:',
    '      - saasmini_data_talleres:/app/data/talleres',
    '    environment:',
    '      DB_PATH: /app/data/talleres/app.db',
    '',
  ].join('\n');

  it('un compose sano no reporta nada', () => {
    expect(problemas(servicios(base))).toEqual([]);
  });

  it('detecta dos productos con la misma base', () => {
    const roto = base.replace('/app/data/talleres/app.db', '/app/data/peluqueria/app.db');
    expect(problemas(servicios(roto)).join()).toMatch(/base compartida/);
  });

  it('detecta una ruta relativa', () => {
    const roto = base.replace('/app/data/talleres/app.db', './data/app.db');
    expect(problemas(servicios(roto)).join()).toMatch(/relativa/);
  });

  it('detecta una base fuera de su volumen', () => {
    const roto = base.replace('DB_PATH: /app/data/talleres/app.db', 'DB_PATH: /tmp/app.db');
    expect(problemas(servicios(roto)).join()).toMatch(/fuera de su volumen/);
  });

  it('detecta volúmenes repetidos', () => {
    const roto = base.replace('saasmini_data_talleres:/app/data/talleres', 'saasmini_data_peluqueria:/app/data/talleres');
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

  it('las plantillas legacy usan la convención relativa compartida', () => {
    // No es un error: es el convenio actual, y solo vale si el proceso arranca
    // con cwd = carpeta del producto (lo que hace `npm start -w`). Se deja
    // escrito para que nadie lo lea como garantía: la garantía real es el
    // compose, que usa absolutas. `inventario-v2` queda fuera porque comparte
    // volumen con `inventario` a propósito y usa otro nombre de archivo.
    const legacy = productos.filter((p) => p !== 'inventario-v2' && p !== 'landing');
    for (const producto of legacy) {
      expect(leerEnvEjemplo(producto).DB_PATH, `products/${producto}`).toBe('./data/app.db');
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
