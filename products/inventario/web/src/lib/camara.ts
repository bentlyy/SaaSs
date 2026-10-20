/** Traduce los errores de getUserMedia a algo que se pueda leer y accionar. */
export function mensajeDeCamara(e: unknown): string {
  const nombre = (e as { name?: string })?.name ?? '';
  if (nombre === 'NotAllowedError' || nombre === 'PermissionDeniedError') {
    return 'Permiso de cámara denegado. Habilitalo en el navegador para este sitio y volvé a intentar.';
  }
  if (nombre === 'NotFoundError' || nombre === 'DevicesNotFoundError') {
    return 'No se encontró ninguna cámara en este dispositivo.';
  }
  if (nombre === 'NotReadableError' || nombre === 'TrackStartError') {
    return 'La cámara está siendo usada por otra aplicación.';
  }
  if (nombre === 'OverconstrainedError') {
    return 'La cámara no soporta la configuración pedida (se intentó la trasera).';
  }
  if (e instanceof Error && e.message === 'sin-soporte') {
    return 'Este navegador no expone la cámara. Probá con Chrome o Safari actualizados.';
  }
  return 'No se pudo iniciar la cámara. Revisá los permisos del navegador.';
}
