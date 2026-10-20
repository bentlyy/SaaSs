import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import {
  Aviso,
  BotonPeligro,
  BotonPrimario,
  BotonSecundario,
  Campo,
  Etiqueta,
  FilaVacia,
  Modal,
  NotaError,
  PageHeader,
  Select,
  Spinner,
  Tabla,
  Tarjeta,
  api,
  fecha,
  numero,
  useApp,
  useAviso,
} from '@amg/ui';
import type {
  AjustesInventario,
  Articulo,
  Categoria,
  IncidenciaEscaneo,
  ModoEscaneo,
  ResultadoEscaneo,
} from '../tipos';
import { mensajeDeCamara } from '../lib/camara';
import { aCentavos, monedaDe } from '../lib/moneda';

/**
 * Escáner móvil de códigos de barras.
 *
 * La cámara lee y traduce un código a un artículo, pero NO mueve stock: entre
 * la lectura y el cambio hay una confirmación explícita. Ese es el punto de
 * todo el diseño — una lectura repetida por accidente no puede mover nada; lo
 * que mueve es la tanda que la persona confirmó.
 *
 * El bloqueo de 2,5 s por código evita que la cámara, que lee muchas veces por
 * segundo, sume la misma etiqueta sola. Pasado el bloqueo, volver a leer el
 * mismo código es intencional: así se cargan varias unidades escaneando. Y
 * además cada línea del carrito tiene su cantidad editable, para no tener que
 * escanear las cinco unidades de una caja.
 */

const LOCK_MS = 2500;

const MODOS: Array<{ id: ModoEscaneo; label: string; ayuda: string }> = [
  { id: 'in', label: 'Entrada', ayuda: 'Suma las cantidades al stock.' },
  { id: 'out', label: 'Salida', ayuda: 'Resta las cantidades del stock.' },
  { id: 'adjust', label: 'Ajuste', ayuda: 'Deja el stock exactamente en la cantidad contada.' },
];

interface LineaCarrito {
  itemId: string;
  name: string;
  unit: string;
  quantity: number;
}

