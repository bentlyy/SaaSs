import { useEffect, useRef, useState } from 'react';
import {
  Aviso,
  BotonChico,
  BotonPrimario,
  BotonSecundario,
  BotonPeligro,
  Buscador,
  Campo,
  Etiqueta,
  FilaVacia,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Tabla,
  Tarjeta,
  Textarea,
  api,
  estadoDe,
  fecha,
  useAviso,
  type MapaEstados,
} from '@amg/ui';
import type { Run, Template, RunFicha, RunItem, Attachment } from '../tipos';

type ResultadoGlobal = 'approved' | 'observed' | 'rejected';
type ResultadoPunto = 'ok' | 'fail' | 'na';
type TipoPunto = RunItem['type'];

const RUN_ESTADO: MapaEstados = {
  in_progress: { texto: 'En curso', tono: 'acento' },
  done: { texto: 'Completada', tono: 'ok' },
  canceled: { texto: 'Cancelada', tono: 'neutro' },
};

const RUN_RESULT: MapaEstados = {
  approved: { texto: 'Aprobado', tono: 'ok' },
  observed: { texto: 'Observado', tono: 'aviso' },
  rejected: { texto: 'Rechazado', tono: 'malo' },
};

/** Las respuestas posibles de un punto Si/No y su etiqueta. */
const RESPUESTAS: ResultadoPunto[] = ['ok', 'fail', 'na'];

const RESULTADO: MapaEstados = {
  ok: { texto: 'Cumple', tono: 'ok' },
  fail: { texto: 'No cumple', tono: 'malo' },
  na: { texto: 'No aplica', tono: 'aviso' },
};

const TIPOS: Record<TipoPunto, string> = {
  yes_no: 'Si / No',
  text: 'Texto',
  number: 'Numero',
  select: 'Seleccion',
};

/**
 * Las lineas del textarea de puntos a la lista que espera la API.
 *
 * Un `*` AL FINAL marca el punto como opcional, y se saca del texto: mandarlo
 * como parte de la etiqueta dejaría el asterisco pegado al nombre para siempre.
 */
function puntosDesdeTexto(texto: string) {
  return texto
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter(Boolean)
    .map((linea) => {
      const opcional = linea.endsWith('*');
      const label = (opcional ? linea.slice(0, -1) : linea).trim();
      return { label, required: opcional ? 0 : 1, type: 'yes_no' as const };
    })
    .filter((punto) => punto.label !== '');
}

function tamanoCorto(bytes: number) {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${bytes} B`;
}

/** El control de UN punto de la corrida, según su tipo y la nota del punto. */
function PuntoDetalle({
  it,
  editable,
  onResponder,
}: {
  it: RunItem;
  editable: boolean;
  onResponder: (
    posicion: number,
    cuerpo: { result?: ResultadoPunto; valueText?: string | null },
    nota: string,
  ) => void;
}) {
  const [valor, setValor] = useState(it.valueText ?? '');
  const [nota, setNota] = useState(it.note ?? '');

  if (!editable) {
    const texto =
      it.type === 'yes_no' ? (it.result ? estadoDe(it.result, RESULTADO).texto : '—') : it.valueText || '—';
    return (
      <div className="rounded-lg border border-slate-200 p-3">
        <div className="text-sm">
          <span className="font-medium text-slate-800">
            {it.position}. {it.label}
          </span>
          <span className="ml-2 text-xs text-slate-500">
            {TIPOS[it.type]} · {it.required ? 'obligatorio' : 'opcional'}
          </span>
        </div>
        <div className="mt-1 rounded bg-slate-50 px-2 py-1 text-sm text-slate-700">{texto}</div>
        {it.answeredAt && <div className="mt-1 text-xs text-slate-400">respondido {fecha(it.answeredAt, true)}</div>}
        {it.note && <div className="mt-1 text-xs text-slate-500">{it.note}</div>}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 text-sm">
        <span className="font-medium text-slate-800">
          {it.position}. {it.label}
        </span>
        <span className="ml-2 text-xs text-slate-500">
          {TIPOS[it.type]} · {it.required ? 'obligatorio' : 'opcional'}
        </span>
        {it.answeredAt && <span className="ml-2 text-xs text-slate-400">respondido {fecha(it.answeredAt, true)}</span>}
      </div>

      {it.type === 'yes_no' ? (
        <div className="flex flex-wrap gap-2">
          {RESPUESTAS.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={it.result === r}
              onClick={() => onResponder(it.position, { result: r }, nota)}
              className={`rounded-lg border px-3 py-1 text-sm transition-colors ${
                it.result === r
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {estadoDe(r, RESULTADO).texto}
            </button>
          ))}
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onResponder(it.position, { valueText: valor || null }, nota);
          }}
          className="flex flex-wrap items-end gap-2"
        >
          {it.type === 'select' ? (
            <select
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            >
              <option value="">Elegir…</option>
              {(it.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={it.type === 'number' ? 'number' : 'text'}
              maxLength={4000}
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder="Respuesta"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:w-72"
            />
          )}
          <BotonPrimario type="submit">Guardar</BotonPrimario>
        </form>
      )}

      <input
        maxLength={2000}
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        placeholder="Nota del punto"
        className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      />
    </div>
  );
}

