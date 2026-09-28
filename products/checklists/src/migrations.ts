import Database from 'better-sqlite3';
import { createId, hasTable, tableColumns, type Migration } from '@amg/product-runtime';

/**
 * Migraciones de checklists.
 *
 * El runtime corre las migraciones ANTES del DDL y una sola vez por version
 * (registro en `amg_migrations`). Ese orden tiene una consecuencia: una base
 * NUEVA (sin tablas) llega a la migracion vacia, y la migracion tiene que dejar
 * que el DDL haga su trabajo sin estorbar. Por eso cada paso mira primero si la
 * base es vieja o nueva con `hasTable`, y si no hay tablas, no hace nada.
 *
 * La base VIVA de este producto trae datos de la epoca sin secciones, sin tipos
 * de respuesta y sin adjuntos. La migracion les da forma SIN perder una fila:
 *
 *   - crea la tabla `sections` y mueve cada item existente a una seccion
 *     "General" de su plantilla (los items viejos eran todos de tipo `yes_no`
 *     respondidos con `ok/fail/na`, que es exactamente el default de hoy);
 *   - cambia el UNIQUE de los items de `(template_id, position)` a
 *     `(section_id, position)`, porque la posicion pasa a ser por seccion;
 *   - amplia `runs` con el veredicto global y el responsable;
 *   - amplia `run_items` con el tipo, las opciones y la respuesta concreta;
 *   - crea `attachments`.
 *
 * SQLite no permite volver NOT NULL una columna agregada con `ALTER TABLE ADD
 * COLUMN` sin recrear la tabla: en una base migrada `sections_id` queda nullable
 * a nivel del motor, pero la API nunca inserta un item sin seccion, y en una base
 * nueva el DDL la declara NOT NULL. Es el compromiso estandar de SQLite para no
 * recrear tablas con datos.
 */

/**
 * La seccion a la que van los items de una plantilla que todavia no tenia
 * ninguna. Es un nombre visible y honesto: una checklist sin grupos se revisa en
 * un solo bloque.
 */
const SECCION_GENERAL = 'General';

export const MIGRACIONES: Migration[] = [
  {
    version: 2,
    name: 'secciones, tipos de respuesta, veredicto global y adjuntos',
    up(sqlite: Database.Database) {
      // Base nueva: el DDL que corre despues crea todo con la forma actual.
      if (!hasTable(sqlite, 'templates')) return;
      const cols = (tabla: string) => tableColumns(sqlite, tabla);

      // 1. La tabla de secciones, con la misma forma que el DDL.
      if (!hasTable(sqlite, 'sections')) {
        sqlite.exec(`
          CREATE TABLE sections (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            sort_order INTEGER NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_checklists_sections_template_order ON sections(template_id, sort_order);
          CREATE INDEX IF NOT EXISTS idx_checklists_sections_org_template ON sections(organization_id, template_id);
        `);
      }

      // 2. Los items pasan a vivir dentro de una seccion.
      if (!cols('template_items').includes('section_id')) {
        sqlite.exec(`ALTER TABLE template_items ADD COLUMN section_id TEXT REFERENCES sections(id) ON DELETE CASCADE`);
        moverItemsASeccionGeneral(sqlite);
        // La posicion deja de ser global a la plantilla y pasa a ser por seccion:
        // el indice viejo no vale y estorbaria al nuevo.
        sqlite.exec(`DROP INDEX IF EXISTS idx_checklists_template_items_template_position`);
        sqlite.exec(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_checklists_template_items_section_position ON template_items(section_id, position)`,
        );
      }
      if (!cols('template_items').includes('type')) {
        sqlite.exec(`ALTER TABLE template_items ADD COLUMN type TEXT NOT NULL DEFAULT 'yes_no'`);
      }
      if (!cols('template_items').includes('options_json')) {
        sqlite.exec(`ALTER TABLE template_items ADD COLUMN options_json TEXT`);
      }

      // 3. La corrida pasa a conocer su veredicto global y a quien la hizo.
      if (!cols('runs').includes('result')) {
        sqlite.exec(`ALTER TABLE runs ADD COLUMN result TEXT`);
      }
      if (!cols('runs').includes('performed_by')) {
        sqlite.exec(`ALTER TABLE runs ADD COLUMN performed_by TEXT`);
      }

      // 4. Los puntos de la corrida guardan el tipo, las opciones y la respuesta
      //    concreta, y el enlace con el item de la plantilla del que salieron.
      if (!cols('run_items').includes('item_id')) {
        sqlite.exec(
          `ALTER TABLE run_items ADD COLUMN item_id TEXT REFERENCES template_items(id) ON DELETE SET NULL`,
        );
      }
      if (!cols('run_items').includes('type')) {
        sqlite.exec(`ALTER TABLE run_items ADD COLUMN type TEXT NOT NULL DEFAULT 'yes_no'`);
      }
      if (!cols('run_items').includes('options_json')) {
        sqlite.exec(`ALTER TABLE run_items ADD COLUMN options_json TEXT`);
      }
      if (!cols('run_items').includes('value_text')) {
        sqlite.exec(`ALTER TABLE run_items ADD COLUMN value_text TEXT`);
      }
      // Los puntos que ya se respondieron lo hicieron como `yes_no`: sus filas
      // llevan el resultado en `result`, y `value_text` (recien creada) queda
      // NULL, que es exactamente el estado de un `yes_no` respondido.

      // 5. Los adjuntos, con la misma forma que el DDL.
      if (!hasTable(sqlite, 'attachments')) {
        sqlite.exec(`
          CREATE TABLE attachments (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            filename TEXT NOT NULL,
            path TEXT NOT NULL,
            mime_type TEXT,
            size_bytes INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_checklists_attachments_org ON attachments(organization_id, run_id);
          CREATE INDEX IF NOT EXISTS idx_checklists_attachments_run ON attachments(run_id);
        `);
      }
    },
  },
];

/**
 * Da una seccion "General" a cada plantilla cuyos items pasaron sin seccion.
 *
 * Los items de la epoca anterior estaban numerados 1..N globales a la plantilla.
 * Al ponerles la seccion nueva (una por plantilla) esos numeros no chocan: dentro
 * del unico bloque de cada plantilla, 1..N sigue siendo un orden valido y el
 * UNIQUE nuevo lo acepta tal cual. El `organization_id` de la seccion es el del
 * primer item de esa plantilla; una plantilla sin items no necesita seccion y la
 * API le crea una si llega a estrenar alguno.
 */
function moverItemsASeccionGeneral(sqlite: Database.Database): void {
  const plantillas = (
    sqlite
      .prepare(
        `SELECT DISTINCT ti.template_id, t.organization_id
         FROM template_items ti JOIN templates t ON t.id = ti.template_id
         WHERE ti.section_id IS NULL`,
      )
      .all() as Array<{ template_id: string; organization_id: string }>
  );

  const insertarSeccion = sqlite.prepare(
    `INSERT INTO sections (id, organization_id, template_id, name, sort_order) VALUES (?, ?, ?, ?, 1)`,
  );
  const asignar = sqlite.prepare(`UPDATE template_items SET section_id = ? WHERE template_id = ? AND section_id IS NULL`);

  for (const { template_id, organization_id } of plantillas) {
    const seccionId = createId('sec');
    insertarSeccion.run(seccionId, organization_id, template_id, SECCION_GENERAL);
    asignar.run(seccionId, template_id);
  }
}