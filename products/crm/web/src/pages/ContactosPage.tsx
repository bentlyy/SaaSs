import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Aviso,
  BotonPrimario,
  Campo,
  FilaVacia,
  PageHeader,
  Spinner,
  Tabla,
  Tarjeta,
  api,
  fecha,
  useAviso,
} from '@amg/ui';
import type { Cliente, Contacto } from '../tipos';

const ETIQUETA_CONTACTO: Record<string, string> = {
  llamada: 'Llamada',
  correo: 'Correo',
  visita: 'Visita',
  nota: 'Nota',
};

/**
 * Historial de contacto.
 *
 * No tiene edición ni borrado a propósito: una fila es la prueba de lo que pasó,
 * y se corrige agregando otra fila, no editando la vieja.
 */
export function ContactosPage() {
  const { aviso, avisar, limpiarAviso } = useAviso();

  const [contactos, setContactos] = useState<Contacto[] | null>(null);
  const [clientes, setClientes] = useState<Cliente[] | null>(null);
  const [campos, setCampos] = useState<Record<string, string>>({ customerId: '', kind: 'llamada', summary: '' });
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    const [co, c] = await Promise.all([
      api.get<{ interactions: Contacto[] }>('/interactions?limit=300'),
      api.get<{ items: Cliente[] }>('/customers?limit=500'),
    ]);
    setContactos(co.interactions);
    setClientes(c.items);
  }

  useEffect(() => {
    cargar().catch((e) => {
      if ((e as any).vencida) return;
      avisar((e as Error).message, true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const alCambiar = (ev: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setCampos((c) => ({ ...c, [ev.target.name]: ev.target.value }));

  async function registrar(ev: FormEvent) {
    ev.preventDefault();
    setGuardando(true);
    try {
      // No se manda `happenedAt`: un contacto se registra mientras pasa, y
      // anotarlo a mano solo abre la puerta a escribir el día equivocado.
      await api.post('/interactions', {
        customerId: campos.customerId,
        kind: campos.kind,
        summary: campos.summary,
      });
      setCampos((c) => ({ ...c, summary: '' }));
      await cargar();
      avisar('Contacto registrado');
    } catch (e) {
      avisar((e as Error).message, true);
    } finally {
      setGuardando(false);
    }
  }

  const nombreCliente = (id: string) => clientes?.find((c) => c.id === id)?.name || '—';

  return (
    <>
      <PageHeader titulo="Contactos" />

      <div className="grid gap-6 lg:grid-cols-2">
        <Tarjeta titulo="Historial de contacto">
          {!contactos ? (
            <Spinner />
          ) : (
            <Tabla columnas={['Cliente', 'Tipo', 'Qué pasó', 'Cuándo']}>
              {contactos.length === 0 ? (
                <FilaVacia columnas={4} texto="No hay contactos registrados" />
              ) : (
                contactos.map((co) => (
                  <tr key={co.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-800">{nombreCliente(co.customerId)}</td>
                    <td className="px-4 py-3 text-slate-500">{ETIQUETA_CONTACTO[co.kind] ?? co.kind}</td>
                    <td className="px-4 py-3 text-slate-800">{co.summary}</td>
                    <td className="px-4 py-3 text-slate-500">{fecha(co.happenedAt, true)}</td>
                  </tr>
                ))
              )}
            </Tabla>
          )}
        </Tarjeta>

        <Tarjeta titulo="Registrar un contacto">
          <form onSubmit={registrar} className="space-y-3 p-4">
            <Campo etiqueta="Cliente" name="customerId" required value={campos.customerId ?? ''} onChange={alCambiar}>
              <select
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                name="customerId"
                value={campos.customerId ?? ''}
                onChange={alCambiar}
                required
              >
                <option value="">Elegí un cliente</option>
                {(clientes ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Tipo" name="kind" required value={campos.kind ?? 'llamada'} onChange={alCambiar}>
              <select
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                name="kind"
                value={campos.kind ?? 'llamada'}
                onChange={alCambiar}
              >
                <option value="llamada">Llamada</option>
                <option value="correo">Correo</option>
                <option value="visita">Visita</option>
                <option value="nota">Nota</option>
              </select>
            </Campo>
            <Campo
              etiqueta="Qué pasó"
              name="summary"
              required
              maxLength={150}
              value={campos.summary ?? ''}
              onChange={alCambiar}
            />
            <div className="flex justify-end pt-2">
              <BotonPrimario type="submit" disabled={guardando}>
                {guardando ? 'Registrando…' : 'Registrar'}
              </BotonPrimario>
            </div>
          </form>
        </Tarjeta>
      </div>

      <Aviso mensaje={aviso?.mensaje ?? null} tono={aviso?.tono} onLimpiar={limpiarAviso} />
    </>
  );
}
