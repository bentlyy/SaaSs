/** Formas de la API de solicitudes (`products/solicitudes/src/routes.ts`). */

export type Estado = 'open' | 'in_progress' | 'resolved' | 'closed' | 'cancelled';

export type Prioridad = 'low' | 'medium' | 'high' | 'urgent';

export interface Solicitud {
  id: string;
  organizationId: string;
  /** El folio: único por organización, no global. */
  number: number;
  title: string;
  description: string | null;
  requesterName: string;
  requesterEmail: string | null;
  responsibleName: string | null;
  priority: Prioridad;
  status: Estado;
  /** "Para cuándo": fecha AAAA-MM-DD, no un instante. */
  dueAt: string | null;
  resolution: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface Resumen {
  total: number;
  abiertas: number;
  vencidas: number;
  resueltas: number;
  alta: number;
}

export interface Comentario {
  id: string;
  requestId: string;
  authorName: string;
  authorUserId: string | null;
  content: string;
  createdAt: string;
}

export interface Adjunto {
  id: string;
  requestId: string;
  filename: string;
  path: string;
  mimeType: string | null;
  sizeBytes: number;
  createdAt: string;
  /** URL de descarga que arma el servidor al listar el hilo. */
  url: string;
}

export interface EventoHistorial {
  id: string;
  requestId: string;
  oldStatus: Estado | null;
  newStatus: Estado;
  changedBy: string;
  createdAt: string;
}

/** `GET /api/requests/:id`: la solicitud con su hilo completo. */
export interface Detalle {
  request: Solicitud;
  comments: Comentario[];
  attachments: Adjunto[];
  history: EventoHistorial[];
}

/**
 * `GET /api/settings`, ya desenvuelto por el AppProvider.
 *
 * El server lo manda como `{ settings: {…} }`; el envoltorio lo saca el
 * provider, así que acá llega pelado. `nextNumber` es el folio que se propone
 * al abrir una solicitud nueva: la pantalla lo muestra, no lo decide.
 */
export interface AjustesSolicitudes {
  currency: string;
  timezone: string;
  nextNumber: number;
}
