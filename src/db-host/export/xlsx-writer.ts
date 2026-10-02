import type { WriteStream } from 'node:fs';
import type { CellValue, LogicalType, ResultColumn } from '@shared/query';
import type { ZipEntry } from './zip-writer';
import { ZipWriter } from './zip-writer';

/**
 * Libro XLSX mínimo escrito en flujo (specs/06: tipos reales). Números como
 * número (salvo decimales de más de 15 dígitos, que Excel redondearía),
 * fechas como fecha, booleanos como booleano y el resto como texto en línea.
 */

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Resultado" sheetId="1" r:id="rId1"/></sheets></workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

/** Estilos: 0 normal, 1 fecha, 2 fecha y hora, 3 hora, 4 cabecera en negrita. */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm:ss"/><numFmt numFmtId="166" formatCode="hh:mm:ss"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`;

/** Texto apto para XML: escapa y quita caracteres de control no permitidos. */
function xmlText(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex -- justamente se quitan los caracteres de control
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  );
}

function stringCell(text: string, style = 0): string {
  return `<c t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${xmlText(text)}</t></is></c>`;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?)?$/;
const TIME = /^(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?$/;
const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/** Número de serie de Excel (días desde 1899-12-30) de una fecha sin zona. */
function serial(y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0): number {
  return Date.UTC(y, mo - 1, d, h, mi, s, ms) / 86_400_000 + 25_569;
}

export function xlsxCell(value: CellValue, type: LogicalType): string {
  if (value === null) return '<c/>';
  if (typeof value === 'boolean') return `<c t="b"><v>${value ? 1 : 0}</v></c>`;
  if (typeof value === 'number') return `<c><v>${value}</v></c>`;
  const text = value;
  if ((type === 'integer' || type === 'decimal' || type === 'float') && NUMBER.test(text)) {
    // Más de 15 dígitos significativos: Excel los redondearía; se dejan como texto.
    if (text.replace(/[^\d]/g, '').replace(/^0+/, '').length <= 15) return `<c><v>${Number(text)}</v></c>`;
  }
  if (type === 'date' || type === 'datetime') {
    const m = DATE.exec(text);
    if (m) {
      const [, y, mo, d, h, mi, s, frac] = m;
      const ms = frac ? Math.round(Number(frac) * 1000) : 0;
      const v = serial(Number(y), Number(mo), Number(d), Number(h ?? 0), Number(mi ?? 0), Number(s ?? 0), ms);
      return `<c s="${type === 'date' && !h ? 1 : 2}"><v>${v}</v></c>`;
    }
  }
  if (type === 'time') {
    const m = TIME.exec(text);
    if (m) {
      const [, h, mi, s, frac] = m;
      const seconds = Number(h) * 3600 + Number(mi) * 60 + Number(s ?? 0) + (frac ? Number(frac) : 0);
      return `<c s="3"><v>${seconds / 86_400}</v></c>`;
    }
  }
  return stringCell(text);
}

export class XlsxWriter {
  private readonly zip: ZipWriter;
  private sheet: ZipEntry | null = null;

  constructor(
    out: WriteStream,
    private readonly columns: readonly ResultColumn[],
  ) {
    this.zip = new ZipWriter(out);
  }

  async begin(): Promise<void> {
    await this.zip.add('[Content_Types].xml', CONTENT_TYPES);
    await this.zip.add('_rels/.rels', ROOT_RELS);
    await this.zip.add('xl/workbook.xml', WORKBOOK);
    await this.zip.add('xl/_rels/workbook.xml.rels', WORKBOOK_RELS);
    await this.zip.add('xl/styles.xml', STYLES);
    this.sheet = await this.zip.open('xl/worksheets/sheet1.xml');
    const header = `<row>${this.columns.map((c) => stringCell(c.name, 4)).join('')}</row>`;
    await this.sheet.write(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${header}`,
    );
  }

  async rows(rows: readonly CellValue[][]): Promise<void> {
    const types = this.columns.map((c) => c.logicalType);
    await this.sheet!.write(
      rows.map((r) => `<row>${r.map((v, i) => xlsxCell(v, types[i] ?? 'other')).join('')}</row>`).join(''),
    );
  }

  async end(): Promise<void> {
    await this.sheet!.write('</sheetData></worksheet>');
    await this.sheet!.close();
    await this.zip.finish();
  }
}
