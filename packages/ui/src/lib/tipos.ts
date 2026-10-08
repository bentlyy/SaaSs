/** Tipos que el shell comparte entre el runtime y la interfaz. */

/** Una herramienta del catálogo, como la ve la barra lateral. */
export interface Herramienta {
  slug: string;
  name: string;
  /** URL donde abrirla. Vacía si el Core no la sabe: entonces no se enlaza. */
  url: string;
}

/**
 * Lo que la UI necesita para dibujar el shell: quién entró, de qué empresa y
 * a qué herramientas puede saltar. Es la forma normalizada de `GET /api/inicio`
 * (runtime) y también la que sale de `desdeMe()` para la app de citas, que no
 * tiene ese endpoint.
 */
export interface Inicio {
  usuario: { id?: string; nombre: string; email: string };
  organizacion: { id?: string; slug: string; nombre?: string };
  rol?: string;
  /** Slug de la herramienta actual: las otras se listan para saltar. */
  herramienta?: string;
  herramientas: Herramienta[];
}

/**
 * Ajustes del producto, en forma libre: cada producto tiene los suyos y el
 * shell solo lee `timezone` (para mostrar la zona en el pie). Las páginas
 * estrechan a su propia interfaz con un cast cuando lo necesitan.
 */
export interface Ajustes {
  timezone?: string;
  [clave: string]: unknown;
}
