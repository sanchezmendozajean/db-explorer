import { createWriteStream } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import type { RowEncoder } from '@shared/export';
import { csvEncoder, insertEncoder, jsonEncoder } from '@shared/export';
import type { CellValue, ExportFormat, ExportOptions, ResultColumn } from '@shared/query';
import { XlsxWriter } from './xlsx-writer';

/**
 * Escritura de una exportación a archivo en flujo (specs/06): las filas
 * llegan por lotes y se escriben respetando la contrapresión del disco.
 */
export class FileExporter {
  private readonly out: WriteStream;
  private readonly encoder: RowEncoder | null;
  private readonly xlsx: XlsxWriter | null;
  private first = true;
  private failed: Error | null = null;
  rows = 0;

  constructor(
    private readonly path: string,
    format: ExportFormat,
    options: ExportOptions,
    columns: readonly ResultColumn[],
  ) {
    this.out = createWriteStream(path);
    this.out.on('error', (err) => {
      this.failed = err;
    });
    this.xlsx = format === 'xlsx' ? new XlsxWriter(this.out, columns) : null;
    this.encoder =
      format === 'csv'
        ? csvEncoder(columns, { separator: options.separator, header: options.header })
        : format === 'json'
          ? jsonEncoder(columns, { pretty: true })
          : format === 'sql'
            ? insertEncoder(columns, { engine: options.engine ?? 'postgres', table: options.table })
            : null;
    if (this.encoder && options.bom && format !== 'json') this.out.write('﻿');
  }

  private async text(text: string): Promise<void> {
    if (this.failed) throw this.failed;
    if (text && !this.out.write(text)) await new Promise<void>((resolve) => this.out.once('drain', resolve));
  }

  async begin(): Promise<void> {
    if (this.xlsx) await this.xlsx.begin();
    else await this.text(this.encoder!.begin());
  }

  async write(rows: readonly CellValue[][]): Promise<void> {
    if (rows.length === 0) return;
    if (this.xlsx) await this.xlsx.rows(rows);
    else await this.text(this.encoder!.rows(rows, this.first));
    this.first = false;
    this.rows += rows.length;
  }

  async end(): Promise<void> {
    if (this.xlsx) await this.xlsx.end();
    else await this.text(this.encoder!.end());
    await new Promise<void>((resolve, reject) => {
      this.out.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
    if (this.failed) throw this.failed;
  }

  /** Cancelada o con error: cierra y borra el archivo a medias. */
  async abort(): Promise<void> {
    await new Promise<void>((resolve) => this.out.end(() => resolve()));
    await rm(this.path, { force: true }).catch(() => undefined);
  }
}
