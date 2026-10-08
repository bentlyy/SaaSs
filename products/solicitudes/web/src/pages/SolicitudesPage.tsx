import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Aviso,
  BotonChico,
  BotonPrimario,
  BotonSecundario,
  Buscador,
  Campo,
  EsqueletoKpis,
  Etiqueta,
  FilaVacia,
  Kpis,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Tabla,
  Tarjeta,
  Textarea,
  Vacio,
  api,
  estadoDe,
  fecha,
  numero,
  useApp,
  useAviso,
  type Tono,
} from '@amg/ui';
import type {
  Adjunto,
  AjustesSolicitudes,
  Comentario,
  Detalle,
  EventoHistorial,
  Resumen,
  Solicitud,
} from '../tipos';

type Modal_ = { modo: 'nueva' } | { modo: 'ver'; id: string; numero: number } | null;

type Hilo = { comments: Comentario[]; attachments: Adjunto[]; history: EventoHistorial[] };

const HILO_VACIO: Hilo = { comments: [], attachments: [], history: [] };

/**
 * Los estados y las prioridades, con su tono.
 *
 * El tono importa tanto como la palabra: una tabla donde todo dice "Pendiente"
 * sin color obliga a leer celda por celda. Con color, un barrido de la vista
 * dice cuántas hay urgentes.
 */
const ESTADOS: Record<string, { texto: string; tono: Tono }> = {
  open: { texto: 'Abierta', tono: 'acento' },
  in_progress: { texto: 'En curso', tono: 'aviso' },
  resolved: { texto: 'Resuelta', tono: 'ok' },
  closed: { texto: 'Cerrada', tono: 'neutro' },
  cancelled: { texto: 'Cancelada', tono: 'neutro' },
};

const PRIORIDADES: Record<string, { texto: string; tono: Tono }> = {
  low: { texto: 'Baja', tono: 'neutro' },
  medium: { texto: 'Media', tono: 'neutro' },
  high: { texto: 'Alta', tono: 'aviso' },
  urgent: { texto: 'Urgente', tono: 'malo' },
};