export function CorridasPage() {
  const { aviso, avisar, limpiarAviso } = useAviso();
  const [corridas, setCorridas] = useState<Run[]>([]);
  const [carga, setCarga] = useState(true);

  const [plantillas, setPlantillas] = useState<Template[]>([]);
  const [filtroEstado, setFiltroEstado] = useState('');
  const [filtroPlantilla, setFiltroPlantilla] = useState('');
  const [busqueda, setBusqueda] = useState('');

  const [modalCrear, setModalCrear] = useState(false);
  const [crearPlantilla, setCrearPlantilla] = useState('');
  const [crearLugar, setCrearLugar] = useState('');
  const [crearNotas, setCrearNotas] = useState('');
  const [crearItems, setCrearItems] = useState('');

  const [fichaRunId, setFichaRunId] = useState<string | null>(null);
  const [ficha, setFicha] = useState<RunFicha | null>(null);
  const [cargaFicha, setCargaFicha] = useState(false);

  const [editLugar, setEditLugar] = useState('');
  const [editEstado, setEditEstado] = useState<Run['status']>('in_progress');
  const [editResultado, setEditResultado] = useState<'' | ResultadoGlobal>('');
  const [editNotas, setEditNotas] = useState('');

  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function cargarPlantillas() {
    const res = await api.get<{ items: Template[] }>('/templates?limit=500');
    setPlantillas(res.items);
  }

  async function cargar() {
    let url = '/runs?limit=500';
    if (filtroEstado) url += `&status=${encodeURIComponent(filtroEstado)}`;
    if (filtroPlantilla) url += `&template_id=${encodeURIComponent(filtroPlantilla)}`;
    if (busqueda) url += `&q=${encodeURIComponent(busqueda)}`;
    const res = await api.get<{ items: Run[] }>(url);
    setCorridas(res.items);
    setCarga(false);
  }

  useEffect(() => {
    cargar().catch((e) => {
      if ((e as { vencida?: boolean }).vencida) return;
      avisar((e as Error).message, true);
      setCarga(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroEstado, filtroPlantilla]);

  useEffect(() => {
    const t = setTimeout(() => {
      cargar().catch((e) => {
        if ((e as { vencida?: boolean }).vencida) return;
        avisar((e as Error).message, true);
      });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda]);

  useEffect(() => {
    cargarPlantillas().catch((e) => {
      if ((e as { vencida?: boolean }).vencida) return;
      avisar((e as Error).message, true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refrescarFicha(runId: string | null = fichaRunId) {
    if (!runId) return;
    const res = await api.get<RunFicha>(`/runs/${runId}/ficha`);
    setFicha(res);
    setEditLugar(res.run.location ?? '');
    setEditEstado(res.run.status);
    setEditResultado(res.run.result ? (res.run.result as ResultadoGlobal) : '');
    setEditNotas(res.run.notes ?? '');
  }

  async function abrirFicha(runId: string) {
    setFichaRunId(runId);
    setCargaFicha(true);
    try {
      await refrescarFicha(runId);
    } catch (e) {
      if ((e as { vencida?: boolean }).vencida) return;
      avisar((e as Error).message, true);
      setFichaRunId(null);
    } finally {
      setCargaFicha(false);
    }
  }

  function cerrarFicha() {
    setFichaRunId(null);
    setFicha(null);
  }

  async function crearCorrida(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const cuerpo: {
        location: string | null;
        notes: string | null;
        templateId?: string;
        items?: Array<{ label: string; required: number; type: 'yes_no' }>;
      } = { location: crearLugar || null, notes: crearNotas || null };
      if (crearPlantilla) {
        cuerpo.templateId = crearPlantilla;
      } else {
        cuerpo.items = puntosDesdeTexto(crearItems);
        if (cuerpo.items.length === 0) {
          avisar('Una corrida libre necesita al menos un punto', true);
          return;
        }
      }
      const creada = await api.post<{ run: Run }>('/runs', cuerpo);
      setModalCrear(false);
      setCrearLugar('');
      setCrearNotas('');
      setCrearItems('');
      await cargar();
      await abrirFicha(creada.run.id);
      avisar('Corrida empezada. Sus puntos quedaron copiados de la plantilla.');
    } catch (e) {
      avisar((e as Error).message, true);
    }
  }

  async function responderPunto(
    posicion: number,
    cuerpo: { result?: ResultadoPunto; valueText?: string | null },
    nota: string,
  ) {
    if (!fichaRunId) return;
    try {
      await api.post(`/runs/${fichaRunId}/items/${posicion}`, { ...cuerpo, note: nota || null });
      await refrescarFicha();
      avisar('Respuesta registrada');
    } catch (e) {
      avisar((e as Error).message, true);
    }
  }

  /** Cerrar la corrida; el veredicto se manda solo si se eligió. */
  async function completar(runId: string, resultado: '' | ResultadoGlobal = '') {
    try {
      await api.post(`/runs/${runId}/completar`, resultado ? { result: resultado } : {});
      await cargar();
      await abrirFicha(runId);
      avisar('Corrida completada y sellada');
    } catch (e) {
      avisar((e as Error).message, true);
    }
  }

  async function cancelarCorrida() {
    if (!fichaRunId) return;
    try {
      await api.patch(`/runs/${fichaRunId}`, { status: 'canceled' });
      await cargar();
      await abrirFicha(fichaRunId);
      avisar('Corrida cancelada');
    } catch (e) {
      avisar((e as Error).message, true);
    }
  }

  async function reabrir() {
    if (!fichaRunId) return;
    try {
      await api.patch(`/runs/${fichaRunId}`, { status: 'in_progress' });
      await cargar();
      await abrirFicha(fichaRunId);
      avisar('Corrida reabierta');
    } catch (e) {
      avisar((e as Error).message, true);
    }
  }

  async function guardarEdicion(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!fichaRunId) return;
    try {
      const cuerpo: {
        location: string | null;
        notes: string | null;
        status: Run['status'];
        result?: string | null;
      } = { location: editLugar || null, notes: editNotas || null, status: editEstado };
      // El veredicto se escribe al cerrar: un PATCH que lo mande sobre una
      // corrida abierta recibe 400. Solo va cuando se cierra o ya está cerrada.
      if (editEstado === 'done' || ficha?.run.status === 'done') cuerpo.result = editResultado || null;
      await api.patch(`/runs/${fichaRunId}`, cuerpo);
      await refrescarFicha();
      await cargar();
      avisar('Corrida actualizada');
    } catch (e) {
      avisar((e as Error).message, true);
    }
  }

  async function subirAdjunto(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!fichaRunId) return;
    if (!file) return avisar('Elige un archivo primero', true);
    if (file.size > 750_000) return avisar('El archivo no puede superar 750 KB', true);
    try {
      const data = await new Promise<string>((resolver, rechazar) => {
        const lector = new FileReader();
        lector.onload = () => resolver(String(lector.result));
        lector.onerror = () => rechazar(new Error('No se pudo leer el archivo'));
        lector.readAsDataURL(file);
      });
      const separado = data.indexOf(';base64,');
      await api.post(`/runs/${fichaRunId}/attachments`, {
        filename: file.name,
        mimeType: file.type || null,
        data: separado >= 0 ? data.slice(separado + ';base64,'.length) : data,
      });
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      await refrescarFicha();
      avisar('Archivo adjuntado');
    } catch (e) {
      avisar((e as Error).message, true);
    }
  }

  async function quitarAdjunto(att: Attachment) {
    if (!fichaRunId) return;
    try {
      await api.delete(`/runs/${fichaRunId}/attachments/${att.id}`);
      await refrescarFicha();
      avisar('Adjunto quitado');
    } catch (e) {
      avisar((e as Error).message, true);
    }
  }

  async function borrarCorrida() {
    if (!fichaRunId) return;
    if (!confirm('Se borrará la corrida. ¿Continuar?')) return;
    try {
      await api.delete(`/runs/${fichaRunId}`);
      cerrarFicha();
      await cargar();
      avisar('Corrida borrada');
    } catch (e) {
      avisar((e as Error).message, true);
    }
  }

  const activas = plantillas.filter((t) => t.active);

  const editable = ficha?.run.status === 'in_progress';

  const seccionDe = new Map<number, string | null>();
  if (ficha) for (const p of ficha.snapshot.items) seccionDe.set(p.position, p.section ?? null);
  const grupos: Array<{ nombre: string | null; items: RunItem[] }> = [];
  if (ficha) {
    for (const p of ficha.items) {
      const seccion = seccionDe.get(p.position) ?? null;
      const ultimo = grupos[grupos.length - 1];
      if (!ultimo || ultimo.nombre !== seccion) grupos.push({ nombre: seccion, items: [] });
      grupos[grupos.length - 1].items.push(p);
    }
  }

  return (
    <>
      <PageHeader
        titulo="Corridas"
        acciones={
          <BotonPrimario onClick={() => setModalCrear(true)}>Empezar corrida</BotonPrimario>
        }
      />

      <Tarjeta titulo="Corridas">
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-4 py-3">
          <div className="w-full sm:w-60">
            <Buscador valor={busqueda} onChange={setBusqueda} placeholder="Plantilla o lugar" />
          </div>
          <select
            value={filtroEstado}
            onChange={(e) => setFiltroEstado(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          >
            <option value="">Cualquier estado</option>
            <option value="in_progress">En curso</option>
            <option value="done">Completadas</option>
            <option value="canceled">Canceladas</option>
          </select>
          <select
            value={filtroPlantilla}
            onChange={(e) => setFiltroPlantilla(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          >
            <option value="">Todas</option>
            {plantillas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {carga ? (
          <Spinner />
        ) : (
          <Tabla columnas={['Plantilla', 'Lugar', 'Estado', 'Responsable', 'Veredicto', 'Empezó', 'Cerrada', '']}>
            {corridas.length === 0 ? (
              <FilaVacia columnas={8} texto="No hay corridas que coincidan" />
            ) : (
              <>
                {corridas.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3 text-sm">
                      <div className="font-medium text-slate-800">{r.templateName}</div>
                      {!r.templateId && <div className="text-xs text-slate-500">plantilla borrada</div>}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500">{r.location ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Etiqueta {...estadoDe(r.status, RUN_ESTADO)} />
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500">{r.performedBy ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">
                      {r.result ? estadoDe(r.result, RUN_RESULT).texto : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500">{fecha(r.startedAt, true) || '—'}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">{fecha(r.completedAt, true) || '—'}</td>
                    <td className="px-4 py-3 text-right flex flex-wrap gap-2 justify-end">
                      <BotonChico onClick={() => abrirFicha(r.id)}>Ficha</BotonChico>
                      {r.status === 'in_progress' && <BotonChico onClick={() => completar(r.id)}>Completar</BotonChico>}
                    </td>
                  </tr>
                ))}
              </>
            )}
          </Tabla>
        )}
      </Tarjeta>

      {modalCrear && (
        <Modal titulo="Empezar una corrida" onCerrar={() => setModalCrear(false)}>
          <form onSubmit={crearCorrida} className="space-y-3">
            <Select etiqueta="Plantilla" value={crearPlantilla} onChange={(e) => setCrearPlantilla(e.target.value)}>
              <option value="">Corrida libre (sin plantilla)</option>
              {activas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Campo etiqueta="Lugar" value={crearLugar} onChange={(e) => setCrearLugar(e.target.value)} maxLength={150} placeholder="Bodega 2, faena norte" />
            <Campo etiqueta="Notas" value={crearNotas} onChange={(e) => setCrearNotas(e.target.value)} maxLength={2000} />
            <Textarea
              etiqueta="Puntos (solo si la corrida es libre)"
              rows={4}
              value={crearItems}
              onChange={(e) => setCrearItems(e.target.value)}
              placeholder="Solo para corrida libre: un punto por linea, * marca los opcionales"
            />
            <div className="flex justify-end gap-2">
              <BotonSecundario type="button" onClick={() => setModalCrear(false)}>
                Cancelar
              </BotonSecundario>
              <BotonPrimario type="submit">Empezar corrida</BotonPrimario>
            </div>
          </form>
        </Modal>
      )}

      {fichaRunId && (
        <Modal titulo="Ficha de corrida" onCerrar={cerrarFicha} ancho="xl">
          {cargaFicha || !ficha ? (
            <Spinner />
          ) : (
            <div className="space-y-4">
              {ficha.resumen.pendientesRequeridos > 0 && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  Faltan {ficha.resumen.pendientesRequeridos} punto(s) obligatorio(s) por responder
                </p>
              )}

              <div className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-slate-800">{ficha.run.templateName}</h2>
                  <Etiqueta {...estadoDe(ficha.run.status, RUN_ESTADO)} />
                  {ficha.run.result && (
                    <Etiqueta texto={`Veredicto: ${estadoDe(ficha.run.result, RUN_RESULT).texto}`} tono="neutro" />
                  )}
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  {ficha.run.location && <span>{ficha.run.location}</span>}
                  {ficha.run.performedBy && (
                    <span>
                      {ficha.run.location ? ' · ' : ''}responsable: {ficha.run.performedBy}
                    </span>
                  )}
                </div>
                <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  <div className="flex gap-1">
                    <dt className="text-slate-500">Empezó:</dt>
                    <dd>{fecha(ficha.run.startedAt, true) || '—'}</dd>
                  </div>
                  {ficha.run.completedAt && (
                    <div className="flex gap-1">
                      <dt className="text-slate-500">Cerrada:</dt>
                      <dd>{fecha(ficha.run.completedAt, true)}</dd>
                    </div>
                  )}
                  <div className="flex gap-1">
                    <dt className="text-slate-500">Cumplimiento:</dt>
                    <dd>{ficha.resumen.cumplimientoPct == null ? '—' : `${ficha.resumen.cumplimientoPct}%`}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt className="text-slate-500">Puntos:</dt>
                    <dd>
                      {ficha.resumen.ok} cumple · {ficha.resumen.fail} no cumple · {ficha.resumen.na} no aplica
                    </dd>
                  </div>
                </dl>
                {ficha.run.notes && (
                  <div className="mt-3 text-sm">
                    <span className="text-slate-500">Notas: </span>
                    {ficha.run.notes}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-700">Puntos de esta corrida</h3>
                {grupos.length === 0 ? (
                  <p className="py-2 text-sm text-slate-500">No hay puntos que revisar</p>
                ) : (
                  grupos.map((g, i) => (
                    <div key={i} className="space-y-2">
                      {g.nombre && (
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{g.nombre}</div>
                      )}
                      {g.items.map((p) => (
                        <PuntoDetalle key={p.id} it={p} editable={editable} onResponder={responderPunto} />
                      ))}
                    </div>
                  ))
                )}
              </div>

              <div className="rounded-lg border border-slate-200 p-4">
                <div className="mb-2 text-sm font-medium text-slate-800">Adjuntos</div>
                {ficha.attachments.length === 0 ? (
                  <p className="text-sm text-slate-500">Sin adjuntos</p>
                ) : (
                  <div className="space-y-2">
                    {ficha.attachments.map((att) => (
                      <div key={att.id} className="flex flex-wrap items-center gap-2 text-sm">
                        <a href={att.url} download={att.filename} className="text-brand-600 hover:underline">
                          {att.filename}
                        </a>
                        <span className="text-xs text-slate-400">
                          {[tamanoCorto(att.sizeBytes), att.createdAt && fecha(att.createdAt, true)]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                        {editable && (
                          <BotonChico peligro onClick={() => quitarAdjunto(att)}>
                            Quitar
                          </BotonChico>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {editable && (
                  <>
                    <form onSubmit={subirAdjunto} className="mt-3 flex flex-wrap items-end gap-2">
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/*,video/*,application/pdf,application/*"
                        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                        className="max-w-full text-sm"
                      />
                      <BotonPrimario type="submit">Adjuntar</BotonPrimario>
                    </form>
                    <p className="mt-1 text-xs text-slate-500">Hasta 750 KB por archivo.</p>
                  </>
                )}
              </div>

              <form onSubmit={guardarEdicion} className="rounded-lg border border-slate-200 p-4">
                <div className="mb-2 text-sm font-medium text-slate-800">Editar corrida</div>
                <div className="grid gap-3 md:grid-cols-3">
                  <Campo etiqueta="Lugar" value={editLugar} onChange={(e) => setEditLugar(e.target.value)} maxLength={150} />
                  <Select etiqueta="Estado" value={editEstado} onChange={(e) => setEditEstado(e.target.value as Run['status'])}>
                    <option value="in_progress">En curso</option>
                    <option value="done">Completada</option>
                    <option value="canceled">Cancelada</option>
                  </Select>
                  <Select
                    etiqueta="Veredicto global"
                    value={editResultado}
                    onChange={(e) => setEditResultado(e.target.value as '' | ResultadoGlobal)}
                  >
                    <option value="">(al completar, se deriva)</option>
                    <option value="approved">Aprobado</option>
                    <option value="observed">Observado</option>
                    <option value="rejected">Rechazado</option>
                  </Select>
                </div>
                <div className="mt-3">
                  <Campo etiqueta="Notas" value={editNotas} onChange={(e) => setEditNotas(e.target.value)} maxLength={2000} />
                </div>
                <div className="mt-3">
                  <BotonPrimario type="submit">Guardar cambios</BotonPrimario>
                </div>
              </form>

              <div className="flex flex-wrap gap-2">
                <BotonPrimario onClick={() => completar(fichaRunId, editResultado)} disabled={!editable}>
                  Completar corrida
                </BotonPrimario>
                <BotonSecundario onClick={cancelarCorrida} disabled={ficha.run.status === 'canceled'}>
                  Cancelar corrida
                </BotonSecundario>
                <BotonSecundario onClick={reabrir} disabled={editable}>
                  Reabrir
                </BotonSecundario>
                <BotonPeligro onClick={borrarCorrida}>Borrar corrida</BotonPeligro>
                <BotonSecundario onClick={cerrarFicha}>Cerrar</BotonSecundario>
              </div>
            </div>
          )}
        </Modal>
      )}

      <Aviso mensaje={aviso?.mensaje ?? null} tono={aviso?.tono} onLimpiar={limpiarAviso} />
    </>
  );
}