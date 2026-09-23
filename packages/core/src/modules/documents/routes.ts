import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { getDb, schema } from '../../db/index.js';
import { asyncHandler, AppError } from '../../utils/http.js';
import { authRequired } from '../../middleware/auth.js';
import { getOwned as getCustomer } from '../customers/routes.js';
import { createId } from '../../db/id.js';

export const documentsRouter = Router();
documentsRouter.use(authRequired);

const lineSchema = z.object({
  description: z.string().min(1).max(300),
  qty: z.number().int().positive(),
  price: z.number().nonnegative(), // en unidades monetarias (USD/MXN...)
});

const documentSchema = z.object({
  type: z.enum(['cotizacion', 'recibo']).default('cotizacion'),
  title: z.string().min(1).max(120).optional(),
  customerId: z.string().min(1),
  lines: z.array(lineSchema).min(1, 'Agrega al menos una línea'),
  taxPercent: z.number().min(0).max(100).default(0),
});

const toCents = (amount: number) => Math.round(amount * 100);

documentsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { db } = getDb();
    const rows = db.select().from(schema.documents)
      .where(eq(schema.documents.tenant_id, req.session.tenantId))
      .orderBy(desc(schema.documents.created_at))
      .limit(200)
      .all();
    return res.json({ documents: rows.map(decode) });
  }),
);

documentsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = documentSchema.parse(req.body);
    const { db, sqlite } = getDb();
    const tenantId = req.session.tenantId;
    const customer = getCustomer(db, tenantId, input.customerId);

    const subtotal = input.lines.reduce((acc, l) => acc + toCents(l.price) * l.qty, 0);
    const tax = Math.round(subtotal * (input.taxPercent / 100));

    const insert = sqlite.transaction(() => {
      const number = `${input.type === 'recibo' ? 'R' : 'C'}-${Date.now().toString(36).toUpperCase()}`;
      return db.insert(schema.documents).values({
        tenant_id: tenantId,
        type: input.type,
        number,
        customer_id: customer.id,
        customer_snapshot: JSON.stringify({
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
        }),
        title: input.title ?? (input.type === 'recibo' ? 'Recibo' : 'Cotización'),
        lines: JSON.stringify(input.lines),
        subtotal,
        tax,
        total: subtotal + tax,
      }).returning().get();
    });

    const doc = decode(insert());
    return res.status(201).json({ document: doc });
  }),
);

documentsRouter.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const input = z.object({ status: z.enum(['draft', 'sent', 'accepted', 'rejected']) }).parse(req.body);
    const { db } = getDb();
    const existing = getOwned(db, req.session.tenantId, req.params.id);
    const row = db.update(schema.documents).set({ status: input.status })
      .where(eq(schema.documents.id, existing.id)).returning().get();
    return res.json({ document: decode(row) });
  }),
);

documentsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { db } = getDb();
    const existing = getOwned(db, req.session.tenantId, req.params.id);
    db.delete(schema.documents).where(and(eq(schema.documents.id, existing.id), eq(schema.documents.tenant_id, req.session.tenantId))).run();
    return res.json({ ok: true });
  }),
);

documentsRouter.get(
  '/:id/pdf',
  asyncHandler(async (req, res) => {
    const { db } = getDb();
    const doc = getOwned(db, req.session.tenantId, req.params.id);
    const tenant = db.select().from(schema.tenants).where(eq(schema.tenants.id, req.session.tenantId)).get();
    if (!tenant) throw new AppError(404, 'Negocio no encontrado');

    const PDFDocument = (await import('pdfkit')).default;
    const decoded = decode(doc);
    const docPdf = new PDFDocument({ size: 'A4', margins: { top: 48, bottom: 48, left: 48, right: 48 } });
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="${doc.number}.pdf"`);
    docPdf.pipe(res);

    docPdf.font('Helvetica-Bold').fontSize(20).text(tenant.name, { align: 'right' });
    docPdf.font('Helvetica').fontSize(10).fillColor('#666');
    if (tenant.address) docPdf.text(tenant.address, { align: 'right' });
    if (tenant.phone) docPdf.text(tenant.phone, { align: 'right' });
    docPdf.moveDown();

    docPdf.fillColor('#111').fontSize(14).font('Helvetica-Bold').text(decoded.title);
    docPdf.font('Helvetica').fontSize(10).fillColor('#666').text(`No. ${doc.number}`);
    docPdf.moveDown();

    docPdf.text(`Cliente: ${customerName(decoded)}`, { align: 'left' });
    docPdf.moveDown();

    docPdf.font('Helvetica-Bold').fillColor('#111').text('Detalle');
    for (const line of decoded.lines) {
      const price = formatMoney(line.price);
      const label = `${line.qty}× ${line.description}`;
      docPdf.font('Helvetica').fontSize(10).fillColor('#333')
        .text(label, { continued: true })
        .text(` ${price}`, { align: 'right', lineBreak: false });
    }
    docPdf.moveDown(2);

    const right = { columns: 140, height: 24, align: 'right' } as const;
    docPdf.font('Helvetica').fontSize(10).fillColor('#111');
    docPdf.text(`Subtotal: ${formatMoney(decoded.subtotal)}`, right);
    if (decoded.tax > 0) docPdf.text(`Impuesto: ${formatMoney(decoded.tax)}`, right);
    docPdf.font('Helvetica-Bold').text(`Total: ${formatMoney(decoded.total)}`, right);

    docPdf.moveDown(3);
    docPdf.fontSize(8).fillColor('#999').text(`Generado por ${process.env.APP_NAME ?? 'SaaS Mini'} · ${new Date().toISOString()}`);

    docPdf.end();
    return undefined;
  }),
);

function decode(doc: typeof schema.documents.$inferSelect) {
  return {
    ...doc,
    customer: safeParse(doc.customer_snapshot, { name: '' }),
    lines: safeParse(doc.lines, []),
    subtotal: doc.subtotal / 100,
    tax: doc.tax / 100,
    total: doc.total / 100,
  };
}

function safeParse(json: string, fallback: unknown) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

function customerName(doc: ReturnType<typeof decode>) {
  return doc.customer?.name ?? 'Cliente';
}

export function formatMoney(cents: number) {
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

export function getOwned(db: ReturnType<typeof getDb>['db'], tenantId: string, id: string) {
  const row = db.select().from(schema.documents)
    .where(and(eq(schema.documents.id, id), eq(schema.documents.tenant_id, tenantId)))
    .get();
  if (!row) throw new AppError(404, 'Documento no encontrado');
  return row;
}