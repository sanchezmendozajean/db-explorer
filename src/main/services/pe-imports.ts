import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Cabecera mínima de un ejecutable de Windows (PE): MZ → `e_lfanew` → "PE\0\0". */
export function isPortableExecutable(buf: Buffer): boolean {
  if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) return false;
  const pe = buf.readUInt32LE(0x3c);
  return pe + 4 <= buf.length && buf.readUInt32LE(pe) === 0x00004550;
}

/** Cabecera de un ejecutable de Linux (ELF). */
export function isElf(buf: Buffer): boolean {
  return buf.length >= 4 && buf.readUInt32BE(0) === 0x7f454c46;
}

/**
 * Nombres de las DLL que importa un ejecutable o biblioteca de Windows (tabla de importación del PE).
 * Devuelve `[]` si el archivo no es un PE válido o no importa nada. No incluye las cargas diferidas.
 */
export function importedDlls(buf: Buffer): string[] {
  if (!isPortableExecutable(buf)) return [];
  try {
    const pe = buf.readUInt32LE(0x3c);
    const sectionCount = buf.readUInt16LE(pe + 6);
    const optionalSize = buf.readUInt16LE(pe + 20);
    const optional = pe + 24;
    const magic = buf.readUInt16LE(optional);
    // Directorios de datos: tras 96 bytes (PE32) o 112 (PE32+) de campos fijos; el 2.º es el de importación.
    const dirs = optional + (magic === 0x20b ? 112 : 96);
    const importRva = buf.readUInt32LE(dirs + 8);
    if (importRva === 0) return [];

    const sections = optional + optionalSize;
    const toOffset = (rva: number): number => {
      for (let i = 0; i < sectionCount; i++) {
        const s = sections + i * 40;
        const virtualAddress = buf.readUInt32LE(s + 12);
        const span = Math.max(buf.readUInt32LE(s + 8), buf.readUInt32LE(s + 16));
        if (rva >= virtualAddress && rva < virtualAddress + span)
          return rva - virtualAddress + buf.readUInt32LE(s + 20);
      }
      return -1;
    };

    const names: string[] = [];
    for (let at = toOffset(importRva); at >= 0 && at + 20 <= buf.length && names.length < 500; at += 20) {
      const nameRva = buf.readUInt32LE(at + 12);
      if (nameRva === 0) break;
      const start = toOffset(nameRva);
      if (start < 0) break;
      const end = buf.indexOf(0, start);
      names.push(buf.toString('latin1', start, end < 0 ? buf.length : end));
    }
    return names;
  } catch {
    return [];
  }
}

/**
 * Dependencias de un ejecutable de Windows: las DLL que importa (y las de estas, recursivamente) que
 * están en su misma carpeta (`found`, rutas completas) y las que no están en ella ni son del sistema
 * (`missing`, nombres). `isSystem` decide qué DLL provee Windows (kernel32, api-ms-win-*…).
 */
export async function resolveDependencies(
  exePath: string,
  isSystem: (dll: string) => boolean,
  limit = 200,
): Promise<{ found: string[]; missing: string[] }> {
  const dir = dirname(exePath);
  const byLowerName = new Map<string, string>();
  for (const name of await readdir(dir)) byLowerName.set(name.toLowerCase(), name);

  const found: string[] = [];
  const missing = new Set<string>();
  const seen = new Set<string>();
  const queue = [exePath];
  while (queue.length > 0 && found.length < limit) {
    const current = queue.shift()!;
    for (const dll of importedDlls(await readFile(current))) {
      const lower = dll.toLowerCase();
      const real = byLowerName.get(lower);
      if (!real) {
        if (!isSystem(dll)) missing.add(dll);
        continue;
      }
      if (seen.has(lower)) continue;
      seen.add(lower);
      const full = join(dir, real);
      found.push(full);
      queue.push(full);
    }
  }
  return { found, missing: [...missing] };
}
