import type { Response } from 'express';
import PDFDocument from 'pdfkit';
import { formatearDinero, formatearFecha } from './moneda.js';

/**
 * PDF de una cotizacion.
 *
 * Se arma en el servidor para que el documento no dependa del navegador ni de
 * una hoja de estilos de impresion: lo que baja es siempre el mismo PDF, con el
 * mismo folio, los mismos importes materializados y la identidad comercial de la
 * organizacion.
 *
 * No se usan imagenes ni fuentes externas: la identidad es texto. Un logo
 * remoto haria que el PDF dependa de otra URL y abriria la puerta a leer redes
 * internas desde el servidor.
 */

export const ETIQUETA_ESTADO: Record<string, string> = {
  draft: 'Borrador',
  sent: 'Enviada',
  accepted: 'Aceptada',
  rejected: 'Rechazada',
  expired: 'Vencida',
};

export interface PdfCotizacion {
  number: number;
  status: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  title: string | null;
  issueDate: string | null;
  validUntil: string | null;
  notes: string | null;
  subtotalCents: number;
  discountCents: number;
  taxRateBp: number;
  taxCents: number;
  totalCents: number;
}

export interface PdfLinea {
  description: string;
  qty: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface PdfIdentidad {
  businessName: string | null;
  businessTaxId: string | null;
  businessAddress: string | null;
  businessPhone: string | null;
  businessEmail: string | null;
}

export interface PdfDatos {
  cot: PdfCotizacion;
  lineas: PdfLinea[];
  identidad: PdfIdentidad;
  currency: string;
  /** Nombre de la organizacion del Core, para cuando no configuraron razon social. */
  organizacion: string;
}

const MARGEN = 50;
const ANCHO = 595.28;
const ALTO = 841.89;
const UTIL = ANCHO - MARGEN * 2;

/** Porcentaje legible desde puntos basicos: 1900 -> "19%". */
function porcentaje(bp: number): string {
  const valor = bp / 100;
  return `${Number.isInteger(valor) ? valor : valor.toFixed(2).replace('.', ',')}%`;
}

export function enviarPdfCotizacion(res: Response, datos: PdfDatos): void {
  const { cot, lineas, identidad, currency, organizacion } = datos;
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN, info: { Title: `Cotizacion ${cot.number}` } });
  const nombreEmpresa = identidad.businessName?.trim() || organizacion || 'Cotizacion';

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="cotizacion-${cot.number}.pdf"`);
  res.setHeader('Cache-Control', 'no-store');
  doc.pipe(res);

  // ── cabecera: identidad a la izquierda, folio a la derecha ─────────────
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#0f172a').text(nombreEmpresa, MARGEN, MARGEN, { width: 300 });
  const datosEmpresa = [
    identidad.businessTaxId?.trim() ? `RUT: ${identidad.businessTaxId.trim()}` : null,
    identidad.businessAddress?.trim(),
    identidad.businessPhone?.trim() ? `Tel: ${identidad.businessPhone.trim()}` : null,
    identidad.businessEmail?.trim(),
  ].filter(Boolean) as string[];
  if (datosEmpresa.length) {
    doc.font('Helvetica').fontSize(9).fillColor('#64748b').text(datosEmpresa.join('\n'), MARGEN, doc.y + 4, {
      width: 300,
      lineGap: 1,
    });
  }

  doc.font('Helvetica-Bold').fontSize(20).fillColor('#0f172a').text('COTIZACION', MARGEN, MARGEN, {
    width: UTIL,
    align: 'right',
  });
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#0f172a').text(`#${cot.number}`, MARGEN, MARGEN + 26, {
    width: UTIL,
    align: 'right',
  });
  doc.font('Helvetica').fontSize(9).fillColor('#64748b').text(ETIQUETA_ESTADO[cot.status] ?? cot.status, MARGEN, MARGEN + 44, {
    width: UTIL,
    align: 'right',
  });

  let y = Math.max(doc.y, MARGEN + 70);
  doc.moveTo(MARGEN, y).lineTo(ANCHO - MARGEN, y).strokeColor('#e2e8f0').lineWidth(1).stroke();
  y += 16;

  // ── cliente y vigencia ─────────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#475569').text('CLIENTE', MARGEN, y);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text(cot.customerName, MARGEN, y + 13, { width: 260 });
  const contacto = [cot.customerEmail, cot.customerPhone].filter(Boolean).join('  ·  ');
  if (contacto) {
    doc.font('Helvetica').fontSize(9).fillColor('#64748b').text(contacto, MARGEN, doc.y + 2, { width: 260 });
  }
  if (cot.title) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#64748b').text(cot.title, MARGEN, doc.y + 3, { width: 260 });
  }

  const xMeta = MARGEN + 320;
  doc.font('Helvetica').fontSize(9).fillColor('#475569');
  doc.text(`Emision: ${formatearFecha(cot.issueDate)}`, xMeta, y, { width: UTIL - 320, align: 'right' });
  doc.text(`Valida hasta: ${formatearFecha(cot.validUntil)}`, xMeta, y + 13, { width: UTIL - 320, align: 'right' });

  y = Math.max(doc.y + 18, y + 60);

  // ── tabla de lineas ────────────────────────────────────────────────────
  const columnas = { desc: MARGEN, qty: MARGEN + 250, unit: MARGEN + 320, total: MARGEN + 410 };
  const anchoCol = { desc: 240, qty: 60, unit: 82, total: UTIL - 410 };

  function cabeceraTabla() {
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748b');
    doc.text('DESCRIPCION', columnas.desc, y, { width: anchoCol.desc, lineBreak: false });
    doc.text('CANT.', columnas.qty, y, { width: anchoCol.qty, align: 'right', lineBreak: false });
    doc.text('P. UNITARIO', columnas.unit, y, { width: anchoCol.unit, align: 'right', lineBreak: false });
    doc.text('TOTAL', columnas.total, y, { width: anchoCol.total, align: 'right', lineBreak: false });
    y += 13;
    doc.moveTo(MARGEN, y).lineTo(ANCHO - MARGEN, y).strokeColor('#cbd5e1').lineWidth(0.8).stroke();
    y += 7;
  }

  cabeceraTabla();

  for (const linea of lineas) {
    doc.font('Helvetica').fontSize(9);
    const altoDesc = Math.max(14, doc.heightOfString(linea.description, { width: anchoCol.desc }));
    if (y + altoDesc > ALTO - 150) {
      doc.addPage();
      y = MARGEN;
      cabeceraTabla();
      doc.font('Helvetica').fontSize(9);
    }
    doc.fillColor('#0f172a').text(linea.description, columnas.desc, y, { width: anchoCol.desc });
    doc.fillColor('#334155');
    doc.text(String(linea.qty), columnas.qty, y, { width: anchoCol.qty, align: 'right' });
    doc.text(formatearDinero(linea.unitPriceCents, currency), columnas.unit, y, {
      width: anchoCol.unit,
      align: 'right',
    });
    doc.text(formatearDinero(linea.lineTotalCents, currency), columnas.total, y, {
      width: anchoCol.total,
      align: 'right',
    });
    y += altoDesc + 6;
    doc.moveTo(MARGEN, y).lineTo(ANCHO - MARGEN, y).strokeColor('#f1f5f9').lineWidth(0.6).stroke();
    y += 6;
  }

  if (!lineas.length) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#94a3b8').text('Sin lineas cargadas.', MARGEN, y, {
      width: UTIL,
    });
    y = doc.y + 12;
  }

  // ── totales ────────────────────────────────────────────────────────────
  if (y > ALTO - 170) {
    doc.addPage();
    y = MARGEN;
  }
  y += 10;
  const xEtiqueta = MARGEN + 300;
  const anchoEtiqueta = 100;
  const xValor = MARGEN + 400;
  const anchoValor = UTIL - 400;

  const fila = (etiqueta: string, valor: string, negrita = false) => {
    doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(negrita ? 11 : 9);
    doc.fillColor(negrita ? '#0f172a' : '#475569').text(etiqueta, xEtiqueta, y, {
      width: anchoEtiqueta,
      align: 'right',
    });
    doc.fillColor('#0f172a').text(valor, xValor, y, { width: anchoValor, align: 'right' });
    y += negrita ? 18 : 14;
  };

  fila('Subtotal', formatearDinero(cot.subtotalCents, currency));
  if (cot.discountCents > 0) {
    fila('Descuento', `-${formatearDinero(cot.discountCents, currency)}`);
  }
  fila(`Impuesto (${porcentaje(cot.taxRateBp)})`, formatearDinero(cot.taxCents, currency));
  doc.moveTo(xEtiqueta, y).lineTo(ANCHO - MARGEN, y).strokeColor('#cbd5e1').lineWidth(0.8).stroke();
  y += 6;
  fila('TOTAL', formatearDinero(cot.totalCents, currency), true);

  // ── notas y pie ────────────────────────────────────────────────────────
  if (cot.notes?.trim()) {
    if (y > ALTO - 120) {
      doc.addPage();
      y = MARGEN;
    }
    y += 10;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#475569').text('Notas', MARGEN, y);
    doc.font('Helvetica').fontSize(9).fillColor('#334155').text(cot.notes.trim(), MARGEN, y + 13, { width: UTIL });
    y = doc.y + 10;
  }

  const pie = `Cotizacion valida hasta ${formatearFecha(cot.validUntil)}. Documento generado el ${formatearFecha(
    new Date().toISOString().slice(0, 10),
  )}.`;
  doc.font('Helvetica').fontSize(8).fillColor('#94a3b8').text(pie, MARGEN, ALTO - MARGEN - 20, {
    width: UTIL,
    align: 'center',
  });

  doc.end();
}
