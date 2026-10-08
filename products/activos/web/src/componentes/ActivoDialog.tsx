import { useState, type FormEvent } from 'react';
import { BotonChico, BotonPrimario, BotonSecundario, Campo, Modal, Select, api, estadoDe, useApp } from '@amg/ui';
import { ESTADOS, ESTADOS_VALOR } from '../estados';
import { monto } from '../formato';
import type { Activo, AjustesActivos, Estado } from '../tipos';

interface Props {
  /** El activo a editar, o `null` para dar de alta. */
  activo: Activo | null;
  avisar: (mensaje: string, malo?: boolean) => void;
  onCerrar: () => void;
  /** Recarga la lista o el tablero del padre después de guardar. */
  onGuardado: () => Promise<void> | void;
}

const VACIO = {
  code: '',
  name: '',
  category: '',
  brand: '',
  model: '',
  serial: '',
  status: 'active',
  location: '',
  assignedTo: '',
  purchaseDate: '',
  costCents: '0',
  notes: '',
};

/**
 * Alta y edición de un activo.
 *
 * El costo va en CENTAVOS y no en pesos a propósito: es la misma unidad en que
 * se guarda y en que viaja por la API, y por eso esta pantalla no multiplica ni
 * divide el monto para mandarlo. El texto de ayuda muestra cómo se va a ver.
 *
 * El código lo propone el servidor (`/assets/next-code`): es el único que sabe
 * cuál es el número más alto de ESTA empresa, así que la pantalla no lo calcula.
 */
export function ActivoDialog({ activo, avisar, onCerrar, onGuardado }: Props) {
  const { settings } = useApp();
  const ajustes = (settings ?? null) as AjustesActivos | null;
  const simbolo = ajustes?.currency ?? '$';

  const [campos, setCampos] = useState<Record<string, string>>(() =>
    activo
      ? {
          code: activo.code,
          name: activo.name,
          category: activo.category,
          brand: activo.brand ?? '',
          model: activo.model ?? '',
          serial: activo.serial ?? '',
          status: activo.status,
          location: activo.location ?? '',
          assignedTo: activo.assignedTo ?? '',
          purchaseDate: activo.purchaseDate ?? '',
          costCents: String(activo.costCents ?? 0),
          notes: activo.notes ?? '',
        }
      : { ...VACIO },
  );
  const [guardando, setGuardando] = useState(false);

  const alCambiar = (ev: { target: { name: string; value: string } }) =>
    setCampos((c) => ({ ...c, [ev.target.name]: ev.target.value }));

  async function proponerCodigo() {
    try {
      const propuesta = await api.get<{ code: string }>('/assets/next-code');
      setCampos((c) => ({ ...c, code: propuesta.code }));
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo proponer un código', true);
    }
  }

  async function guardar(ev: FormEvent) {
    ev.preventDefault();
    setGuardando(true);
    try {
      // Los campos vacíos viajan como null y no como "": el servidor distingue
      // "no lo tengo" de "lo tengo en blanco", y la ficha los muestra distinto.
      const cuerpo = {
        code: campos.code,
        name: campos.name,
        category: campos.category,
        brand: campos.brand || null,
        model: campos.model || null,
        serial: campos.serial || null,
        status: campos.status,
        location: campos.location || null,
        assignedTo: campos.assignedTo || null,
        purchaseDate: campos.purchaseDate || null,
        // El costo va en centavos, que es como lo guarda la API. El número
        // entero se manda tal cual: convertirlo acá sería hacerlo dos veces.
        costCents: Number(campos.costCents || 0),
        notes: campos.notes || null,
      };
      if (activo) {
        await api.patch(`/assets/${activo.id}`, cuerpo);
      } else {
        await api.post('/assets', cuerpo);
      }
      onCerrar();
      await onGuardado();
      avisar(activo ? 'Activo actualizado' : 'Activo creado');
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo guardar el activo', true);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo={activo ? 'Editar activo' : 'Nuevo activo'} onCerrar={onCerrar} ancho="max-w-2xl">
      <form onSubmit={guardar} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Campo
              etiqueta="Codigo"
              name="code"
              required
              maxLength={40}
              value={campos.code}
              onChange={alCambiar}
              autoFocus
            />
            <div className="mt-1">
              <BotonChico type="button" onClick={proponerCodigo}>
                Proponer
              </BotonChico>
            </div>
          </div>
          <Campo etiqueta="Nombre" name="name" required maxLength={150} value={campos.name} onChange={alCambiar} />
        </div>

        <Campo
          etiqueta="Categoria"
          name="category"
          required
          maxLength={150}
          placeholder="herramienta, equipo de computo, vehiculo"
          value={campos.category}
          onChange={alCambiar}
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <Campo etiqueta="Marca" name="brand" maxLength={80} value={campos.brand} onChange={alCambiar} />
          <Campo etiqueta="Modelo" name="model" maxLength={80} value={campos.model} onChange={alCambiar} />
          <Campo
            etiqueta="Numero de serie"
            name="serial"
            maxLength={80}
            value={campos.serial}
            onChange={alCambiar}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Select etiqueta="Estado" name="status" value={campos.status} onChange={alCambiar}>
            {ESTADOS_VALOR.map((e: Estado) => (
              <option key={e} value={e}>
                {estadoDe(e, ESTADOS).texto}
              </option>
            ))}
          </Select>
          <Campo
            etiqueta="Ubicacion"
            name="location"
            maxLength={150}
            value={campos.location}
            onChange={alCambiar}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Campo
            etiqueta="Lo tiene"
            name="assignedTo"
            maxLength={120}
            value={campos.assignedTo}
            onChange={alCambiar}
          />
          <Campo etiqueta="Comprado el" name="purchaseDate" type="date" value={campos.purchaseDate} onChange={alCambiar} />
          <div>
            <Campo
              etiqueta="Costo (centavos)"
              name="costCents"
              type="number"
              min={0}
              step={1}
              value={campos.costCents}
              onChange={alCambiar}
            />
            <span className="mt-1 block text-xs text-slate-400">
              se ve como {monto(Number(campos.costCents || 0), simbolo)}
            </span>
          </div>
        </div>

        <Campo etiqueta="Notas" name="notes" maxLength={2000} value={campos.notes} onChange={alCambiar} />

        <div className="flex justify-end gap-2 pt-2">
          <BotonSecundario type="button" onClick={onCerrar}>
            Cancelar
          </BotonSecundario>
          <BotonPrimario type="submit" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </BotonPrimario>
        </div>
      </form>
    </Modal>
  );
}
