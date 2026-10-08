import { useEffect, useState } from 'react';
import {
  Aviso,
  BotonChico,
  BotonPrimario,
  EsqueletoKpis,
  Kpis,
  PageHeader,
  Spinner,
  Tarjeta,
  Vacio,
  api,
  estadoDe,
  numero,
  useApp,
  useAviso,
  type Kpi,
} from '@amg/ui';
import { ActivoDialog } from '../componentes/ActivoDialog';
import { FichaDialog } from '../componentes/FichaDialog';
import { ESTADOS } from '../estados';
import { monto } from '../formato';
import type { AjustesActivos, Reciente, Tablero } from '../tipos';

/**
 * Tablero: los números del patrimonio y lo último que se registró.
 *
 * El valor que se muestra es el de los activos en uso y por eso la tarjeta se
 * llama "valor en uso": un bien dado de baja o perdido sigue en el inventario,
 * pero no es capital trabajando.
 *
 * Los KPIs van con la etiqueta (palabra) y la cifra grande por separado: el
 * `kpis` del legacy esperaba `[etiqueta, valor]` y el app.js le mandaba
 * `[valor, etiqueta]`, que era el bug del commit 7d18270.
 */
export function TableroPage() {
  const { settings } = useApp();
  const { aviso, avisar, limpiarAviso } = useAviso();

  const ajustes = (settings ?? null) as AjustesActivos | null;
  const simbolo = ajustes?.currency ?? '$';

  const [tablero, setTablero] = useState<Tablero | null>(null);
  const [dialogo, setDialogo] = useState(false);
  const [fichaId, setFichaId] = useState<string | null>(null);

  async function cargar() {
    setTablero(await api.get<Tablero>('/dashboard'));
  }

  // El tablero se pide una vez al entrar: los cambios lo refrescan las
  // operaciones que lo modifican (crear un activo, archivarlo, moverlo).
  useEffect(() => {
    cargar().catch((e) => {
      if (e.vencida) return;
      avisar(e.message, true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const porStatus = tablero?.porStatus;

  const kpis: Kpi[] = tablero
    ? [
        { etiqueta: 'Activos en libros', valor: numero(tablero.total), acento: true },
        { etiqueta: 'En uso', valor: numero(porStatus?.active ?? 0) },
        { etiqueta: 'En reparacion', valor: numero(porStatus?.repair ?? 0) },
        { etiqueta: 'Dados de baja', valor: numero(porStatus?.retired ?? 0) },
        { etiqueta: 'Perdidos', valor: numero(porStatus?.lost ?? 0) },
        { etiqueta: 'Valor en uso', valor: monto(tablero.valorEnUsoCents, simbolo) },
      ]
    : [];

  const recientes = tablero?.recientes ?? [];

  /** La línea de datos de una ficha recién registrada, como la leía el legacy. */
  const notaDe = (a: Reciente) =>
    [estadoDe(a.status, ESTADOS).texto, a.assignedTo, a.location, monto(a.costCents, simbolo)]
      .filter(Boolean)
      .join(' · ');

  return (
    <>
      <PageHeader
        titulo="Tablero"
        subtitulo="Resumen del patrimonio"
        acciones={<BotonPrimario onClick={() => setDialogo(true)}>Nuevo activo</BotonPrimario>}
      />

      {tablero ? <Kpis items={kpis} /> : <EsqueletoKpis cuantos={6} />}

      <Tarjeta titulo="Últimos activos registrados" className="mt-6">
        {!tablero ? (
          <Spinner />
        ) : recientes.length === 0 ? (
          <Vacio texto="Todavia no hay activos registrados" />
        ) : (
          <div className="divide-y divide-slate-100">
            {recientes.map((a) => (
              <div key={a.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-800">
                    {a.code} · {a.name}
                  </div>
                  {/* Los datos que vienen, se muestran; los que no, no se inventan. */}
                  <div className="text-xs text-slate-500">{notaDe(a)}</div>
                </div>
                <BotonChico onClick={() => setFichaId(a.id)}>Ficha</BotonChico>
              </div>
            ))}
          </div>
        )}
      </Tarjeta>

      {dialogo ? (
        <ActivoDialog
          activo={null}
          avisar={avisar}
          onCerrar={() => setDialogo(false)}
          onGuardado={cargar}
        />
      ) : null}

      {fichaId ? (
        <FichaDialog activoId={fichaId} avisar={avisar} onCerrar={() => setFichaId(null)} alMover={cargar} />
      ) : null}

      <Aviso mensaje={aviso?.mensaje ?? null} tono={aviso?.tono} onLimpiar={limpiarAviso} />
    </>
  );
}
