import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Aviso,
  BotonChico,
  BotonPrimario,
  Buscador,
  Campo,
  FilaVacia,
  NotaError,
  PageHeader,
  Spinner,
  Tabla,
  Tarjeta,
  api,
  useAviso,
} from '@amg/ui';
import type { Categoria } from '../tipos';

/**
 * Categorías del almacén.
 *
 * Dar de baja una categoría no borra sus artículos: los deja sin categoría (el
 * `ON DELETE SET NULL` de `items.category_id`). La categoría agrupa, no posee.
 */
export function CategoriasPage() {
  const { aviso, avisar, limpiarAviso } = useAviso();
  const [q, setQ] = useState('');
  const [categorias, setCategorias] = useState<Categoria[] | null>(null);
  const [nombre, setNombre] = useState('');
  const [editando, setEditando] = useState<{ id: string; nombre: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async (busqueda: string) => {
    const r = await api.get<{ items: Categoria[] }>(`/categories?limit=500&q=${encodeURIComponent(busqueda)}`);
    setCategorias(r.items);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      cargar(q).catch((e) => {
        if (!e.vencida) avisar(e.message, true);
      });
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, cargar, avisar]);

  async function crear(ev: FormEvent) {
    ev.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      await api.post('/categories', { name: nombre });
      setNombre('');
      await cargar(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear');
    } finally {
      setGuardando(false);
    }
  }

  async function guardarEdicion(ev: FormEvent) {
    ev.preventDefault();
    if (!editando) return;
    setGuardando(true);
    setError(null);
    try {
      await api.patch(`/categories/${editando.id}`, { name: editando.nombre });
      setEditando(null);
      await cargar(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(cat: Categoria) {
    if (!confirm(`¿Dar de baja la categoría ${cat.name}? Los artículos quedan sin categoría.`)) return;
    try {
      await api.delete(`/categories/${cat.id}`);
      await cargar(q);
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo dar de baja', true);
    }
  }

  return (
    <>
      <PageHeader
        titulo="Categorías"
        subtitulo="Agrupación del catálogo"
        acciones={<Buscador valor={q} onChange={setQ} placeholder="Buscar categoría" />}
      />

      <Tarjeta titulo="Nueva categoría" className="max-w-xl">
        <form onSubmit={crear} className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-48 flex-1">
            <Campo etiqueta="Nombre" required value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </div>
          <BotonPrimario type="submit" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Agregar'}
          </BotonPrimario>
        </form>
        {error ? (
          <div className="px-4 pb-4">
            <NotaError mensaje={error} />
          </div>
        ) : null}
      </Tarjeta>

      <Tarjeta titulo="Categorías" className="mt-6">
        {!categorias ? (
          <Spinner />
        ) : (
          <Tabla columnas={['Nombre', { titulo: '', num: true }]}>
            {categorias.length === 0 ? (
              <FilaVacia columnas={2} texto="Todavía no hay categorías." />
            ) : (
              categorias.map((cat) => (
                <tr key={cat.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {editando?.id === cat.id ? (
                      <form onSubmit={guardarEdicion} className="flex items-center gap-2">
                        <input
                          autoFocus
                          value={editando.nombre}
                          onChange={(e) => setEditando({ ...editando, nombre: e.target.value })}
                          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                        />
                        <BotonChico type="submit">Guardar</BotonChico>
                        <BotonChico type="button" onClick={() => setEditando(null)}>
                          Cancelar
                        </BotonChico>
                      </form>
                    ) : (
                      cat.name
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {editando?.id === cat.id ? null : (
                      <div className="flex justify-end gap-1">
                        <BotonChico onClick={() => setEditando({ id: cat.id, nombre: cat.name })}>Editar</BotonChico>
                        <BotonChico peligro onClick={() => borrar(cat)}>
                          Baja
                        </BotonChico>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </Tabla>
        )}
      </Tarjeta>

      <Aviso mensaje={aviso?.mensaje ?? null} tono={aviso?.tono} onLimpiar={limpiarAviso} />
    </>
  );
}
