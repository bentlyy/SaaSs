import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Aviso,
  BotonPrimario,
  BotonSecundario,
  Campo,
  NotaError,
  PageHeader,
  Tarjeta,
  api,
  useApp,
  useAviso,
} from '@amg/ui';
import type { AjustesInventario } from '../tipos';

/**
 * Ajustes del almacén.
 *
 * La razón social y los contactos se editan en AMG, no acá: están en el Core, y
 * duplicarlos sería garantizar que se desincronicen.
 */
export function ConfiguracionPage() {
  const { settings, recargarSettings, cuenta } = useApp();
  const { aviso, avisar, limpiarAviso } = useAviso();

  const ajustes = (settings ?? null) as AjustesInventario | null;
  const admin = cuenta?.rol === 'admin' || cuenta?.rol === 'owner';
  const puedeSembrar = !!admin && !!ajustes?.seedAvailable;

  const [campos, setCampos] = useState({ defaultUnit: '', defaultMinQuantity: '', currency: '' });
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Se rellena desde la API en cada recarga; el form es controlado para poder
  // validar y para que un error de guardado no borre lo que se escribió.
  useEffect(() => {
    if (!ajustes) return;
    setCampos({
      defaultUnit: ajustes.defaultUnit ?? '',
      defaultMinQuantity: String(ajustes.defaultMinQuantity ?? 0),
      currency: ajustes.currency ?? '$',
    });
  }, [ajustes]);

  const alCambiar = (ev: ChangeEvent<HTMLInputElement>) =>
    setCampos((c) => ({ ...c, [ev.target.name]: ev.target.value }));

  async function guardar(ev: FormEvent) {
    ev.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      await api.put('/settings', {
        defaultUnit: campos.defaultUnit,
        defaultMinQuantity: Number(campos.defaultMinQuantity),
        currency: campos.currency,
      });
      await recargarSettings();
      avisar('Cambios guardados');
    } catch (e) {
      // El error se muestra junto al form, no en un aviso volador: es un
      // problema de un campo y la persona lo tiene a la vista.
      setError(e instanceof Error ? e.message : 'No se pudieron guardar los cambios');
    } finally {
      setGuardando(false);
    }
  }

  async function sembrar() {
    if (!confirm('Cargar artículos de ejemplo en esta organización?')) return;
    try {
      const r = await api.post<{ creados?: number; nota?: string }>('/seed');
      avisar(r.creados ? `Se cargaron ${r.creados} artículos de ejemplo.` : (r.nota ?? 'Listo'));
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudieron cargar los ejemplos', true);
    }
  }

  return (
    <>
      <PageHeader titulo="Ajustes" subtitulo="Preferencias del inventario" />

      <Tarjeta titulo="Ajustes del almacén" className="max-w-xl">
        <form onSubmit={guardar} className="space-y-4 p-4">
          <Campo
            etiqueta="Unidad por defecto al cargar un artículo"
            name="defaultUnit"
            required
            value={campos.defaultUnit}
            onChange={alCambiar}
          />
          <Campo
            etiqueta="Stock mínimo por defecto"
            name="defaultMinQuantity"
            type="number"
            min={0}
            step={1}
            required
            value={campos.defaultMinQuantity}
            onChange={alCambiar}
          />
          <Campo
            etiqueta="Símbolo de moneda"
            name="currency"
            maxLength={5}
            required
            value={campos.currency}
            onChange={alCambiar}
          />

          <NotaError mensaje={error} />

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            {puedeSembrar ? (
              <BotonSecundario type="button" onClick={sembrar}>
                Cargar datos de ejemplo
              </BotonSecundario>
            ) : null}
            <BotonPrimario type="submit" disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar cambios'}
            </BotonPrimario>
          </div>
        </form>
      </Tarjeta>

      <Aviso mensaje={aviso?.mensaje ?? null} tono={aviso?.tono} onLimpiar={limpiarAviso} />
    </>
  );
}
