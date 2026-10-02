import type { WriteStream } from 'node:fs';
import { crc32, createDeflateRaw } from 'node:zlib';

/**
 * Escritor de ZIP en flujo (para XLSX): cada entrada se comprime con
 * `deflate` mientras se escribe, con descriptor de datos al final (bit 3),
 * así nunca se junta el contenido en memoria. Sin ZIP64 (entradas < 4 GB).
 */

interface EntryRecord {
  name: Buffer;
  offset: number;
  crc: number;
  compressed: number;
  size: number;
}

export interface ZipEntry {
  write(text: string): Promise<void>;
  close(): Promise<void>;
}

/** Fecha y hora en formato DOS. */
function dosDateTime(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const FLAGS = 0x0808; // bit 3: descriptor de datos; bit 11: nombres en UTF-8
const DEFLATE = 8;

export class ZipWriter {
  private offset = 0;
  private readonly entries: EntryRecord[] = [];
  private readonly stamp = dosDateTime(new Date());

  constructor(private readonly out: WriteStream) {}

  private async raw(chunk: Buffer): Promise<void> {
    this.offset += chunk.length;
    if (!this.out.write(chunk)) await new Promise<void>((resolve) => this.out.once('drain', resolve));
  }

  async open(name: string): Promise<ZipEntry> {
    const record: EntryRecord = {
      name: Buffer.from(name, 'utf8'),
      offset: this.offset,
      crc: 0,
      compressed: 0,
      size: 0,
    };
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(FLAGS, 6);
    header.writeUInt16LE(DEFLATE, 8);
    header.writeUInt16LE(this.stamp.time, 10);
    header.writeUInt16LE(this.stamp.date, 12);
    header.writeUInt16LE(record.name.length, 26);
    await this.raw(Buffer.concat([header, record.name]));

    const deflate = createDeflateRaw({ level: 6 });
    deflate.on('data', (chunk: Buffer) => {
      record.compressed += chunk.length;
      this.offset += chunk.length;
      if (!this.out.write(chunk)) {
        deflate.pause();
        this.out.once('drain', () => deflate.resume());
      }
    });
    const ended = new Promise<void>((resolve, reject) => {
      deflate.once('end', resolve);
      deflate.once('error', reject);
    });
    return {
      write: async (text) => {
        const data = Buffer.from(text, 'utf8');
        record.crc = crc32(data, record.crc);
        record.size += data.length;
        if (!deflate.write(data)) await new Promise<void>((resolve) => deflate.once('drain', resolve));
      },
      close: async () => {
        deflate.end();
        await ended;
        const descriptor = Buffer.alloc(16);
        descriptor.writeUInt32LE(0x08074b50, 0);
        descriptor.writeUInt32LE(record.crc >>> 0, 4);
        descriptor.writeUInt32LE(record.compressed, 8);
        descriptor.writeUInt32LE(record.size, 12);
        await this.raw(descriptor);
        this.entries.push(record);
      },
    };
  }

  async add(name: string, text: string): Promise<void> {
    const entry = await this.open(name);
    await entry.write(text);
    await entry.close();
  }

  /** Escribe el directorio central y cierra el archivo. */
  async finish(): Promise<void> {
    const start = this.offset;
    for (const e of this.entries) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(20, 4);
      h.writeUInt16LE(20, 6);
      h.writeUInt16LE(FLAGS, 8);
      h.writeUInt16LE(DEFLATE, 10);
      h.writeUInt16LE(this.stamp.time, 12);
      h.writeUInt16LE(this.stamp.date, 14);
      h.writeUInt32LE(e.crc >>> 0, 16);
      h.writeUInt32LE(e.compressed, 20);
      h.writeUInt32LE(e.size, 24);
      h.writeUInt16LE(e.name.length, 28);
      h.writeUInt32LE(e.offset, 42);
      await this.raw(Buffer.concat([h, e.name]));
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(this.offset - start, 12);
    end.writeUInt32LE(start, 16);
    await this.raw(end);
  }
}
