import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Aviso,
  BotonChico,
  BotonPrimario,
  BotonSecundario,
  Buscador,
  Campo,
  Etiqueta,
  FilaVacia,
  Modal,
  NotaError,
  PageHeader,
  Spinner,
  Tabla,
  Tarjeta,
  Textarea,
  api,
  dinero,
  useApp,
  useAviso,
} from '@amg/ui';
import type { AjustesCotizaciones, Cotizacion, Estado, LineaCotizacion } from '../tipos';
import { ESTADOS, TRANSICIONES } from '../estados';
import { aCentavos, desdeCentavos, fechaCorta, porcentaje, simboloMoneda } from '../lib/moneda';

const ESTADOS_LABEL: Record<string, string> = {
  draft: 'Borrador',
  sent: 'Enviada',
  accepted: 'Aceptada',
  rejected: 'Rechazada',
  expired: 'Vencida',
};

/** Texto del boton para moverse a `destino` desde `origen`. */
const ETIQUETA_ACCION: Record<Estado, string> = {
  draft: 'Volver a borrador',
  sent: 'Marcar enviada',
  accepted: 'Aceptar',
  rejected: 'Rechazar',
  expired: 'Marcar vencida',
};

function textoAccion(origen: Estado, destino: Estado): string {
  if (origen === 'expired' && destino === 'sent') return 'Reabrir como enviada';
  return ETIQUETA_ACCION[destino];
}

type ModalTipo = { modo: 'nuevo' } | { modo: 'editar'; cot: Cotizacion } | null;
type LineaForm = { desc: string; qty: string; precio: string };

