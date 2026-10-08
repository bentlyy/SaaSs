import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import {
  Aviso,
  BotonChico,
  BotonPrimario,
  Buscador,
  Etiqueta,
  FilaVacia,
  PageHeader,
  Select,
  Spinner,
  Tabla,
  Tarjeta,
  api,
  estadoDe,
  useApp,
  useAviso,
} from '@amg/ui';
import { ActivoDialog } from '../componentes/ActivoDialog';
import { FichaDialog } from '../componentes/FichaDialog';
import { ESTADOS, ESTADOS_VALOR } from '../estados';
import { monto } from '../formato';
import type { Activo, AjustesActivos } from '../tipos';

const OPCION_FILTRO: { valor: string; texto: string }[] = [
  { valor: '', texto: 'Todos' },
  ...ESTADOS_VALOR.map((e) => ({ valor: e, texto: estadoDe(e, ESTADOS).texto })),
];

/**
 * Listado de activos.
 *
 * El filtro de estado y la búsqueda se aplican acá, y no con un query a la
 * API, porque la pantalla ya trae el listado completo de la empresa
 * (`?limit=500`): la búsqueda del servidor (`?q=`) sigue existiendo para quien
 * la use desde otro cliente, y las dos buscan en las mismas columnas.
 *
 * El estado NO se cambia registrando un movimiento desde esta tabla: el único
 * que escribe estados es la API de movimientos, y así no quedan activos en
 * reparación sin un movimiento que lo explique. (La única excepción es
 * `retired`, que es una decisión de negocio y no un hecho físico: por eso sí
 * se elige en el formulario.)
 */
export function ActivosPage() {
  const { settings } = useApp();
  const { aviso, avisar, limpiarAviso } = useAviso();

  const ajustes = (settings ?? null) as AjustesActivos | null;
  const simbolo = ajustes?.currency ?? '$';

  const [activos, setActivos] = useState<Activo[] | null>(null);
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState('');
  const [dialogo, setDialogo] = useState<{ activo?: Activo } | null>(null);
  const [fichaId, setFichaId] = useState<string | null>(null);

  async function recargar() {
    const r = await api.get<{ items: Activo[] }>('/assets?limit=500');
    setActivos(r.items);
  }

  useEffect(() => {
    recargar().catch((e) => {
      if (e.vencida) return;
      avisar(e.message, true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lista = useMemo(() => {
    const busqueda = q.trim().toLowerCase();
    return (activos ?? []).filter((a) => {
      if (filtro && a.status !== filtro) return false;
      if (!busqueda) return true;
      return [a.code, a.name, a.brand, a.model, a.serial, a.assignedTo].some((v) =>
        String(v ?? '').toLowerCase().includes(busqueda),
      );
    });
  }, [activos, q, filtro]);

  async function archivar(a: Activo) {
    // Archivar y borrar son cosas distintas: archivar saca el bien de la lista
    // sin tocar su historial, y es lo que la API ofrece cuando el borrado
    // responde 409. Ninguno de los dos pide confirmación: van derecho al
    // servidor, como el legacy.
    try {
      await api.patch(`/assets/${a.id}`, { archived: true });
      await recargar();
      avisar('Activo archivado');
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo archivar el activo', true);
    }
  }

  async function borrar(a: Activo) {
    try {
      await api.delete(`/assets/${a.id}`);
      await recargar();
      avisar('Activo borrado');
    } catch (e) {
      // El 409 de borrar un activo con historial llega con el texto que explica
      // que lo que corresponde es archivar, así que se muestra tal cual: es la
      // instrucción, no un error de programa.
      avisar(e instanceof Error ? e.message : 'No se pudo borrar el activo', true);
    }
  }

  const alFiltrar = (ev: ChangeEvent<HTMLSelectElement>) => setFiltro(ev.target.value);

  return (
    <>
      <PageHeader
        titulo="Activos"
        subtitulo="Bienes de la empresa"
        acciones={<BotonPrimario onClick={() => setDialogo({})}>Nuevo activo</BotonPrimario>}
      />

      <Tarjeta titulo="Activos">
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2">
          <Buscador valor={q} onChange={setQ} placeholder="Codigo, nombre, serie, quien lo tiene" />
          <Select etiqueta="Estado" value={filtro} onChange={alFiltrar}>
            {OPCION_FILTRO.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.texto}
              </option>
            ))}
          </Select>
        </div>

        {!activos ? (
          <Spinner />
        ) : (
          <Tabla
            columnas={[
              'Codigo',
              'Nombre',
              'Categoria',
              'Estado',
              'Lo tiene',
              'Ubicacion',
              { titulo: 'Costo', num: true },
              '',
            ]}
          >
            {lista.length === 0 ? (
              <FilaVacia columnas={8} texto="No hay activos que coincidan" />
            ) : (
              lista.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{a.code}</td>
                  <td className="px-4 py-3">
                    {/* El número de serie va debajo del nombre y no en su propia
                        columna: es un dato de la etiqueta del bien, y darle una
                        columna propia empujaba la de acciones fuera de pantalla. */}
                    <div className="font-medium text-slate-800">{a.name}</div>
                    {a.serial ? <div className="text-xs text-slate-500">{a.serial}</div> : null}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{a.category}</td>
                  <td className="px-4 py-3">
                    <Etiqueta texto={estadoDe(a.status, ESTADOS).texto} tono={estadoDe(a.status, ESTADOS).tono} />
                  </td>
                  <td className="px-4 py-3 text-slate-500">{a.assignedTo ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{a.location ?? '—'}</td>
                  <td className="px-4 py-3 text-right">{monto(a.costCents, simbolo)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <BotonChico onClick={() => setFichaId(a.id)}>Ficha</BotonChico>
                      <BotonChico onClick={() => setDialogo({ activo: a })}>Editar</BotonChico>
                      <BotonChico onClick={() => archivar(a)}>Archivar</BotonChico>
                      <BotonChico peligro onClick={() => borrar(a)}>
                        Borrar
                      </BotonChico>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </Tabla>
        )}
      </Tarjeta>

      {dialogo ? (
        <ActivoDialog
          activo={dialogo.activo ?? null}
          avisar={avisar}
          onCerrar={() => setDialogo(null)}
          onGuardado={recargar}
        />
      ) : null}

      {fichaId ? (
        <FichaDialog activoId={fichaId} avisar={avisar} onCerrar={() => setFichaId(null)} alMover={recargar} />
      ) : null}

      <Aviso mensaje={aviso?.mensaje ?? null} tono={aviso?.tono} onLimpiar={limpiarAviso} />
    </>
  );
}
