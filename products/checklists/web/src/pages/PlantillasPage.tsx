import { useEffect, useState } from 'react';
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
  PageHeader,
  Select,
  Spinner,
  Tabla,
  Tarjeta,
  Textarea,
  api,
  estadoDe,
  useAviso,
  type MapaEstados,
} from '@amg/ui';
import type { Template, Section, TemplateItem, Structure } from '../tipos';

const ESTADO_TEMPL: MapaEstados = {
  activa: { texto: 'Activa', tono: 'ok' },
  inactiva: { texto: 'Inactiva', tono: 'neutro' },
};

type Tipo = TemplateItem['type'];

const TIPOS: Record<Tipo, string> = {
  yes_no: 'Si / No',
  text: 'Texto',
  number: 'Numero',
  select: 'Seleccion',
};

/** Las opciones de un select escritas en un textarea (una por linea). */
function opcionesDesdeTexto(texto: string) {
  return texto
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Las lineas del textarea de puntos a la lista que espera la API.
 *
 * Un `*` AL FINAL marca el punto como opcional, y se saca del texto: mandarlo
 * como parte de la etiqueta dejaria el asterisco pegado al nombre para siempre.
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

export function PlantillasPage() {
  const { aviso, avisar, limpiarAviso } = useAviso();
  const [plantillas, setPlantillas] = useState<Template[]>([]);
  const [carga, setCarga] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState('1');

  const [modalAlta, setModalAlta] = useState(false);
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [puntosIniciales, setPuntosIniciales] = useState('');

  const [editId, setEditId] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState('');
  const [editDescripcion, setEditDescripcion] = useState('');

  const [estructura, setEstructura] = useState<Structure | null>(null);
  const [cargaEstructura, setCargaEstructura] = useState(false);

  const [seccionNombre, setSeccionNombre] = useState('');
  const [renombrandoSecId, setRenombrandoSecId] = useState<string | null>(null);
  const [renombrandoSecNombre, setRenombrandoSecNombre] = useState('');

  const [puntoSeccion, setPuntoSeccion] = useState('');
  const [puntoLabel, setPuntoLabel] = useState('');
  const [puntoTipo, setPuntoTipo] = useState<Tipo>('yes_no');
  const [puntoRequerido, setPuntoRequerido] = useState(true);
  const [puntoOpciones, setPuntoOpciones] = useState('');

  const [puntoEditarId, setPuntoEditarId] = useState<string | null>(null);
  const [puntoEditarLabel, setPuntoEditarLabel] = useState('');
  const [puntoEditarTipo, setPuntoEditarTipo] = useState<Tipo>('yes_no');
  const [puntoEditarRequerido, setPuntoEditarRequerido] = useState(true);
  const [puntoEditarOpciones, setPuntoEditarOpciones] = useState('');

  async function cargar() {
    const q = busqueda ? '&q=' + encodeURIComponent(busqueda) : '';
    const filtroPart = filtro ? '&active=' + filtro : '';
    const url = '/templates?limit=500' + filtroPart + q;
    const res = await api.get<{ items: Template[] }>(url);
    setPlantillas(res.items);
    setCarga(false);
  }

  useEffect(() => {
    cargar().catch((e) => {
      if ((e as { vencida?: boolean }).vencida) return;
      avisar((e as Error).message, true);
      setCarga(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro]);

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

  /** Pide la estructura de nuevo y repinta el editor abierto. */
  async function refrescarEstructura(plantillaId: string) {
    const res = await api.get<Structure>(`/templates/${plantillaId}/estructura`);
    setEstructura(res);
    return res;
  }

  async function abrirEditor(id: string) {
    setCargaEstructura(true);
    try {
      const res = await api.get<Structure>(`/templates/${id}/estructura`);
      setEstructura(res);
      const primera = res.sections[0];
      setPuntoSeccion(primera ? primera.id : '');
      setPuntoEditarId(null);
      setRenombrandoSecId(null);
    } catch (e) {
      avisar((e as Error).message, true);
    } finally {
      setCargaEstructura(false);
    }
  }

  function cerrarEditor() {
    setEstructura(null);
  }

  async function guardarAlta(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      await api.post('/templates', {
        name: nombre,
        description: descripcion || null,
        items: puntosDesdeTexto(puntosIniciales),
      });
      setModalAlta(false);
      setNombre('');
      setDescripcion('');
      setPuntosIniciales('');
      avisar('Plantilla creada');
      await cargar();
    } catch (err) {
      avisar((err as Error).message, true);
    }
  }

  async function guardarEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editId) return;
    try {
      await api.patch(`/templates/${editId}`, { name: editNombre, description: editDescripcion || null });
      setEditId(null);
      avisar('Plantilla actualizada');
      await cargar();
      if (estructura?.template.id === editId) await refrescarEstructura(editId);
    } catch (err) {
      avisar((err as Error).message, true);
    }
  }

  /** Activar o desactivar: existe, pero no se elige para empezar corridas. */
  async function alternarActiva(t: Template) {
    try {
      await api.patch(`/templates/${t.id}`, { active: !t.active });
      avisar(t.active ? 'Plantilla desactivada' : 'Plantilla activada');
      await cargar();
    } catch (err) {
      avisar((err as Error).message, true);
    }
  }

  async function duplicarPlantilla(t: Template) {
    try {
      await api.post(`/templates/${t.id}/duplicar`, {});
      avisar('Plantilla duplicada');
      await cargar();
    } catch (err) {
      avisar((err as Error).message, true);
    }
  }

  async function borrarPlantilla(t: Template) {
    if (!confirm('Se borrará la plantilla. Las corridas quedan con su copia.')) return;
    try {
      await api.delete(`/templates/${t.id}`);
      avisar('Plantilla borrada');
      await cargar();
      if (estructura?.template.id === t.id) cerrarEditor();
    } catch (err) {
      avisar((err as Error).message, true);
    }
  }

  async function agregarSeccion(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!estructura) return;
    try {
      await api.post(`/templates/${estructura.template.id}/sections`, { name: seccionNombre });
      setSeccionNombre('');
      const res = await refrescarEstructura(estructura.template.id);
      const ultima = res.sections[res.sections.length - 1];
      if (ultima) setPuntoSeccion(ultima.id);
      avisar('Seccion agregada');
      await cargar();
    } catch (err) {
      avisar((err as Error).message, true);
    }
  }

  function iniciarRenombrar(sec: Section) {
    setRenombrandoSecId(sec.id);
    setRenombrandoSecNombre(sec.name);
  }

  function cancelarRenombrar() {
    setRenombrandoSecId(null);
    setRenombrandoSecNombre('');
  }

  async function guardarRenombrar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!estructura || !renombrandoSecId) return;
    try {
      await api.patch(`/templates/${estructura.template.id}/sections/${renombrandoSecId}`, {
        name: renombrandoSecNombre,
      });
      cancelarRenombrar();
      await refrescarEstructura(estructura.template.id);
      avisar('Seccion renombrada');
    } catch (err) {
      avisar((err as Error).message, true);
    }
  }

  /**
   * Mueve una seccion una posicion, mandando el orden NUEVO entero a la API.
   *
   * El servidor exige la lista completa del orden y renumera a 1..N: por eso aca
   * no se toca ningun numero, solo se intercambian los ids.
   */
  async function moverSeccion(sec: Section, dir: -1 | 1) {
    if (!estructura) return;
    const orden = estructura.sections.map((s) => s.id);
    const idx = orden.indexOf(sec.id);
    if (idx < 0) return;
    const otro = idx + dir;
    if (otro < 0 || otro >= orden.length) return;
    [orden[idx], orden[otro]] = [orden[otro], orden[idx]];
    try {
      await api.post(`/templates/${estructura.template.id}/sections/ordenar`, { order: orden });
      await refrescarEstructura(estructura.template.id);
      avisar('Seccion movida');
      await cargar();
    } catch (err) {
      avisar((err as Error).message, true);
    }
  }

  async function borrarSeccion(sec: Section) {
    if (!estructura) return;
    // Borrar una seccion borra SUS PUNTOS con ellas; las corridas ya hechas no
    // se tocan, que es lo que dice el aviso.
    if (!confirm('Se borran la seccion y sus puntos de la plantilla. Las corridas quedan con su copia.')) return;
    try {
      await api.delete(`/templates/${estructura.template.id}/sections/${sec.id}`);
      const res = await refrescarEstructura(estructura.template.id);
      const primera = res.sections[0];
      setPuntoSeccion(primera ? primera.id : '');
      avisar('Seccion borrada y renumerada');
      await cargar();
    } catch (err) {
      avisar((err as Error).message, true);
    }
  }

  async function agregarPunto(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!estructura) return;
    if (puntoTipo === 'select' && opcionesDesdeTexto(puntoOpciones).length === 0) {
      avisar('Un punto de seleccion necesita al menos una opcion', true);
      return;
    }
    const body: { label: string; required: number; type: Tipo; sectionId?: string; options?: string[] } = {
      label: puntoLabel,
      required: puntoRequerido ? 1 : 0,
      type: puntoTipo,
      sectionId: puntoSeccion || undefined,
    };
    if (puntoTipo === 'select') body.options = opcionesDesdeTexto(puntoOpciones);
    try {
      await api.post(`/templates/${estructura.template.id}/items`, body);
      setPuntoLabel('');
      setPuntoOpciones('');
      await refrescarEstructura(estructura.template.id);
      avisar('Punto agregado');
      await cargar();
    } catch (err) {
      avisar((err as Error).message, true);
    }
  }

  function iniciarEditarPunto(item: TemplateItem) {
    setPuntoEditarId(item.id);
    setPuntoEditarLabel(item.label);
    setPuntoEditarTipo(item.type);
    setPuntoEditarRequerido(item.required === 1);
    setPuntoEditarOpciones(item.options ? item.options.join('\n') : '');
  }

  function cancelarEditarPunto() {
    setPuntoEditarId(null);
  }

  async function guardarEditarPunto(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!estructura || !puntoEditarId) return;
    if (puntoEditarTipo === 'select' && opcionesDesdeTexto(puntoEditarOpciones).length === 0) {
      avisar('Un punto de seleccion necesita al menos una opcion', true);
      return;
    }
    const body: { label: string; required: number; type: Tipo; options: string[] } = {
      label: puntoEditarLabel,
      required: puntoEditarRequerido ? 1 : 0,
      type: puntoEditarTipo,
      options: puntoEditarTipo === 'select' ? opcionesDesdeTexto(puntoEditarOpciones) : [],
    };
    try {
      await api.patch(`/templates/${estructura.template.id}/items/${puntoEditarId}`, body);
      setPuntoEditarId(null);
      await refrescarEstructura(estructura.template.id);
      avisar('Punto actualizado');
    } catch (err) {
      avisar((err as Error).message, true);
    }
  }

  /**
   * Quitar un punto de la plantilla. Sin confirm, como el legacy: el punto no
   * se ejecuto nunca, y si la plantilla ya tiene corridas el servidor lo
   * rechaza con su propio aviso.
   */
  async function borrarPunto(item: TemplateItem) {
    if (!estructura) return;
    try {
      await api.delete(`/templates/${estructura.template.id}/items/${item.id}`);
      await refrescarEstructura(estructura.template.id);
      if (puntoEditarId === item.id) setPuntoEditarId(null);
      avisar('Punto quitado y renumerado');
      await cargar();
    } catch (err) {
      avisar((err as Error).message, true);
    }
  }

  return (
    <>
      <PageHeader
        titulo="Plantillas"
        acciones={<BotonPrimario onClick={() => setModalAlta(true)}>Nueva plantilla</BotonPrimario>}
      />

      <Tarjeta titulo="Plantillas">
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-4 py-3">
          <div className="w-full sm:w-60">
            <Buscador valor={busqueda} onChange={setBusqueda} placeholder="Buscar" />
          </div>
          <select
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          >
            <option value="1">Solo activas</option>
            <option value="">Todas</option>
            <option value="0">Solo inactivas</option>
          </select>
        </div>
        {carga ? (
          <Spinner />
        ) : (
          <Tabla columnas={['Nombre', 'Descripción', 'Estado', '']}>
            {plantillas.length === 0 ? (
              <FilaVacia columnas={4} texto="No hay plantillas que coincidan" />
            ) : (
              <>
                {plantillas.map((t) => (
                  <tr key={t.id}>
                    <td className="px-4 py-3 text-sm text-slate-800">{t.name}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">{t.description ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Etiqueta {...estadoDe(t.active ? 'activa' : 'inactiva', ESTADO_TEMPL)} />
                    </td>
                    <td className="px-4 py-3 text-right flex flex-wrap gap-2 justify-end">
                      <BotonChico onClick={() => abrirEditor(t.id)}>Puntos</BotonChico>
                      <BotonChico
                        onClick={() => {
                          setEditId(t.id);
                          setEditNombre(t.name);
                          setEditDescripcion(t.description ?? '');
                        }}
                      >
                        Editar
                      </BotonChico>
                      <BotonChico onClick={() => alternarActiva(t)}>
                        {t.active ? 'Desactivar' : 'Activar'}
                      </BotonChico>
                      <BotonChico onClick={() => duplicarPlantilla(t)}>Duplicar</BotonChico>
                      <BotonChico peligro onClick={() => borrarPlantilla(t)}>
                        Borrar
                      </BotonChico>
                    </td>
                  </tr>
                ))}
              </>
            )}
          </Tabla>
        )}
      </Tarjeta>

      {estructura && (
        <Tarjeta titulo={`Puntos de ${estructura.template.name}`} className="mt-4">
          {cargaEstructura ? (
            <Spinner />
          ) : (
            <>
              <div className="space-y-4 px-4 py-3">
                {estructura.sections.map((sec) => (
                  <div key={sec.id} className="rounded-lg border border-slate-200">
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-3 py-2">
                      {renombrandoSecId === sec.id ? (
                        <form onSubmit={guardarRenombrar} className="flex flex-wrap items-center gap-2">
                          <Campo
                            etiqueta=""
                            value={renombrandoSecNombre}
                            onChange={(e) => setRenombrandoSecNombre(e.target.value)}
                            required
                          />
                          <BotonPrimario type="submit">Renombrar</BotonPrimario>
                          <BotonSecundario type="button" onClick={cancelarRenombrar}>
                            Cancelar
                          </BotonSecundario>
                        </form>
                      ) : (
                        <div className="text-sm font-medium text-slate-700">
                          {sec.sortOrder}. {sec.name}
                        </div>
                      )}
                      {renombrandoSecId !== sec.id && (
                        <div className="flex flex-wrap gap-1">
                          <BotonChico onClick={() => moverSeccion(sec, -1)}>Subir</BotonChico>
                          <BotonChico onClick={() => moverSeccion(sec, 1)}>Bajar</BotonChico>
                          <BotonChico onClick={() => iniciarRenombrar(sec)}>Renombrar</BotonChico>
                          <BotonChico peligro onClick={() => borrarSeccion(sec)}>
                            Borrar sección
                          </BotonChico>
                        </div>
                      )}
                    </div>
                    <div className="divide-y divide-slate-100">
                      {sec.items.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-slate-500">Esta seccion no tiene puntos todavia</div>
                      ) : (
                        sec.items.map((it) => (
                          <div key={it.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                            <div className="text-sm text-slate-700">
                              <span className="font-medium">
                                {it.position}. {it.label}
                              </span>
                              <span className="ml-2 text-xs text-slate-500">
                                {TIPOS[it.type]} · {it.required ? 'obligatorio' : 'opcional'}
                              </span>
                              {it.options && it.options.length > 0 && (
                                <span className="ml-2 text-xs text-slate-400">[{it.options.join(', ')}]</span>
                              )}
                            </div>
                            <div className="flex gap-1">
                              <BotonChico onClick={() => iniciarEditarPunto(it)}>Editar</BotonChico>
                              <BotonChico peligro onClick={() => borrarPunto(it)}>
                                Quitar
                              </BotonChico>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <form onSubmit={agregarSeccion} className="space-y-3 border-t border-slate-100 px-4 py-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-full sm:w-72">
                    <Campo
                      etiqueta="Nueva sección"
                      value={seccionNombre}
                      onChange={(e) => setSeccionNombre(e.target.value)}
                      placeholder="Condiciones de seguridad"
                      required
                    />
                  </div>
                  <BotonPrimario type="submit">Agregar sección</BotonPrimario>
                </div>
              </form>

              <form onSubmit={agregarPunto} className="space-y-3 border-t border-slate-100 px-4 py-4">
                <div className="grid gap-3 md:grid-cols-4">
                  <div>
                    <Select etiqueta="En la sección" value={puntoSeccion} onChange={(e) => setPuntoSeccion(e.target.value)}>
                      {estructura.sections.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.sortOrder}. {s.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Campo etiqueta="Nuevo punto" value={puntoLabel} onChange={(e) => setPuntoLabel(e.target.value)} required />
                  </div>
                  <div>
                    <Select etiqueta="Tipo de respuesta" value={puntoTipo} onChange={(e) => setPuntoTipo(e.target.value as Tipo)}>
                      <option value="yes_no">Si / No</option>
                      <option value="text">Texto</option>
                      <option value="number">Numero</option>
                      <option value="select">Seleccion</option>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                      <input type="checkbox" checked={puntoRequerido} onChange={(e) => setPuntoRequerido(e.target.checked)} />
                      Hay que responderlo
                    </label>
                  </div>
                </div>
                {puntoTipo === 'select' && (
                  <Textarea
                    etiqueta="Opciones del punto (una por linea)"
                    rows={3}
                    value={puntoOpciones}
                    onChange={(e) => setPuntoOpciones(e.target.value)}
                    placeholder={'Bueno\nRegular\nMalo'}
                  />
                )}
                <div>
                  <BotonPrimario type="submit">Agregar punto</BotonPrimario>
                </div>
              </form>

              {puntoEditarId && (
                <form onSubmit={guardarEditarPunto} className="space-y-3 border-t border-slate-100 px-4 py-4">
                  <div className="grid gap-3 md:grid-cols-3">
                    <div>
                      <Campo
                        etiqueta="Texto del punto"
                        value={puntoEditarLabel}
                        onChange={(e) => setPuntoEditarLabel(e.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <Select
                        etiqueta="Tipo de respuesta"
                        value={puntoEditarTipo}
                        onChange={(e) => setPuntoEditarTipo(e.target.value as Tipo)}
                      >
                        <option value="yes_no">Si / No</option>
                        <option value="text">Texto</option>
                        <option value="number">Numero</option>
                        <option value="select">Seleccion</option>
                      </Select>
                    </div>
                    <div className="flex items-end">
                      <label className="flex items-center gap-2 text-sm text-slate-600">
                        <input
                          type="checkbox"
                          checked={puntoEditarRequerido}
                          onChange={(e) => setPuntoEditarRequerido(e.target.checked)}
                        />
                        Hay que responderlo
                      </label>
                    </div>
                  </div>
                  {puntoEditarTipo === 'select' && (
                    <Textarea
                      etiqueta="Opciones del punto (una por linea)"
                      rows={3}
                      value={puntoEditarOpciones}
                      onChange={(e) => setPuntoEditarOpciones(e.target.value)}
                    />
                  )}
                  <div className="flex gap-2">
                    <BotonPrimario type="submit">Guardar cambios</BotonPrimario>
                    <BotonSecundario type="button" onClick={cancelarEditarPunto}>
                      Cancelar
                    </BotonSecundario>
                  </div>
                </form>
              )}

              <div className="border-t border-slate-100 px-4 py-4">
                <BotonSecundario onClick={cerrarEditor}>Cerrar editor</BotonSecundario>
              </div>
            </>
          )}
        </Tarjeta>
      )}

      {modalAlta && (
        <Modal titulo="Nueva plantilla" onCerrar={() => setModalAlta(false)}>
          <form onSubmit={guardarAlta} className="space-y-3">
            <Campo etiqueta="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required maxLength={150} />
            <Campo etiqueta="Descripción" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} maxLength={1000} />
            <Textarea
              etiqueta="Puntos iniciales (uno por linea, tipo Si/No)"
              rows={5}
              value={puntosIniciales}
              onChange={(e) => setPuntosIniciales(e.target.value)}
              placeholder={'Extintor con carga vigente\nPiso sin cables sueltos*'}
            />
            <div className="text-xs text-slate-500">
              Un punto por linea. Si la linea termina en <code>*</code>, el punto es opcional: no hace falta
              responderlo para cerrar una corrida.
            </div>
            <div className="flex justify-end gap-2">
              <BotonSecundario type="button" onClick={() => setModalAlta(false)}>
                Cancelar
              </BotonSecundario>
              <BotonPrimario type="submit">Guardar plantilla</BotonPrimario>
            </div>
          </form>
        </Modal>
      )}

      {editId && (
        <Modal titulo="Editar plantilla" onCerrar={() => setEditId(null)}>
          <form onSubmit={guardarEdit} className="space-y-3">
            <Campo etiqueta="Nombre" value={editNombre} onChange={(e) => setEditNombre(e.target.value)} required maxLength={150} />
            <Campo
              etiqueta="Descripción"
              value={editDescripcion}
              onChange={(e) => setEditDescripcion(e.target.value)}
              maxLength={1000}
            />
            <div className="flex justify-end gap-2">
              <BotonSecundario type="button" onClick={() => setEditId(null)}>
                Cancelar
              </BotonSecundario>
              <BotonPrimario type="submit">Guardar</BotonPrimario>
            </div>
          </form>
        </Modal>
      )}

      <Aviso mensaje={aviso?.mensaje ?? null} tono={aviso?.tono} onLimpiar={limpiarAviso} />
    </>
  );
}