export function CotizacionesPage() {
  const { cuenta, settings, recargarSettings } = useApp();
  const { aviso, avisar, limpiarAviso } = useAviso();

  const ajustes = (settings ?? null) as AjustesCotizaciones | null;
  const admin = cuenta?.rol === 'admin' || cuenta?.rol === 'owner';
  const simbolo = simboloMoneda(ajustes?.currency);

  const [cotizaciones, setCotizaciones] = useState<Cotizacion[] | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [modal, setModal] = useState<ModalTipo>(null);
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [lineas, setLineas] = useState<LineaForm[]>([]);
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [accionando, setAccionando] = useState(false);
  const [detalle, setDetalle] = useState<{ cot: Cotizacion; lineas: LineaCotizacion[] } | null>(null);

  async function cargar(q = '') {
    const consulta = q.trim() ? `?limit=500&q=${encodeURIComponent(q.trim())}` : '?limit=500';
    const lista = await api.get<{ items: Cotizacion[] }>(`/quotes${consulta}`);
    setCotizaciones(lista.items);
  }

  useEffect(() => {
    const t = setTimeout(() => {
      cargar(busqueda).catch((e) => {
        if (e.vencida) return;
        avisar(e.message, true);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [busqueda]);

  const alCambiar = (ev: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setCampos((c) => ({ ...c, [ev.target.name]: ev.target.value }));

  function abrirNuevo() {
    setErrorModal(null);
    const hoy = new Date().toLocaleDateString('en-CA');
    const dias = ajustes?.validityDays ?? 30;
    const d = new Date();
    d.setDate(d.getDate() + dias);
    const vence = d.toLocaleDateString('en-CA');
    setCampos({
      customerName: '',
      customerEmail: '',
      customerPhone: '',
      title: '',
      issueDate: hoy,
      validUntil: vence,
      taxRatePct: String((ajustes?.defaultTaxRateBp ?? 0) / 100),
      descuento: '0',
      notes: '',
    });
    setLineas([{ desc: '', qty: '1', precio: '0' }]);
    setModal({ modo: 'nuevo' });
  }

  function abrirEditar(cot: Cotizacion) {
    setErrorModal(null);
    setDetalle(null);
    setCampos({
      customerName: cot.customerName,
      customerEmail: cot.customerEmail ?? '',
      customerPhone: cot.customerPhone ?? '',
      title: cot.title ?? '',
      issueDate: cot.issueDate ?? '',
      validUntil: cot.validUntil ?? '',
      taxRatePct: String(cot.taxRateBp / 100),
      descuento: desdeCentavos(cot.discountCents),
      notes: cot.notes ?? '',
    });
    // Las lineas se cargan del servidor al abrir: lo que se pinta en el modal
    // tiene que ser lo que ya esta guardado, no una linea inventada.
    setModal({ modo: 'editar', cot });
    api
      .get<{ lines: LineaCotizacion[] }>(`/quotes/${cot.id}/lineas`)
      .then((r) =>
        setLineas(
          r.lines.map((l) => ({
            desc: l.description,
            qty: String(l.qty),
            precio: desdeCentavos(l.unitPriceCents),
          })),
        ),
      )
      .catch((e) => {
        if (e.vencida) return;
        avisar(e.message, true);
      });
  }

  async function verDetalle(id: string) {
    try {
      const [cot, lin] = await Promise.all([
        api.get<Cotizacion>(`/quotes/${id}`),
        api.get<{ lines: LineaCotizacion[] }>(`/quotes/${id}/lineas`),
      ]);
      setDetalle({ cot, lineas: lin.lines });
    } catch (e: any) {
      if (e.vencida) return;
      avisar(e.message, true);
    }
  }

  function cerrarModal() {
    if (guardando) return;
    setModal(null);
  }

  function agregarLinea() {
    setLineas([...lineas, { desc: '', qty: '1', precio: '0' }]);
  }

  function quitarLinea(i: number) {
    setLineas(lineas.filter((_, idx) => idx !== i));
  }

  function cambiarLinea(i: number, campo: keyof LineaForm, valor: string) {
    const nueva = [...lineas];
    nueva[i] = { ...nueva[i], [campo]: valor };
    setLineas(nueva);
  }

  async function guardar(ev: FormEvent) {
    ev.preventDefault();
    setErrorModal(null);
    setGuardando(true);
    try {
      const cuerpo: any = {
        customerName: campos.customerName,
        customerEmail: campos.customerEmail || null,
        customerPhone: campos.customerPhone || null,
        title: campos.title || null,
        issueDate: campos.issueDate || null,
        validUntil: campos.validUntil || null,
        taxRateBp: Math.round((Number(campos.taxRatePct) || 0) * 100),
        discountCents: aCentavos(campos.descuento),
        notes: campos.notes || null,
        lines: lineas
          .filter((l) => l.desc.trim())
          .map((l) => ({
            description: l.desc.trim(),
            qty: Number(l.qty) || 1,
            unitPriceCents: aCentavos(l.precio),
          })),
      };

      if (modal?.modo === 'nuevo') {
        await api.post('/quotes', cuerpo);
        // El folio propuesto avanza con la recien creada: si no, la proxima
        // ventana propone el mismo numero que acaba de usar.
        await recargarSettings();
      } else if (modal?.modo === 'editar') {
        await api.patch(`/quotes/${modal.cot.id}`, cuerpo);
      }
      await cargar(busqueda);
      setModal(null);
      avisar('Cotización guardada.');
    } catch (e: any) {
      if (e.vencida) return;
      setErrorModal(e.message);
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarEstado(id: string, estado: Estado) {
    setAccionando(true);
    try {
      const r = await api.post<{ quote: Cotizacion }>(`/quotes/${id}/estado`, { status: estado });
      await cargar(busqueda);
      setDetalle((prev) => (prev && prev.cot.id === id ? { ...prev, cot: r.quote } : prev));
      avisar('Estado actualizado.');
    } catch (e: any) {
      if (e.vencida) return;
      avisar(e.message, true);
    } finally {
      setAccionando(false);
    }
  }

  async function duplicar(cot: Cotizacion) {
    setAccionando(true);
    try {
      const r = await api.post<{ quote: Cotizacion; lines: LineaCotizacion[] }>(`/quotes/${cot.id}/duplicar`);
      await cargar(busqueda);
      // Se abre la copia, no la original: duplicar es el primer paso de editar.
      setDetalle({ cot: r.quote, lineas: r.lines });
      avisar(`Cotización #${r.quote.number} creada como borrador.`);
    } catch (e: any) {
      if (e.vencida) return;
      avisar(e.message, true);
    } finally {
      setAccionando(false);
    }
  }

  function descargarPdf(cot: Cotizacion) {
    const enlace = document.createElement('a');
    enlace.href = `/api/quotes/${cot.id}/pdf`;
    enlace.rel = 'noopener';
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
  }

  // Vista previa de los importes mientras se escribe. Es la misma aritmetica
  // del servidor (centavos, un solo `Math.round` por linea y por impuesto) para
  // que el numero del modal sea el que se guarda.
  const totalesLineas = lineas.map((l) => Math.round((Number(l.qty) || 1) * aCentavos(l.precio)));
  const subtotalPreview = totalesLineas.reduce((acc, n) => acc + n, 0);
  const descuentoPreview = aCentavos(campos.descuento);
  const descuentoInvalido = descuentoPreview > subtotalPreview;
  const basePreview = Math.max(0, subtotalPreview - descuentoPreview);
  const tasaPreview = Math.round((Number(campos.taxRatePct) || 0) * 100);
  const impuestoPreview = Math.round((basePreview * tasaPreview) / 10_000);
  const totalPreview = basePreview + impuestoPreview;

  return (
    <div className="flex flex-col gap-6">
      {aviso && <Aviso mensaje={aviso?.mensaje ?? null} tono={aviso?.tono} onLimpiar={limpiarAviso} />}
      <PageHeader
        titulo="Cotizaciones"
        subtitulo="Presupuestos con folio, vigencia y estados"
        acciones={
          <>
            <Buscador valor={busqueda} onChange={setBusqueda} placeholder="Buscar cliente, título o folio" />
            <BotonPrimario onClick={abrirNuevo}>Nueva cotización</BotonPrimario>
          </>
        }
      />
      <Tarjeta>
        {cotizaciones === null && <div className="p-4 text-sm text-slate-500">Cargando...</div>}
        {cotizaciones !== null && cotizaciones.length === 0 && (
          <FilaVacia columnas={7} texto={busqueda.trim() ? 'No hay cotizaciones que coincidan.' : 'Aún no hay cotizaciones.'} />
        )}
        {cotizaciones !== null && cotizaciones.length > 0 && (
          <Tabla
            columnas={[
              { titulo: '#', num: true },
              { titulo: 'Cliente' },
              { titulo: 'Emisión' },
              { titulo: 'Vence' },
              { titulo: 'Estado' },
              { titulo: 'Total', num: true },
              { titulo: 'Acciones', num: true },
            ]}
          >
            {cotizaciones.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 whitespace-nowrap text-slate-600">#{c.number}</td>
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-800">{c.customerName}</div>
                  {c.title && <div className="text-xs text-slate-500">{c.title}</div>}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-slate-600">{fechaCorta(c.issueDate)}</td>
                <td className="px-4 py-3 whitespace-nowrap text-slate-600">{fechaCorta(c.validUntil)}</td>
                <td className="px-4 py-3">
                  <Etiqueta texto={ESTADOS[c.status]?.texto ?? ESTADOS_LABEL[c.status] ?? c.status} tono={ESTADOS[c.status]?.tono} />
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-right font-medium text-slate-800">
                  {dinero(c.totalCents, { simbolo })}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2 whitespace-nowrap">
                    <BotonChico onClick={() => verDetalle(c.id)}>Ver</BotonChico>
                    <BotonChico onClick={() => descargarPdf(c)}>PDF</BotonChico>
                    {c.status === 'draft' && (
                      <BotonChico onClick={() => cambiarEstado(c.id, 'sent')} disabled={accionando}>
                        Enviar
                      </BotonChico>
                    )}
                    {admin && <BotonChico onClick={() => abrirEditar(c)}>Editar</BotonChico>}
                    <BotonChico onClick={() => duplicar(c)} disabled={accionando}>
                      Duplicar
                    </BotonChico>
                  </div>
                </td>
              </tr>
            ))}
          </Tabla>
        )}
      </Tarjeta>

      {modal && (
        <Modal
          titulo={modal.modo === 'nuevo' ? 'Nueva cotización' : 'Editar cotización'}
          onCerrar={cerrarModal}
          ancho="max-w-3xl"
        >
          <form onSubmit={guardar} className="flex flex-col gap-6">
            <div className="grid gap-4 md:grid-cols-2">
              {modal.modo === 'nuevo' && (
                // El folio lo propone el servidor (settings.nextNumber) y lo
                // fija el al crear: aca se muestra para mirar, no se edita.
                <Campo etiqueta="Folio (propuesto)" name="number" value={String(ajustes?.nextNumber ?? '')} readOnly />
              )}
              <Campo etiqueta="Nombre del cliente" name="customerName" value={campos.customerName} onChange={alCambiar} required />
              <Campo etiqueta="Email del cliente" name="customerEmail" value={campos.customerEmail} onChange={alCambiar} type="email" />
              <Campo etiqueta="Teléfono del cliente" name="customerPhone" value={campos.customerPhone} onChange={alCambiar} />
              <Campo etiqueta="Título" name="title" value={campos.title} onChange={alCambiar} />
              <Campo etiqueta="Fecha de emisión" name="issueDate" value={campos.issueDate} onChange={alCambiar} type="date" />
              <Campo etiqueta="Válida hasta" name="validUntil" value={campos.validUntil} onChange={alCambiar} type="date" />
              <Campo etiqueta="Impuesto (%)" name="taxRatePct" value={campos.taxRatePct} onChange={alCambiar} type="number" min="0" max="100" step="0.01" />
              <Campo
                etiqueta={`Descuento (${simbolo})`}
                name="descuento"
                value={campos.descuento}
                onChange={alCambiar}
                type="number"
                min="0"
                step="0.01"
              />
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-slate-700">Líneas</h3>
                <BotonChico onClick={agregarLinea} type="button">Agregar línea</BotonChico>
              </div>
              {lineas.map((l, i) => (
                <div key={i} className="grid gap-2 md:grid-cols-[1fr_auto_auto_auto]">
                  <Campo etiqueta="Descripción" name={`desc-${i}`} value={l.desc} onChange={(e) => cambiarLinea(i, 'desc', e.target.value)} />
                  <Campo etiqueta="Cantidad" name={`qty-${i}`} value={l.qty} onChange={(e) => cambiarLinea(i, 'qty', e.target.value)} type="number" step="0.01" />
                  <Campo etiqueta={`Precio unitario (${simbolo})`} name={`precio-${i}`} value={l.precio} onChange={(e) => cambiarLinea(i, 'precio', e.target.value)} type="number" step="0.01" />
                  <div className="flex items-end">
                    <BotonSecundario onClick={() => quitarLinea(i)} type="button" disabled={lineas.length === 1}>Quitar</BotonSecundario>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-col items-end gap-1 rounded-lg bg-slate-50 p-4 text-sm">
              <div className="flex w-64 justify-between"><span className="text-slate-500">Subtotal</span><span>{dinero(subtotalPreview, { simbolo })}</span></div>
              <div className="flex w-64 justify-between">
                <span className="text-slate-500">Descuento</span>
                <span className={descuentoInvalido ? 'text-red-600' : ''}>-{dinero(descuentoPreview, { simbolo })}</span>
              </div>
              <div className="flex w-64 justify-between">
                <span className="text-slate-500">Impuesto ({porcentaje(tasaPreview)})</span>
                <span>{dinero(impuestoPreview, { simbolo })}</span>
              </div>
              <div className="flex w-64 justify-between border-t border-slate-200 pt-1 text-base font-medium"><span>Total</span><span>{dinero(totalPreview, { simbolo })}</span></div>
              {descuentoInvalido && <p className="text-xs text-red-600">El descuento no puede superar el subtotal.</p>}
            </div>

            <Textarea etiqueta="Notas" name="notes" value={campos.notes} onChange={alCambiar} />
            {errorModal && <NotaError mensaje={errorModal} />}
            <div className="flex justify-end gap-2">
              <BotonSecundario onClick={cerrarModal} type="button" disabled={guardando}>Cancelar</BotonSecundario>
              <BotonPrimario type="submit" disabled={guardando || descuentoInvalido}>{guardando ? <Spinner /> : 'Guardar'}</BotonPrimario>
            </div>
          </form>
        </Modal>
      )}

      {detalle && (
        <Modal titulo={`Cotización #${detalle.cot.number}`} onCerrar={() => setDetalle(null)} ancho="max-w-3xl">
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Etiqueta
                texto={ESTADOS[detalle.cot.status]?.texto ?? ESTADOS_LABEL[detalle.cot.status] ?? detalle.cot.status}
                tono={ESTADOS[detalle.cot.status]?.tono}
              />
              <div className="flex flex-wrap justify-end gap-2">
                <BotonSecundario type="button" onClick={() => descargarPdf(detalle.cot)}>Descargar PDF</BotonSecundario>
                <BotonSecundario type="button" onClick={() => duplicar(detalle.cot)} disabled={accionando}>Duplicar</BotonSecundario>
                {admin && <BotonSecundario type="button" onClick={() => abrirEditar(detalle.cot)}>Editar</BotonSecundario>}
              </div>
            </div>

            <div className="grid gap-2 text-sm md:grid-cols-2">
              <div><span className="text-slate-500">Cliente:</span> {detalle.cot.customerName}</div>
              <div><span className="text-slate-500">Título:</span> {detalle.cot.title || '—'}</div>
              <div><span className="text-slate-500">Email:</span> {detalle.cot.customerEmail || '—'}</div>
              <div><span className="text-slate-500">Teléfono:</span> {detalle.cot.customerPhone || '—'}</div>
              <div><span className="text-slate-500">Emisión:</span> {fechaCorta(detalle.cot.issueDate)}</div>
              <div><span className="text-slate-500">Válida hasta:</span> {fechaCorta(detalle.cot.validUntil)}</div>
            </div>

            <Tabla
              columnas={[
                { titulo: 'Descripción' },
                { titulo: 'Cant.', num: true },
                { titulo: 'P. Unit.', num: true },
                { titulo: 'Total', num: true },
              ]}
            >
              {detalle.lineas.map((l) => (
                <tr key={l.position}>
                  <td className="px-4 py-3">{l.description}</td>
                  <td className="px-4 py-3 text-right">{l.qty.toString()}</td>
                  <td className="px-4 py-3 text-right">{dinero(l.unitPriceCents, { simbolo })}</td>
                  <td className="px-4 py-3 text-right">{dinero(l.lineTotalCents, { simbolo })}</td>
                </tr>
              ))}
            </Tabla>

            <div className="flex flex-col items-end gap-1 text-sm">
              <div>Subtotal: {dinero(detalle.cot.subtotalCents, { simbolo })}</div>
              {detalle.cot.discountCents > 0 && <div>Descuento: -{dinero(detalle.cot.discountCents, { simbolo })}</div>}
              <div>Impuesto ({porcentaje(detalle.cot.taxRateBp)}): {dinero(detalle.cot.taxCents, { simbolo })}</div>
              <div className="text-base font-medium">Total: {dinero(detalle.cot.totalCents, { simbolo })}</div>
            </div>

            {detalle.cot.notes && (
              <div className="text-sm">
                <div className="text-slate-500">Notas</div>
                <p className="mt-1 whitespace-pre-wrap text-slate-700">{detalle.cot.notes}</p>
              </div>
            )}

            {TRANSICIONES[detalle.cot.status].length > 0 && (
              <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
                {TRANSICIONES[detalle.cot.status].map((destino) => (
                  <BotonChico
                    key={destino}
                    type="button"
                    peligro={destino === 'rejected'}
                    disabled={accionando}
                    onClick={() => cambiarEstado(detalle.cot.id, destino)}
                  >
                    {textoAccion(detalle.cot.status, destino)}
                  </BotonChico>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
