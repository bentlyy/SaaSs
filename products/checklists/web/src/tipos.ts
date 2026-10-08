export interface Template {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  active: number;
  createdAt: string;
  updatedAt?: string | null;
}

export interface Section {
  id: string;
  organizationId: string;
  templateId: string;
  name: string;
  sortOrder: number;
  createdAt?: string;
}

export interface TemplateItem {
  id: string;
  organizationId: string;
  templateId: string;
  sectionId: string;
  position: number;
  label: string;
  required: number;
  type: 'yes_no' | 'text' | 'number' | 'select';
  optionsJson: string | null;
  options?: string[] | null;
  createdAt?: string;
  updatedAt?: string | null;
}

export interface Structure {
  template: Template;
  sections: Array<Section & { items: TemplateItem[] }>;
}

export interface Run {
  id: string;
  organizationId: string;
  templateId: string | null;
  templateName: string;
  templateItemsJson: string;
  location: string | null;
  status: 'in_progress' | 'done' | 'canceled';
  result: 'approved' | 'observed' | 'rejected' | null;
  performedBy: string | null;
  notes: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

export interface RunItem {
  id: string;
  organizationId: string;
  runId: string;
  itemId: string | null;
  position: number;
  label: string;
  required: number;
  type: 'yes_no' | 'text' | 'number' | 'select';
  optionsJson: string | null;
  options?: string[] | null;
  result: 'ok' | 'fail' | 'na' | null;
  valueText: string | null;
  note: string | null;
  answeredAt: string | null;
  createdAt?: string;
  updatedAt?: string | null;
}

export interface Attachment {
  id: string;
  organizationId: string;
  runId: string;
  filename: string;
  mimeType: string | null;
  path: string;
  sizeBytes: number;
  createdAt: string;
  url?: string;
}

export interface RunSnapshotItem {
  position: number;
  label: string;
  required: number;
  type: 'yes_no' | 'text' | 'number' | 'select';
  options: string[] | null;
  section: string | null;
}

export interface RunFicha {
  run: Run;
  items: RunItem[];
  snapshot: { templateName: string; items: RunSnapshotItem[] };
  resumen: {
    total: number;
    ok: number;
    fail: number;
    na: number;
    respondidos: number;
    pendientes: number;
    pendientesRequeridos: number;
    cumplimientoPct: number | null;
  };
  attachments: Attachment[];
}

export interface Tablero {
  total: number;
  porStatus: { in_progress: number; done: number; canceled: number };
  porResultado: { approved: number; observed: number; rejected: number; sin: number };
  cumplimientoPromedioPct: number | null;
  corridasCompletadasConsideradas: number;
  fallos: Array<{
    runId: string;
    templateName: string;
    location: string | null;
    startedAt: string | null;
    position: number;
    label: string;
    note: string | null;
    answeredAt: string | null;
  }>;
}

export interface Settings {
  organizationId: string;
  currency?: string;
  timezone?: string;
}