const hoy = new Date();
const hoyIso = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(
  hoy.getDate(),
).padStart(2, '0')}`;

/** Vencida es solo si sigue abierta: una resuelta que pasó su fecha no lo está. */
const vencida = (r: Solicitud) =>
  (r.status === 'open' || r.status === 'in_progress') && r.dueAt !== null && r.dueAt < hoyIso;

/**
 * La fecha límite se muestra como vino, sin hora: es un día, no un instante.
 *
 * Y no puede pasar por `new Date()`, que lo leería como medianoche en UTC: en
 * cualquier zona detrás de UTC el día se corre hacia atrás y la pantalla
 * mostraría un vencimiento un día antes del que es.
 */
function dia(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** El navegador lee el archivo y lo manda en base64 dentro del JSON. */
function leerArchivo(archivo: File): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onload = () => resolver(String(lector.result));
    lector.onerror = () => rechazar(new Error('No se pudo leer el archivo'));
    lector.readAsDataURL(archivo);
  });
}

/**
 * Solicitudes: la bandeja de entrada y el hilo de cada ticket.
 *
 * El navegador no decide el folio: la pantalla propone el que trajo el servidor
 * y se puede cambiar, pero el número único lo asigna quien ve todas las
 * organizaciones.
 */
export function SolicitudesPage() {
  const { settings, recargarSettings } = useApp();
  const { aviso, avisar, limpiarAviso } = useAviso();

  const ajustes = (settings ?? null) as AjustesSolicitudes | null;

  const [q, setQ] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');
  const [filtroPrioridad, setFiltroPrioridad] = useState('');
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [solicitudes, setSolicitudes] = useState<Solicitud[] | null>(null);
  const [modal, setModal] = useState<Modal_>(null);
  const [hilo, setHilo] = useState<Hilo>(HILO_VACIO);
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [comentario, setComentario] = useState('');
  const archivoRef = useRef<HTMLInputElement>(null);

  async function cargarResumen() {
    setResumen(await api.get<Resumen>('/resumen'));
  }

  async function cargarLista() {
    const params = new URLSearchParams({ limit: '500' });
    if (filtroEstado) params.set('status', filtroEstado);
    if (filtroPrioridad) params.set('priority', filtroPrioridad);
    if (q.trim()) params.set('q', q.trim());
    const { requests } = await api.get<{ requests: Solicitud[] }>(`/requests?${params.toString()}`);
    setSolicitudes(requests);
  }

  useEffect(() => {
    cargarResumen().catch((e) => {
      if (e.vencida) return;
      avisar(e.message, true);
    });
    // Las cifras de arriba no dependen de los filtros: solo se piden una vez.
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      cargarLista().catch((e) => {
        if (e.vencida) return;
        avisar(e.message, true);
      });
    }, q ? 250 : 0);
    return () => clearTimeout(t);
    // El disparo es la búsqueda y los dos selectores: `cargarLista` solo usa api.
  }, [q, filtroEstado, filtroPrioridad]);

  const alCambiar = (ev: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setCampos((c) => ({ ...c, [ev.target.name]: ev.target.value }));

  function abrirNueva() {
    setHilo(HILO_VACIO);
    setComentario('');
    setCampos({
      number: String(ajustes?.nextNumber ?? 1),
      priority: 'medium',
      status: 'open',
      title: '',
      description: '',
      requesterName: '',
      requesterEmail: '',
      responsibleName: '',
      dueAt: '',
      resolution: '',
    });
    setModal({ modo: 'nueva' });
  }

  async function abrir(id: string) {
    const d = await api.get<Detalle>(`/requests/${id}`);
    setHilo({ comments: d.comments, attachments: d.attachments, history: d.history });
    setCampos({
      number: String(d.request.number),
      priority: d.request.priority,
      status: d.request.status,
      title: d.request.title,
      description: d.request.description ?? '',
      requesterName: d.request.requesterName,
      requesterEmail: d.request.requesterEmail ?? '',
      responsibleName: d.request.responsibleName ?? '',
      dueAt: d.request.dueAt ?? '',
      resolution: d.request.resolution ?? '',
    });
    setModal({ modo: 'ver', id: d.request.id, numero: d.request.number });
  }

  function cuerpoDelFormulario() {
    return {
      number: Number(campos.number) || null,
      title: campos.title.trim(),
      description: campos.description.trim() || null,
      requesterName: campos.requesterName.trim(),
      requesterEmail: campos.requesterEmail.trim() || null,
      responsibleName: campos.responsibleName.trim() || null,
      priority: campos.priority,
      status: campos.status,
      dueAt: campos.dueAt || null,
      resolution: campos.resolution.trim() || null,
    };
  }

  function cerrar() {
    // El comentario a medias es de UNA solicitud: cerrar lo limpia para que la
    // próxima no arranque con el texto de la anterior. Al adjuntar, en cambio,
    // se conserva, igual que en el legacy.
    setComentario('');
    setModal(null);
  }

  async function guardar(ev: FormEvent) {
    ev.preventDefault();
    if (!modal) return;
    setGuardando(true);
    try {
      const cuerpo = cuerpoDelFormulario();
      if (modal.modo === 'ver') {
        await api.patch(`/requests/${modal.id}`, cuerpo);
        avisar('Solicitud actualizada');
      } else {
        await api.post('/requests', cuerpo);
        avisar('Solicitud creada');
        // La propuesta de folio es MAX+1 en el servidor: si no se vuelve a
        // pedir, la próxima "Nueva solicitud" propone el número que se acaba
        // de ocupar y el índice único lo rechaza.
        await recargarSettings();
      }
      cerrar();
      await Promise.all([cargarLista(), cargarResumen()]);
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo guardar', true);
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(r: Solicitud) {
    if (!confirm('¿Borrar la solicitud con su hilo y sus adjuntos?')) return;
    try {
      await api.delete(`/requests/${r.id}`);
      avisar('Solicitud borrada');
      await Promise.all([cargarLista(), cargarResumen()]);
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo borrar', true);
    }
  }

  async function agregarComentario() {
    if (modal?.modo !== 'ver') return;
    const contenido = comentario.trim();
    if (!contenido) return avisar('Escribí un comentario primero', true);
    try {
      await api.post(`/requests/${modal.id}/comments`, { content: contenido });
      setComentario('');
      await abrir(modal.id);
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo agregar el comentario', true);
    }
  }

  async function adjuntar() {
    if (modal?.modo !== 'ver') return;
    const archivo = archivoRef.current?.files?.[0];
    if (!archivo) return avisar('Elegí un archivo primero', true);
    if (archivo.size > 750_000) return avisar('El archivo no puede superar 750 KB', true);
    try {
      const data = await leerArchivo(archivo);
      await api.post(`/requests/${modal.id}/attachments`, {
        filename: archivo.name,
        mimeType: archivo.type || null,
        data,
      });
      if (archivoRef.current) archivoRef.current.value = '';
      avisar('Archivo adjuntado');
      await abrir(modal.id);
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo adjuntar el archivo', true);
    }
  }

  async function quitarAdjunto(a: Adjunto) {
    if (modal?.modo !== 'ver') return;
    if (!confirm('¿Quitar este adjunto?')) return;
    try {
      await api.delete(`/requests/${modal.id}/attachments/${a.id}`);
      await abrir(modal.id);
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo quitar el adjunto', true);
    }
  }

  const kpis = resumen
    ? [
        { etiqueta: 'Abiertas', valor: numero(resumen.abiertas), acento: true },
        { etiqueta: 'Vencidas', valor: numero(resumen.vencidas) },
        { etiqueta: 'Resueltas', valor: numero(resumen.resueltas) },
        { etiqueta: 'Prioridad alta', valor: numero(resumen.alta) },
      ]
    : [];

  return (
    <>
      <PageHeader
        titulo="Solicitudes"
        acciones={
          <>
            <Buscador valor={q} onChange={setQ} placeholder="Título, solicitante, responsable…" />
            <BotonPrimario onClick={abrirNueva}>Nueva solicitud</BotonPrimario>
          </>
        }
      />

      {resumen ? <Kpis items={kpis} /> : <EsqueletoKpis />}

      <Tarjeta className="mt-6 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select etiqueta="Estado" value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(ESTADOS).map(([clave, e]) => (
              <option key={clave} value={clave}>
                {e.texto}
              </option>
            ))}
          </Select>
          <Select etiqueta="Prioridad" value={filtroPrioridad} onChange={(e) => setFiltroPrioridad(e.target.value)}>
            <option value="">Todas</option>
            {Object.entries(PRIORIDADES).map(([clave, e]) => (
              <option key={clave} value={clave}>
                {e.texto}
              </option>
            ))}
          </Select>
        </div>
      </Tarjeta>

      <Tarjeta className="mt-6">
        {!solicitudes ? (
          <Spinner />
        ) : (
          <Tabla
            columnas={[
              'Folio',
              'Título',
              'Solicitante',
              'Responsable',
              'Prioridad',
              'Estado',
              'Vence',
              { titulo: '', num: true },
            ]}
          >
            {solicitudes.length === 0 ? (
              <FilaVacia columnas={8} texto="Todavía no hay solicitudes." />
            ) : (
              solicitudes.map((r) => {
                const prioridad = estadoDe(r.priority, PRIORIDADES);
                const estado = estadoDe(r.status, ESTADOS);
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-slate-700">#{r.number}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{r.title}</td>
                    <td className="px-4 py-3 text-slate-500">{r.requesterName}</td>
                    <td className="px-4 py-3 text-slate-500">{r.responsibleName ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Etiqueta texto={prioridad.texto} tono={prioridad.tono} />
                    </td>
                    <td className="px-4 py-3">
                      <Etiqueta texto={estado.texto} tono={estado.tono} />
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {vencida(r) ? <Etiqueta texto={`${dia(r.dueAt)} · vencida`} tono="malo" /> : dia(r.dueAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <BotonChico onClick={() => abrir(r.id).catch((e) => avisar(e.message, true))}>
                          Ver
                        </BotonChico>
                        <BotonChico peligro onClick={() => borrar(r)}>
                          Borrar
                        </BotonChico>
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
          titulo={modal.modo === 'nueva' ? 'Nueva solicitud' : `Solicitud #${modal.numero}`}
          ancho="max-w-3xl"
          onCerrar={cerrar}
        >
          <form onSubmit={guardar} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Campo
                  etiqueta="Folio"
                  name="number"
                  type="number"
                  min={1}
                  step={1}
                  value={campos.number ?? ''}
                  onChange={alCambiar}
                />
                <span className="mt-1 block text-xs text-slate-400">Lo propone el servidor</span>
              </div>
              <Select etiqueta="Prioridad" name="priority" value={campos.priority ?? 'medium'} onChange={alCambiar}>
                {Object.entries(PRIORIDADES).map(([clave, e]) => (
                  <option key={clave} value={clave}>
                    {e.texto}
                  </option>
                ))}
              </Select>
              <Select etiqueta="Estado" name="status" value={campos.status ?? 'open'} onChange={alCambiar}>
                {Object.entries(ESTADOS).map(([clave, e]) => (
                  <option key={clave} value={clave}>
                    {e.texto}
                  </option>
                ))}
              </Select>
            </div>

            <Campo
              etiqueta="Título"
              name="title"
              required
              maxLength={200}
              value={campos.title ?? ''}
              onChange={alCambiar}
              autoFocus
            />
            <Textarea
              etiqueta="Descripción"
              name="description"
              maxLength={4000}
              rows={3}
              value={campos.description ?? ''}
              onChange={alCambiar}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <Campo
                etiqueta="Solicitante"
                name="requesterName"
                required
                maxLength={150}
                value={campos.requesterName ?? ''}
                onChange={alCambiar}
              />
              <Campo
                etiqueta="Correo del solicitante"
                name="requesterEmail"
                type="email"
                maxLength={200}
                value={campos.requesterEmail ?? ''}
                onChange={alCambiar}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo
                etiqueta="Responsable"
                name="responsibleName"
                maxLength={150}
                value={campos.responsibleName ?? ''}
                onChange={alCambiar}
              />
              <Campo
                etiqueta="Fecha límite"
                name="dueAt"
                type="date"
                value={campos.dueAt ?? ''}
                onChange={alCambiar}
              />
            </div>
            <Textarea
              etiqueta="Resolución"
              name="resolution"
              maxLength={4000}
              rows={2}
              value={campos.resolution ?? ''}
              onChange={alCambiar}
            />

            {modal.modo === 'ver' ? (
              <div className="border-t border-slate-100 pt-4">
                <h4 className="text-sm font-semibold text-slate-900">Comentarios</h4>
                <div className="mt-2 divide-y divide-slate-100">
                  {hilo.comments.length === 0 ? (
                    <Vacio texto="Sin comentarios todavía." />
                  ) : (
                    hilo.comments.map((c) => (
                      <article key={c.id} className="py-2.5">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="text-sm font-semibold text-slate-800">{c.authorName}</span>
                          <span className="text-xs text-slate-400">{fecha(c.createdAt)}</span>
                        </div>
                        <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-600">{c.content}</p>
                      </article>
                    ))
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    placeholder="Escribí un comentario…"
                    aria-label="Comentario"
                    maxLength={4000}
                    value={comentario}
                    onChange={(e) => setComentario(e.target.value)}
                  />
                  <BotonPrimario type="button" onClick={agregarComentario}>
                    Agregar
                  </BotonPrimario>
                </div>

                <h4 className="mt-5 text-sm font-semibold text-slate-900">Adjuntos</h4>
                <div className="mt-2 divide-y divide-slate-100">
                  {hilo.attachments.length === 0 ? (
                    <Vacio texto="Sin adjuntos." />
                  ) : (
                    hilo.attachments.map((a) => (
                      <div key={a.id} className="flex flex-wrap items-center gap-3 py-3">
                        <div className="grid min-w-0 flex-1 gap-0.5">
                          <a href={a.url} download={a.filename} className="truncate text-sm font-medium text-brand-700 hover:underline">
                            {a.filename}
                          </a>
                          <span className="text-xs text-slate-400">{(a.sizeBytes / 1024).toFixed(1)} KB</span>
                        </div>
                        <BotonChico peligro onClick={() => quitarAdjunto(a)}>
                          Quitar
                        </BotonChico>
                      </div>
                    ))
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    ref={archivoRef}
                    type="file"
                    aria-label="Archivo para adjuntar"
                    className="min-w-0 flex-1 text-sm text-slate-500 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                  />
                  <BotonPrimario type="button" onClick={adjuntar}>
                    Adjuntar
                  </BotonPrimario>
                </div>

                <h4 className="mt-5 text-sm font-semibold text-slate-900">Historial</h4>
                <div className="mt-2 divide-y divide-slate-100">
                  {hilo.history.length === 0 ? (
                    <Vacio texto="Sin cambios de estado." />
                  ) : (
                    hilo.history.map((h) => (
                      <div key={h.id} className="py-2 text-sm">
                        <div className="font-semibold text-slate-700">
                          {h.oldStatus
                            ? `${estadoDe(h.oldStatus, ESTADOS).texto} → ${estadoDe(h.newStatus, ESTADOS).texto}`
                            : `Creada en estado ${estadoDe(h.newStatus, ESTADOS).texto}`}
                        </div>
                        <div className="text-xs text-slate-400">
                          {h.changedBy} · {fecha(h.createdAt)}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              <BotonSecundario type="button" onClick={cerrar}>
                Cancelar
              </BotonSecundario>
              <BotonPrimario type="submit" disabled={guardando}>
                {guardando
                  ? 'Guardando…'
                  : modal.modo === 'ver'
                    ? 'Guardar cambios'
                    : 'Guardar solicitud'}
              </BotonPrimario>
            </div>
          </form>
        </Modal>
      ) : null}

      <Aviso mensaje={aviso?.mensaje ?? null} tono={aviso?.tono} onLimpiar={limpiarAviso} />
    </>
  );
}
