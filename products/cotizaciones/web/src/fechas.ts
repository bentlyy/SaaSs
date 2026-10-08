/** La fecha de hoy en `AAAA-MM-DD`, que es como el servidor la espera. */
export function hoy(): string {
  return new Date().toLocaleDateString('en-CA');
}

/** Hoy mas N dias, para proponer la vigencia de la oferta. */
export function dentroDe(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toLocaleDateString('en-CA');
}
