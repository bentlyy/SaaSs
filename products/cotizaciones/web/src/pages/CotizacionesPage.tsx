import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Aviso,
  BotonChico,
  BotonPrimario,
  BotonSecundario,
  Campo,
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
import type { AjustesCotizaciones, Cotizacion, LineaCotizacion } from '../tipos';

const ESTADOS_LABEL: Record<string, string> = {
  draft: 'Borrador',
  sent: 'Enviada',
  accepted: 'Aceptada',
  rejected: 'Rechazada',
  expired: 'Vencida',
};

type ModalTipo = { modo: 'nuevo' } | { modo: 'editar'; cot: Cotizacion } | null;

export function CotizacionesPage() {
  const { cuenta, settings, recargarSettings } = useApp();
  const { aviso, avisar, limpiarAviso } = useAviso();

  const ajustes = (settings ?? null) as AjustesCotizaciones | null;
  const admin = cuenta?.rol === 'admin' || cuenta?.rol === 'owner';
  const simbolo = ajustes?.currency ?? '$';

  const [cotizaciones, setCotizaciones] = useState<Cotizacion[] | null>(null);
  const [modal, setModal] = useState<ModalTipo>(null);
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [lineas, setLineas] = useState<Array<{ desc: string; qty: string; precio: string }>>([]);
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [detalle, setDetalle] = useState<{ cot: Cotizacion; lineas: LineaCotizacion[] } | null>(null);

  async function cargar() {
    const lista = await api.get<{ items: Cotizacion[] }>('/quotes?limit=500');
    setCotizaciones(lista.items);
  }

  useEffect(() => {
    cargar().catch((e) => {
      if (e.vencida) return;
      avisar(e.message, true);
    });
  }, []);

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
      title: '',
      issueDate: hoy,
      validUntil: vence,
      taxRateBp: String(ajustes?.defaultTaxRateBp ?? 0),
      notes: '',
    });
    setLineas([{ desc: '', qty: '1', precio: '0' }]);
    setModal({ modo: 'nuevo' });
  }

  function abrirEditar(cot: Cotizacion) {
    setErrorModal(null);
    setCampos({
      customerName: cot.customerName,
      customerEmail: cot.customerEmail ?? '',
      title: cot.title ?? '',
      issueDate: cot.issueDate ?? '',
      validUntil: cot.validUntil ?? '',
      taxRateBp: String(cot.taxRateBp),
      notes: cot.notes ?? '',
    });
    // Las lineas se cargan del servidor al abrir: lo que se pinta en el modal
    // tiene que ser lo que ya esta guardada, no una linea inventada.
    setModal({ modo: 'editar', cot });
    api
      .get<{ lines: LineaCotizacion[] }>(`/quotes/${cot.id}/lineas`)
      .then((r) =>
        setLineas(r.lines.map((l) => ({ desc: l.description, qty: String(l.qty), precio: String(l.unitPriceCents / 100) }))),
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

  function cambiarLinea(i: number, campo: string, valor: string) {
    const nueva = [...lineas];
    (nueva[i] as any)[campo] = valor;
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
        title: campos.title || null,
        issueDate: campos.issueDate || null,
        validUntil: campos.validUntil || null,
        taxRateBp: Number(campos.taxRateBp) || 0,
        notes: campos.notes || null,
        lines: lineas
          .filter((l) => l.desc.trim())
          .map((l) => ({
            description: l.desc.trim(),
            qty: Number(l.qty) || 1,
            unitPriceCents: Math.round((Number(l.precio) || 0) * 100),
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
      await cargar();
      setModal(null);
      avisar('Cotización guardada.');
    } catch (e: any) {
      if (e.vencida) return;
      setErrorModal(e.message);
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarEstado(id: string, estado: string) {
    try {
      await api.post(`/quotes/${id}/estado`, { status: estado });
      await cargar();
      avisar('Estado actualizado.');
    } catch (e: any) {
      if (e.vencida) return;
      avisar(e.message, true);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {aviso && <Aviso mensaje={aviso?.mensaje ?? null} tono={aviso?.tono} onLimpiar={limpiarAviso} />}
      <PageHeader
        titulo="Cotizaciones"
        subtitulo="Listado de cotizaciones"
        acciones={<BotonPrimario onClick={abrirNuevo}>Nueva cotización</BotonPrimario>}
      />
      <Tarjeta>
        {cotizaciones === null && <div className="p-4 text-sm text-slate-500">Cargando...</div>}
        {cotizaciones !== null && cotizaciones.length === 0 && <FilaVacia columnas={5} texto="Aún no hay cotizaciones." />}
        {cotizaciones !== null && cotizaciones.length > 0 && (
          <Tabla
            columnas={[
              { titulo: '#', num: true },
              { titulo: 'Cliente' },
              { titulo: 'Estado' },
              { titulo: 'Total', num: true },
              { titulo: 'Acciones', num: true },
            ]}
          >
            {cotizaciones.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-600">#{c.number}</td>
                <td className="px-4 py-3 font-medium text-slate-800">{c.customerName}</td>
                <td className="px-4 py-3 text-slate-600">{ESTADOS_LABEL[c.status] ?? c.status}</td>
                <td className="px-4 py-3 text-right font-medium text-slate-800">
                  {dinero(c.totalCents, { simbolo })}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <BotonChico onClick={() => verDetalle(c.id)}>Ver</BotonChico>
                    {c.status === 'draft' && <BotonChico onClick={() => cambiarEstado(c.id, 'sent')}>Marcar enviada</BotonChico>}
                    {admin && <BotonChico onClick={() => abrirEditar(c)}>Editar</BotonChico>}
                  </div>
                </td>
              </tr>
            ))}
          </Tabla>
        )}
      </Tarjeta>

      {modal && (
        <Modal titulo={modal.modo === 'nuevo' ? 'Nueva cotización' : 'Editar cotización'} onCerrar={cerrarModal}>
          <form onSubmit={guardar} className="flex flex-col gap-6">
            <div className="grid gap-4 md:grid-cols-2">
              {modal.modo === 'nuevo' && (
                // El folio lo propone el servidor (settings.nextNumber) y lo
                // fija el al crear: aca se muestra para mirar, no se edita.
                <Campo etiqueta="Folio (propuesto)" name="number" value={String(ajustes?.nextNumber ?? '')} readOnly />
              )}
              <Campo etiqueta="Nombre del cliente" name="customerName" value={campos.customerName} onChange={alCambiar} required />
              <Campo etiqueta="Email del cliente" name="customerEmail" value={campos.customerEmail} onChange={alCambiar} type="email" />
              <Campo etiqueta="Título" name="title" value={campos.title} onChange={alCambiar} />
              <Campo etiqueta="Fecha de emisión" name="issueDate" value={campos.issueDate} onChange={alCambiar} type="date" />
              <Campo etiqueta="Válida hasta" name="validUntil" value={campos.validUntil} onChange={alCambiar} type="date" />
              <Campo etiqueta="Impuesto (bp)" name="taxRateBp" value={campos.taxRateBp} onChange={alCambiar} type="number" />
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
                  <Campo etiqueta="Precio unitario" name={`precio-${i}`} value={l.precio} onChange={(e) => cambiarLinea(i, 'precio', e.target.value)} type="number" step="0.01" />
                  <div className="flex items-end">
                    <BotonSecundario onClick={() => quitarLinea(i)} type="button" disabled={lineas.length === 1}>Quitar</BotonSecundario>
                  </div>
                </div>
              ))}
            </div>
            <Textarea etiqueta="Notas" name="notes" value={campos.notes} onChange={alCambiar} />
            {errorModal && <NotaError mensaje={errorModal} />}
            <div className="flex justify-end gap-2">
              <BotonSecundario onClick={cerrarModal} type="button" disabled={guardando}>Cancelar</BotonSecundario>
              <BotonPrimario type="submit" disabled={guardando}>{guardando ? <Spinner /> : 'Guardar'}</BotonPrimario>
            </div>
          </form>
        </Modal>
      )}

      {detalle && (
        <Modal titulo={`Cotización #${detalle.cot.number}`} onCerrar={() => setDetalle(null)}>
          <div className="flex flex-col gap-6">
            <div className="grid gap-2 md:grid-cols-2 text-sm">
              <div><span className="text-slate-500">Cliente:</span> {detalle.cot.customerName}</div>
              <div><span className="text-slate-500">Estado:</span> {ESTADOS_LABEL[detalle.cot.status]}</div>
              <div><span className="text-slate-500">Emisión:</span> {detalle.cot.issueDate}</div>
              <div><span className="text-slate-500">Válida hasta:</span> {detalle.cot.validUntil}</div>
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
              <div>Impuestos: {dinero(detalle.cot.taxCents, { simbolo })}</div>
              <div className="text-base font-medium">Total: {dinero(detalle.cot.totalCents, { simbolo })}</div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