export function EscanerPage() {
  const { cuenta, settings } = useApp();
  const { aviso, avisar, limpiarAviso } = useAviso();

  const ajustes = settings as AjustesInventario | null;
  const simbolo = monedaDe(ajustes?.currency).simbolo;
  const admin = cuenta?.rol === 'admin' || cuenta?.rol === 'owner';

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  // Por código: hasta cuándo ignorar lecturas repetidas de la misma etiqueta.
  const cooldownRef = useRef<Map<string, number>>(new Map());
  // Códigos con una consulta en vuelo, para no pedir el mismo dos veces.
  const pendientesRef = useRef<Set<string>>(new Set());

  const [camara, setCamara] = useState<'apagada' | 'activa' | 'pausada'>('apagada');
  const [iniciando, setIniciando] = useState(false);
  const [errorCamara, setErrorCamara] = useState<string | null>(null);

  const [modo, setModo] = useState<ModoEscaneo>('in');
  const [motivo, setMotivo] = useState('');
  const [carrito, setCarrito] = useState<LineaCarrito[]>([]);
  const [enviando, setEnviando] = useState(false);

  const [desconocido, setDesconocido] = useState<{ code: string } | null>(null);
  const [nuevo, setNuevo] = useState<Record<string, string>>({});
  const [guardandoNuevo, setGuardandoNuevo] = useState(false);
  const [errorNuevo, setErrorNuevo] = useState<string | null>(null);
  const [registrarIncidencia, setRegistrarIncidencia] = useState(true);

  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [incidencias, setIncidencias] = useState<IncidenciaEscaneo[] | null>(null);

  const cargarIncidencias = useCallback(async () => {
    try {
      const r = await api.get<{ incidents: IncidenciaEscaneo[] }>('/scan-incidents?limit=20');
      setIncidencias(r.incidents);
    } catch {
      setIncidencias([]);
    }
  }, []);

  useEffect(() => {
    api
      .get<{ items: Categoria[] }>('/categories?limit=500')
      .then((r) => setCategorias(r.items))
      .catch(() => setCategorias([]));
    void cargarIncidencias();
  }, [cargarIncidencias]);

  const agregarAlCarrito = useCallback(
    (item: Articulo) => {
      setCarrito((lineas) => {
        const i = lineas.findIndex((l) => l.itemId === item.id);
        if (i >= 0) {
          const copia = [...lineas];
          copia[i] = { ...copia[i], quantity: copia[i].quantity + 1 };
          return copia;
        }
        return [...lineas, { itemId: item.id, name: item.name, unit: item.unit, quantity: 1 }];
      });
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(80);
      avisar(`${item.name}: agregado`);
    },
    [avisar],
  );

  const manejarCodigo = useCallback(
    async (code: string) => {
      if (pendientesRef.current.has(code)) return;
      pendientesRef.current.add(code);
      try {
        const r = await api.get<ResultadoEscaneo>(`/scan/lookup?code=${encodeURIComponent(code)}`);
        if (r.found && r.item) {
          agregarAlCarrito(r.item);
        } else {
          setNuevo({
            name: '',
            unit: ajustes?.defaultUnit ?? 'unidad',
            categoryId: '',
            stockInicial: '0',
            minQuantity: String(ajustes?.defaultMinQuantity ?? 0),
            precio: '0',
          });
          setErrorNuevo(null);
          setRegistrarIncidencia(true);
          setDesconocido({ code });
        }
      } catch (e) {
        if (!(e as { vencida?: boolean }).vencida) avisar(e instanceof Error ? e.message : 'Error al buscar el código', true);
      } finally {
        pendientesRef.current.delete(code);
      }
    },
    [agregarAlCarrito, ajustes, avisar],
  );

  const detenerCamara = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
  }, []);

  const iniciarCamara = useCallback(async () => {
    if (controlsRef.current || iniciando) return;
    setErrorCamara(null);
    setIniciando(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('sin-soporte');
      if (!readerRef.current) {
        readerRef.current = new BrowserMultiFormatReader(undefined, {
          delayBetweenScanSuccess: 400,
          delayBetweenScanAttempts: 200,
        });
      }
      const controls = await readerRef.current.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } } },
        videoRef.current ?? undefined,
        (result) => {
          if (!result) return;
          const code = result.getText().trim();
          if (!code) return;
          const ahora = Date.now();
          if ((cooldownRef.current.get(code) ?? 0) > ahora) return;
          cooldownRef.current.set(code, ahora + LOCK_MS);
          void manejarCodigo(code);
        },
      );
      controlsRef.current = controls;
      setCamara('activa');
    } catch (e) {
      setErrorCamara(mensajeDeCamara(e));
      setCamara('apagada');
    } finally {
      setIniciando(false);
    }
  }, [iniciando, manejarCodigo]);

  // Al desmontar, la cámara se apaga: si no, el indicador sigue prendido.
  useEffect(() => () => detenerCamara(), [detenerCamara]);

  function cambiarCantidad(itemId: string, cantidad: number) {
    setCarrito((lineas) =>
      lineas.map((l) => (l.itemId === itemId ? { ...l, quantity: Math.max(0, Math.min(1_000_000, cantidad)) } : l)),
    );
  }

  async function confirmar() {
    const lineas = carrito
      .filter((l) => (modo === 'adjust' ? l.quantity >= 0 : l.quantity > 0))
      .map((l) => ({ itemId: l.itemId, quantity: l.quantity }));
    if (lineas.length === 0) {
      avisar('No hay lecturas para confirmar', true);
      return;
    }
    setEnviando(true);
    try {
      const r = await api.post<{ movimientos: number }>('/scan/commit', { mode: modo, reason: motivo, lines: lineas });
      setCarrito([]);
      setMotivo('');
      avisar(r.movimientos === 0 ? 'Sin cambios que registrar' : `Listo: ${numero(r.movimientos)} movimiento(s)`);
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo confirmar', true);
    } finally {
      setEnviando(false);
    }
  }

  async function crearProducto(ev: FormEvent) {
    ev.preventDefault();
    if (!desconocido) return;
    setGuardandoNuevo(true);
    setErrorNuevo(null);
    try {
      const creado = await api.post<Articulo>('/items', {
        name: nuevo.name,
        barcode: desconocido.code,
        unit: nuevo.unit || 'unidad',
        categoryId: nuevo.categoryId || undefined,
        minQuantity: Number(nuevo.minQuantity || 0),
        priceCents: aCentavos(nuevo.precio || 0),
      });
      const stock = Number(nuevo.stockInicial || 0);
      if (stock > 0) {
        await api.post('/scan/commit', {
          mode: 'in',
          reason: 'Stock inicial (alta rápida)',
          lines: [{ itemId: creado.id, quantity: stock }],
        });
      }
      setDesconocido(null);
      avisar(`Artículo "${creado.name}" creado`);
    } catch (e) {
      setErrorNuevo(e instanceof Error ? e.message : 'No se pudo crear el artículo');
    } finally {
      setGuardandoNuevo(false);
    }
  }

  async function ignorar() {
    if (!desconocido) return;
    const code = desconocido.code;
    setDesconocido(null);
    try {
      if (registrarIncidencia) {
        await api.post('/scan-incidents', { barcode: code, note: 'Ignorado desde el escáner' });
        void cargarIncidencias();
      }
      avisar(`Código ${code} ignorado`);
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo registrar la incidencia', true);
    }
  }

  async function borrarIncidencia(id: string) {
    try {
      await api.delete(`/scan-incidents/${id}`);
      void cargarIncidencias();
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo borrar', true);
    }
  }

  const ayudaModo = useMemo(() => MODOS.find((m) => m.id === modo)?.ayuda ?? '', [modo]);

  return (
    <>
      <PageHeader titulo="Escáner" subtitulo="Leé códigos de barras y confirmá el movimiento" />

      {!admin ? (
        <div className="mb-4">
          <NotaError mensaje="Solo administradores pueden confirmar movimientos. Podés escanear y agregar artículos." />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Cámara */}
        <Tarjeta
          titulo="Cámara"
          nota={camara === 'activa' ? 'Buscando códigos…' : camara === 'pausada' ? 'En pausa' : 'Apagada'}
        >
          <div className="p-4">
            <div className="relative overflow-hidden rounded-xl bg-slate-900">
              <video ref={videoRef} className="aspect-[4/3] w-full object-cover" muted playsInline />
              {camara !== 'activa' ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center text-slate-300">
                  <p className="text-sm">{camara === 'pausada' ? 'Cámara en pausa' : 'La cámara está apagada'}</p>
                </div>
              ) : (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="h-1/3 w-3/4 rounded-lg border-2 border-white/70 shadow-[0_0_0_9999px_rgba(15,23,42,0.25)]" />
                </div>
              )}
            </div>

            {errorCamara ? (
              <div className="mt-3">
                <NotaError mensaje={errorCamara} />
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2">
              {camara === 'apagada' ? (
                <BotonPrimario onClick={iniciarCamara} disabled={iniciando}>
                  {iniciando ? 'Iniciando…' : 'Iniciar cámara'}
                </BotonPrimario>
              ) : null}
              {camara === 'activa' ? (
                <BotonSecundario onClick={() => { detenerCamara(); setCamara('pausada'); }}>Pausar</BotonSecundario>
              ) : null}
              {camara === 'pausada' ? <BotonPrimario onClick={iniciarCamara} disabled={iniciando}>Reanudar</BotonPrimario> : null}
              {camara !== 'apagada' ? (
                <BotonSecundario onClick={() => { detenerCamara(); setCamara('apagada'); }}>Cerrar cámara</BotonSecundario>
              ) : null}
            </div>

            <p className="mt-3 text-xs text-slate-400">
              La lectura no cambia el stock: se acumula acá y se aplica al confirmar.
              {ajustes?.allowNegativeStock ? ' Esta organización permite stock negativo.' : ''}
            </p>
          </div>
        </Tarjeta>

        {/* Operación */}
        <Tarjeta titulo="Movimiento a confirmar">
          <div className="space-y-4 p-4">
            <div>
              <span className="mb-1 block text-sm font-medium text-slate-700">Modo</span>
              <div className="grid grid-cols-3 gap-2">
                {MODOS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setModo(m.id)}
                    className={`min-h-11 rounded-lg border px-3 py-2 text-sm font-medium transition-colors sm:min-h-0 ${
                      modo === m.id
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-400">{ayudaModo}</p>
            </div>

            <Campo
              etiqueta="Motivo (opcional)"
              placeholder="Ej: recepción de proveedor"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />

            {carrito.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
                Todavía no escaneaste nada.
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {carrito.map((l) => (
                  <li key={l.itemId} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">{l.name}</p>
                      <p className="text-xs text-slate-400">{l.unit}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label="Menos"
                        onClick={() => cambiarCantidad(l.itemId, l.quantity - 1)}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50 sm:h-8 sm:w-8"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min={0}
                        value={l.quantity}
                        onChange={(e) => cambiarCantidad(l.itemId, Number(e.target.value))}
                        className="w-16 rounded-md border border-slate-300 px-2 py-1 text-center text-sm"
                      />
                      <button
                        type="button"
                        aria-label="Más"
                        onClick={() => cambiarCantidad(l.itemId, l.quantity + 1)}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50 sm:h-8 sm:w-8"
                      >
                        +
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCarrito((lineas) => lineas.filter((x) => x.itemId !== l.itemId))}
                      className="inline-flex min-h-11 items-center text-xs text-slate-400 hover:text-red-600 sm:min-h-0"
                    >
                      Quitar
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex justify-end gap-2">
              {carrito.length > 0 ? (
                <BotonSecundario type="button" onClick={() => setCarrito([])}>
                  Vaciar
                </BotonSecundario>
              ) : null}
              <BotonPrimario type="button" onClick={confirmar} disabled={!admin || enviando || carrito.length === 0}>
                {enviando ? 'Confirmando…' : 'Confirmar movimiento'}
              </BotonPrimario>
            </div>
          </div>
        </Tarjeta>
      </div>

      {/* Incidencias */}
      <Tarjeta titulo="Códigos ignorados" nota="Lecturas que no se cargaron" className="mt-6">
        {!incidencias ? (
          <Spinner />
        ) : (
          <Tabla columnas={['Código', 'Quién', 'Cuándo', { titulo: '', num: true }]}>
            {incidencias.length === 0 ? (
              <FilaVacia columnas={4} texto="No hay códigos ignorados." />
            ) : (
              incidencias.map((i) => (
                <tr key={i.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-sm text-slate-700">{i.barcode}</td>
                  <td className="px-4 py-3 text-slate-500">{i.actorName || '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{fecha(i.createdAt, true)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => borrarIncidencia(i.id)}
                      className="inline-flex min-h-11 items-center text-xs text-slate-400 hover:text-red-600 sm:min-h-0"
                    >
                      Borrar
                    </button>
                  </td>
                </tr>
              ))
            )}
          </Tabla>
        )}
      </Tarjeta>

      {/* Alta rápida de un código desconocido */}
      {desconocido ? (
        <Modal titulo="Producto desconocido" onCerrar={() => setDesconocido(null)} ancho="max-w-lg">
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              Código <span className="font-mono text-slate-700">{desconocido.code}</span> no está en el catálogo.
            </p>
            <form onSubmit={crearProducto} className="space-y-3">
                <Campo
                  etiqueta="Nombre"
                  required
                  autoFocus
                  value={nuevo.name ?? ''}
                  onChange={(e) => setNuevo((c) => ({ ...c, name: e.target.value }))}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Campo
                    etiqueta="Unidad"
                    value={nuevo.unit ?? ''}
                    onChange={(e) => setNuevo((c) => ({ ...c, unit: e.target.value }))}
                  />
                  <Select
                    etiqueta="Categoría"
                    value={nuevo.categoryId ?? ''}
                    onChange={(e) => setNuevo((c) => ({ ...c, categoryId: e.target.value }))}
                  >
                    <option value="">Sin categoría</option>
                    {categorias.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Campo
                    etiqueta="Stock inicial"
                    type="number"
                    min={0}
                    value={nuevo.stockInicial ?? '0'}
                    onChange={(e) => setNuevo((c) => ({ ...c, stockInicial: e.target.value }))}
                  />
                  <Campo
                    etiqueta="Stock mínimo"
                    type="number"
                    min={0}
                    value={nuevo.minQuantity ?? '0'}
                    onChange={(e) => setNuevo((c) => ({ ...c, minQuantity: e.target.value }))}
                  />
                  <Campo
                    etiqueta={`Precio (${simbolo})`}
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min={0}
                    value={nuevo.precio ?? '0'}
                    onChange={(e) => setNuevo((c) => ({ ...c, precio: e.target.value }))}
                  />
                </div>

                <NotaError mensaje={errorNuevo} />

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={registrarIncidencia}
                      onChange={(e) => setRegistrarIncidencia(e.target.checked)}
                    />
                    Registrar como ignorado
                  </label>
                  <div className="flex gap-2">
                    <BotonPeligro type="button" onClick={ignorar}>
                      Ignorar
                    </BotonPeligro>
                    <BotonPrimario type="submit" disabled={guardandoNuevo}>
                      {guardandoNuevo ? 'Guardando…' : 'Agregar producto'}
                    </BotonPrimario>
                  </div>
                </div>
              </form>
            <div>
              <Etiqueta texto="El stock inicial se registra como una entrada" tono="neutro" />
            </div>
          </div>
        </Modal>
      ) : null}

      <Aviso mensaje={aviso?.mensaje ?? null} tono={aviso?.tono} onLimpiar={limpiarAviso} />
    </>
  );
}
