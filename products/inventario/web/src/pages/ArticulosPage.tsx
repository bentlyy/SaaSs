import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Aviso,
  BotonChico,
  BotonPrimario,
  BotonSecundario,
  Buscador,
  Campo,
  EsqueletoKpis,
  FilaVacia,
  Kpis,
  Modal,
  NotaError,
  PageHeader,
  Select,
  Spinner,
  Tabla,
  Tarjeta,
  api,
  dinero,
  numero,
  useApp,
  useAviso,
} from '@amg/ui';
import type { AjustesInventario, Articulo, Categoria, Resumen } from '../tipos';

type Modal_ = { modo: 'nuevo' | 'editar' | 'mover'; articulo?: Articulo } | null;

/**
 * Artículos: el catálogo y su stock.
 *
 * La cantidad no se edita acá: solo cambia por un movimiento (que deja registro
 * de quién y por qué), y mover stock o dar de baja es decisión de admin — la UI
 * lo oculta para el resto, pero la garantía real está en la API.
 */
export function ArticulosPage() {
  const { cuenta, settings } = useApp();
  const { aviso, avisar, limpiarAviso } = useAviso();

  const ajustes = (settings ?? null) as AjustesInventario | null;
  const admin = cuenta?.rol === 'admin' || cuenta?.rol === 'owner';
  const simbolo = ajustes?.currency ?? '$';

  const [q, setQ] = useState('');
  const [categoriaFiltro, setCategoriaFiltro] = useState('');
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [articulos, setArticulos] = useState<Articulo[] | null>(null);
  const [modal, setModal] = useState<Modal_>(null);
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api
      .get<{ items: Categoria[] }>('/categories?limit=500')
      .then((r) => setCategorias(r.items))
      .catch(() => setCategorias([]));
  }, []);

  async function cargar(busqueda: string, categoria: string) {
    const qs = new URLSearchParams({ q: busqueda });
    if (categoria) qs.set('categoryId', categoria);
    const [r, items] = await Promise.all([
      api.get<Resumen>('/resumen'),
      api.get<{ items: Articulo[] }>(`/items?${qs.toString()}`),
    ]);
    setResumen(r);
    setArticulos(items.items);
  }

  useEffect(() => {
    const t = setTimeout(() => {
      cargar(q, categoriaFiltro).catch((e) => {
        if (e.vencida) return;
        avisar(e.message, true);
      });
    }, q ? 250 : 0);
    return () => clearTimeout(t);
    // El disparo es la búsqueda y el filtro: `cargar` solo usa api y no cambia.
  }, [q, categoriaFiltro]);

  const nombreCategoria = (id: string | null) => categorias.find((c) => c.id === id)?.name ?? '—';

  const alCambiar = (ev: ChangeEvent<HTMLInputElement>) =>
    setCampos((c) => ({ ...c, [ev.target.name]: ev.target.value }));

  function abrirNuevo() {
    setErrorModal(null);
    setCampos({
      name: '',
      sku: '',
      barcode: '',
      categoryId: '',
      minQuantity: String(ajustes?.defaultMinQuantity ?? 0),
      unit: ajustes?.defaultUnit ?? 'unidad',
      priceCents: '0',
    });
    setModal({ modo: 'nuevo' });
  }

  function abrirEdicion(a: Articulo) {
    setErrorModal(null);
    setCampos({
      name: a.name,
      sku: a.sku ?? '',
      barcode: a.barcode ?? '',
      categoryId: a.categoryId ?? '',
      minQuantity: String(a.minQuantity),
      unit: a.unit,
      priceCents: String(a.priceCents),
    });
    setModal({ modo: 'editar', articulo: a });
  }

  function abrirMovimiento(a: Articulo) {
    setErrorModal(null);
    setCampos({ delta: '', reason: '' });
    setModal({ modo: 'mover', articulo: a });
  }

  async function guardar(ev: FormEvent) {
    ev.preventDefault();
    if (!modal) return;
    setGuardando(true);
    setErrorModal(null);
    try {
      if (modal.modo === 'mover') {
        await api.post(`/items/${modal.articulo!.id}/movements`, {
          delta: Number(campos.delta),
          reason: campos.reason,
        });
      } else {
        const datos = {
          name: campos.name,
          sku: campos.sku,
          barcode: campos.barcode,
          categoryId: campos.categoryId,
          minQuantity: Number(campos.minQuantity),
          unit: campos.unit,
          priceCents: Number(campos.priceCents),
        };
        if (modal.modo === 'nuevo') await api.post('/items', datos);
        else await api.patch(`/items/${modal.articulo!.id}`, datos);
      }
      setModal(null);
      await cargar(q, categoriaFiltro);
    } catch (e) {
      setErrorModal(e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  }

  async function darDeBaja(a: Articulo) {
    if (!confirm(`¿Dar de baja ${a.name}? Se conserva el historial.`)) return;
    try {
      await api.delete(`/items/${a.id}`);
      await cargar(q, categoriaFiltro);
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo dar de baja', true);
    }
  }

  const kpis = resumen
    ? [
        { etiqueta: 'Artículos', valor: numero(resumen.items) },
        { etiqueta: 'Unidades', valor: numero(resumen.unidades) },
        { etiqueta: 'Valor de stock', valor: dinero(resumen.valorCents, simbolo) },
        { etiqueta: 'Movimientos', valor: numero(resumen.movimientos) },
        ...(resumen.stockBajo > 0
          ? [
              {
                etiqueta:
                  resumen.stockBajo === 1
                    ? '1 artículo en stock bajo'
                    : `${numero(resumen.stockBajo)} artículos en stock bajo`,
                valor: 'Revisar',
                acento: true,
              },
            ]
          : []),
      ]
    : [];

  return (
    <>
      <PageHeader
        titulo="Artículos"
        subtitulo="Catálogo del almacén"
        acciones={
          <>
            <select
              value={categoriaFiltro}
              onChange={(e) => setCategoriaFiltro(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            >
              <option value="">Todas las categorías</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <Buscador valor={q} onChange={setQ} placeholder="Buscar por nombre, SKU o código" />
            <BotonPrimario onClick={abrirNuevo}>Nuevo artículo</BotonPrimario>
          </>
        }
      />

      {resumen ? <Kpis items={kpis} /> : <EsqueletoKpis />}

      <Tarjeta titulo="Artículos" className="mt-6">
        {!articulos ? (
          <Spinner />
        ) : (
          <Tabla
            columnas={[
              'Nombre',
              'SKU',
              'Código de barras',
              'Categoría',
              { titulo: 'Stock', num: true },
              'Unidad',
              { titulo: 'Precio', num: true },
              { titulo: '', num: true },
            ]}
          >
            {articulos.length === 0 ? (
              <FilaVacia columnas={8} texto="Todavía no hay artículos. Creá el primero." />
            ) : (
              articulos.map((a) => {
                const bajo = a.quantity <= a.minQuantity;
                return (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{a.name}</td>
                    <td className="px-4 py-3 text-slate-500">{a.sku || '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{a.barcode || '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{nombreCategoria(a.categoryId)}</td>
                    <td className="px-4 py-3 text-right">
                      {numero(a.quantity)}
                      {bajo ? <small className="ml-1 text-slate-400">(mín {numero(a.minQuantity)})</small> : null}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{a.unit}</td>
                    <td className="px-4 py-3 text-right">{dinero(a.priceCents, simbolo)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <BotonChico onClick={() => abrirEdicion(a)}>Editar</BotonChico>
                        {admin ? (
                          <>
                            <BotonChico onClick={() => abrirMovimiento(a)}>Mover</BotonChico>
                            <BotonChico peligro onClick={() => darDeBaja(a)}>
                              Baja
                            </BotonChico>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </Tabla>
        )}
      </Tarjeta>

      {modal ? (
        <Modal
          titulo={
            modal.modo === 'nuevo'
              ? 'Nuevo artículo'
              : modal.modo === 'editar'
                ? `Editar ${modal.articulo!.name}`
                : `Mover stock de ${modal.articulo!.name}`
          }
          onCerrar={() => setModal(null)}
        >
          <form onSubmit={guardar} className="space-y-3">
            {modal.modo === 'mover' ? (
              <>
                <Campo
                  etiqueta="Cantidad (negativa para salir)"
                  name="delta"
                  type="number"
                  step="1"
                  required
                  value={campos.delta ?? ''}
                  onChange={alCambiar}
                  autoFocus
                />
                <Campo
                  etiqueta="Motivo"
                  name="reason"
                  required
                  value={campos.reason ?? ''}
                  onChange={alCambiar}
                />
              </>
            ) : (
              <>
                <Campo etiqueta="Nombre" name="name" required value={campos.name ?? ''} onChange={alCambiar} autoFocus />
                <div className="grid grid-cols-2 gap-3">
                  <Campo etiqueta="SKU" name="sku" value={campos.sku ?? ''} onChange={alCambiar} />
                  <Campo
                    etiqueta="Código de barras"
                    name="barcode"
                    value={campos.barcode ?? ''}
                    onChange={alCambiar}
                  />
                </div>
                <Select
                  etiqueta="Categoría"
                  value={campos.categoryId ?? ''}
                  onChange={(e) => setCampos((c) => ({ ...c, categoryId: e.target.value }))}
                >
                  <option value="">Sin categoría</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                <Campo
                  etiqueta="Stock mínimo"
                  name="minQuantity"
                  type="number"
                  min={0}
                  required
                  value={campos.minQuantity ?? ''}
                  onChange={alCambiar}
                />
                <Campo etiqueta="Unidad" name="unit" required value={campos.unit ?? ''} onChange={alCambiar} />
                <Campo
                  etiqueta="Precio en centavos"
                  name="priceCents"
                  type="number"
                  min={0}
                  required
                  value={campos.priceCents ?? ''}
                  onChange={alCambiar}
                />
              </>
            )}

            <NotaError mensaje={errorModal} />

            <div className="flex justify-end gap-2 pt-2">
              <BotonSecundario type="button" onClick={() => setModal(null)}>
                Cancelar
              </BotonSecundario>
              <BotonPrimario type="submit" disabled={guardando}>
                {guardando ? 'Guardando…' : 'Guardar'}
              </BotonPrimario>
            </div>
          </form>
        </Modal>
      ) : null}

      <Aviso mensaje={aviso?.mensaje ?? null} tono={aviso?.tono} onLimpiar={limpiarAviso} />
    </>
  );
}
