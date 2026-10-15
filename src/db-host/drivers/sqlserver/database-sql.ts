import { DriverError } from '../types';

/** Literal `N'…'` de SQL Server con las comillas simples duplicadas. */
export function nstr(value: string): string {
  return `N'${value.replace(/'/g, "''")}'`;
}

/** Ruta de un archivo de respaldo en el servidor: no vacía y sin caracteres de control. */
export function checkedServerPath(path: string): string {
  const trimmed = path.trim();
  // eslint-disable-next-line no-control-regex -- justamente se rechazan los caracteres de control
  if (!trimmed || trimmed.length > 1000 || /[\u0000-\u001f]/.test(trimmed)) {
    throw new DriverError('La ruta del archivo de respaldo no es válida', 'invalid-path');
  }
  return trimmed;
}

export interface BackupFile {
  logical: string;
  /** `D` datos, `L` registro, `F` catálogo de texto, `S` FILESTREAM (columna `Type` de `RESTORE FILELISTONLY`). */
  type: string;
}

/**
 * Destino de cada archivo de un respaldo al restaurarlo sobre `database`: la carpeta de los archivos
 * actuales (o la predeterminada del servidor) y el nombre `<base>_<lógico>` con la extensión del tipo
 * (`.mdf` el primero de datos, `.ndf` los demás, `.ldf` el registro).
 */
export function planFileMoves(
  database: string,
  files: BackupFile[],
  dirs: { data: string | undefined; log: string | undefined },
): { logical: string; target: string }[] {
  let dataFiles = 0;
  return files.map((f) => {
    const isLog = f.type === 'L';
    const dir = isLog ? dirs.log : dirs.data;
    if (!dir) {
      throw new DriverError(
        'No se pudo determinar la carpeta de archivos de la base en el servidor para restaurar',
        'no-data-path',
      );
    }
    const sep = dir.includes('/') && !dir.includes('\\') ? '/' : '\\';
    const ext = isLog ? '.ldf' : f.type === 'D' ? (dataFiles++ === 0 ? '.mdf' : '.ndf') : '';
    const safe = `${database}_${f.logical}`.replace(/[\\/:*?"<>|]/g, '_');
    return { logical: f.logical, target: `${dir}${sep}${safe}${ext}` };
  });
}
