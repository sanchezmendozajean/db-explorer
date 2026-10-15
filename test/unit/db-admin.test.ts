import { describe, expect, it } from 'vitest';
import { newConnectionDefaults } from '@shared/connection';
import {
  backupModeOf,
  majorVersion,
  parseToolVersion,
  suggestedBackupName,
  toolFamilyOf,
  toolFileNames,
} from '@shared/db-admin';
import { checkedServerPath, nstr, planFileMoves } from '../../src/db-host/drivers/sqlserver/database-sql';
import { checkedDatabaseName } from '../../src/db-host/drivers/common';
import { buildDefaultsFile, buildInvocation } from '../../src/main/services/db-backup';
import { importedDlls, isElf, isPortableExecutable } from '../../src/main/services/pe-imports';

describe('herramientas auxiliares: nombres, familias y versiones', () => {
  it('pide los binarios de cada familia con la extensión de la plataforma', () => {
    expect(toolFileNames('postgres', 'win32')).toEqual(['pg_dump.exe', 'pg_restore.exe']);
    expect(toolFileNames('mariadb', 'win32')).toEqual(['mariadb-dump.exe', 'mariadb.exe']);
    expect(toolFileNames('mysql', 'linux')).toEqual(['mysqldump', 'mysql']);
  });

  it('separa MariaDB de MySQL por el producto del servidor', () => {
    expect(toolFamilyOf('postgres', 'PostgreSQL 18.0')).toBe('postgres');
    expect(toolFamilyOf('mariadb', 'MariaDB 11.4.2')).toBe('mariadb');
    expect(toolFamilyOf('mariadb', 'MySQL 8.4.0')).toBe('mysql');
    expect(toolFamilyOf('sqlserver', 'SQL Server 2019')).toBeNull();
    expect(toolFamilyOf('sqlite', undefined)).toBeNull();
  });

  it('SQL Server respalda en el servidor y SQLite no respalda', () => {
    expect(backupModeOf('sqlserver')).toBe('server');
    expect(backupModeOf('postgres')).toBe('tools');
    expect(backupModeOf('mariadb')).toBe('tools');
    expect(backupModeOf('sqlite')).toBe('none');
  });

  it('lee la versión de la salida de --version y reconoce a cada familia', () => {
    expect(parseToolVersion('postgres', 'pg_dump (PostgreSQL) 18.0\n')?.version).toBe('18.0');
    expect(
      parseToolVersion('postgres', 'pg_restore (PostgreSQL) 14.11 (Ubuntu 14.11-0ubuntu0.22.04.1)')?.version,
    ).toBe('14.11');
    expect(
      parseToolVersion('mariadb', 'mariadb-dump from 11.4.2-MariaDB, client 10.19 for Win64 (AMD64)')
        ?.version,
    ).toBe('11.4.2');
    expect(
      parseToolVersion('mariadb', 'mysqldump  Ver 10.19 Distrib 10.6.5-MariaDB, for Win64 (AMD64)')?.version,
    ).toBe('10.6.5');
    expect(
      parseToolVersion('mysql', 'mysqldump  Ver 8.4.0 for Win64 on x86_64 (MySQL Community Server - GPL)')
        ?.version,
    ).toBe('8.4.0');
  });

  it('no confunde herramientas de otra familia', () => {
    const mysql = 'mysql  Ver 8.4.0 for Win64 on x86_64 (MySQL Community Server - GPL)';
    const maria = 'mariadb from 11.4.2-MariaDB, client 15.2 for Win64 (AMD64)';
    expect(parseToolVersion('mariadb', mysql)).toBeNull();
    expect(parseToolVersion('mysql', maria)).toBeNull();
    expect(parseToolVersion('postgres', maria)).toBeNull();
    expect(parseToolVersion('postgres', '')).toBeNull();
  });

  it('extrae la versión mayor', () => {
    expect(majorVersion('18.0')).toBe(18);
    expect(majorVersion('11.4.2')).toBe(11);
  });

  it('sugiere un nombre de archivo con la extensión del motor', () => {
    const at = new Date(2026, 9, 14, 8, 5);
    expect(suggestedBackupName('postgres', 'ventas', at)).toBe('ventas-20261014-0805.backup');
    expect(suggestedBackupName('sqlserver', 'ventas', at)).toBe('ventas-20261014-0805.bak');
    expect(suggestedBackupName('mariadb', 'ventas', at)).toBe('ventas-20261014-0805.sql');
  });
});

describe('formato de ejecutables', () => {
  it('reconoce las cabeceras PE y ELF', () => {
    expect(isPortableExecutable(Buffer.alloc(16))).toBe(false);
    expect(isElf(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 1]))).toBe(true);
    expect(isElf(Buffer.from('MZ'))).toBe(false);
  });

  it('lee la tabla de importación de un PE mínimo', () => {
    // PE32+ con una sola sección que importa "libpq.dll" y "KERNEL32.dll".
    const buf = Buffer.alloc(0x400);
    buf.write('MZ', 0, 'latin1');
    buf.writeUInt32LE(0x80, 0x3c);
    buf.writeUInt32LE(0x4550, 0x80); // "PE\0\0"
    buf.writeUInt16LE(1, 0x80 + 6); // secciones
    buf.writeUInt16LE(240, 0x80 + 20); // tamaño de la cabecera opcional
    const optional = 0x80 + 24;
    buf.writeUInt16LE(0x20b, optional);
    buf.writeUInt32LE(0x1000, optional + 112 + 8); // RVA de la importación
    const section = optional + 240;
    buf.writeUInt32LE(0x200, section + 8); // VirtualSize
    buf.writeUInt32LE(0x1000, section + 12); // VirtualAddress
    buf.writeUInt32LE(0x200, section + 16); // SizeOfRawData
    buf.writeUInt32LE(0x200, section + 20); // PointerToRawData
    // Descriptores (20 bytes) en 0x200; nombres en 0x260 y 0x270.
    buf.writeUInt32LE(0x1060, 0x200 + 12);
    buf.writeUInt32LE(0x1070, 0x214 + 12);
    buf.write('libpq.dll\0', 0x260, 'latin1');
    buf.write('KERNEL32.dll\0', 0x270, 'latin1');
    expect(importedDlls(buf)).toEqual(['libpq.dll', 'KERNEL32.dll']);
  });

  it('un archivo que no es PE no importa nada', () => {
    expect(importedDlls(Buffer.from('hola'))).toEqual([]);
  });
});

describe('invocación de las herramientas', () => {
  const pg = {
    ...newConnectionDefaults('postgres', 'p'),
    host: 'db.local',
    port: 5433,
    user: 'ana',
    ssl: { mode: 'verify-full' as const, caFile: 'C:\\ca.pem' },
  };
  const my = { ...newConnectionDefaults('mariadb', 'm'), host: 'db.local', port: 3307, user: 'ana' };
  const base = { PATH: 'x' };

  it('pg_dump: formato personalizado y la contraseña solo en el entorno', () => {
    const inv = buildInvocation(
      {
        family: 'postgres',
        kind: 'backup',
        config: pg,
        secret: 'Sup3r"Secreta',
        database: 'ventas',
        file: 'C:\\r.backup',
      },
      'unused',
      base,
    );
    expect(inv.args).toEqual([
      '--no-password',
      '-h',
      'db.local',
      '-p',
      '5433',
      '-U',
      'ana',
      '-d',
      'ventas',
      '--format=custom',
      '--file',
      'C:\\r.backup',
    ]);
    expect(inv.env['PGPASSWORD']).toBe('Sup3r"Secreta');
    expect(inv.env['PGSSLMODE']).toBe('verify-full');
    expect(inv.env['PGSSLROOTCERT']).toBe('C:\\ca.pem');
    expect(inv.args.join(' ')).not.toContain('Secreta');
  });

  it('pg_restore: atómico, sin dueños ni permisos del origen', () => {
    const inv = buildInvocation(
      {
        family: 'postgres',
        kind: 'restore',
        config: pg,
        secret: undefined,
        database: 'ventas',
        file: 'r.backup',
      },
      'unused',
      base,
    );
    expect(inv.args).toEqual(
      expect.arrayContaining([
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-privileges',
        '--single-transaction',
      ]),
    );
    expect(inv.args[inv.args.length - 1]).toBe('r.backup');
  });

  it('pg_restore: --no-owner y --no-privileges se pueden quitar por separado', () => {
    const job = {
      family: 'postgres' as const,
      kind: 'restore' as const,
      config: pg,
      secret: undefined,
      database: 'otra',
      file: 'r.backup',
    };
    const sin = buildInvocation({ ...job, options: { noOwner: false, noPrivileges: false } }, 'unused', base);
    expect(sin.args).not.toContain('--no-owner');
    expect(sin.args).not.toContain('--no-privileges');
    expect(sin.args).toContain('--single-transaction');
    expect(sin.args).toContain('otra');
    const soloDueno = buildInvocation(
      { ...job, options: { noOwner: true, noPrivileges: false } },
      'unused',
      base,
    );
    expect(soloDueno.args).toContain('--no-owner');
    expect(soloDueno.args).not.toContain('--no-privileges');
  });

  it('mysqldump: contraseña en archivo de opciones; solo MySQL lleva --no-tablespaces', () => {
    const job = { kind: 'backup' as const, config: my, secret: 's', database: 'ventas', file: 'v.sql' };
    const mysql = buildInvocation({ ...job, family: 'mysql' }, 'C:\\t\\c.cnf', base);
    const maria = buildInvocation({ ...job, family: 'mariadb' }, 'C:\\t\\c.cnf', base);
    expect(mysql.args[0]).toBe('--defaults-extra-file=C:\\t\\c.cnf');
    expect(mysql.args).toContain('--no-tablespaces');
    expect(mysql.args).toContain('--set-gtid-purged=OFF');
    expect(maria.args).not.toContain('--no-tablespaces');
    expect(maria.args).not.toContain('--set-gtid-purged=OFF');
    expect(mysql.args).toContain('--result-file=v.sql');
    expect(mysql.args[mysql.args.length - 1]).toBe('ventas');
    expect([...mysql.args, ...maria.args].join(' ')).not.toMatch(/ -ps|--password/);
    expect(mysql.usesDefaultsFile).toBe(true);
  });

  it('mysql (restaurar) lee el respaldo por la entrada estándar', () => {
    const inv = buildInvocation(
      {
        family: 'mariadb',
        kind: 'restore',
        config: my,
        secret: undefined,
        database: 'ventas',
        file: 'v.sql',
      },
      'c.cnf',
      base,
    );
    expect(inv.stdinFile).toBe('v.sql');
    expect(inv.args[inv.args.length - 1]).toBe('ventas');
  });

  it('el archivo de opciones escapa la contraseña y traduce el modo de TLS por familia', () => {
    const secret = 'a"b\\c\nd';
    expect(buildDefaultsFile('mysql', my, secret)).toContain('password="a\\"b\\\\c\\nd"');
    expect(buildDefaultsFile('mysql', my, secret)).toContain('ssl-mode=DISABLED');
    expect(buildDefaultsFile('mariadb', my, secret)).toContain('skip-ssl');
    const tls = { ...my, ssl: { mode: 'verify-ca' as const, caFile: 'C:\\ca.pem' } };
    expect(buildDefaultsFile('mysql', tls, undefined)).toContain('ssl-mode=VERIFY_CA');
    expect(buildDefaultsFile('mariadb', tls, undefined)).toContain(
      'ssl-verify-server-cert\nssl-ca="C:\\\\ca.pem"',
    );
    expect(buildDefaultsFile('mariadb', tls, undefined)).not.toContain('password');
  });
});

describe('SQL Server: restauración y validaciones', () => {
  it('escapa los literales y valida rutas y nombres', () => {
    expect(nstr("o'brien")).toBe("N'o''brien'");
    expect(() => checkedServerPath('  ')).toThrow();
    expect(() => checkedServerPath('C:\\a\u0000.bak')).toThrow();
    expect(checkedServerPath(' C:\\Respaldos\\a.bak ')).toBe('C:\\Respaldos\\a.bak');
    expect(() => checkedDatabaseName('')).toThrow();
    expect(() => checkedDatabaseName('a\nb')).toThrow();
    expect(checkedDatabaseName(' ventas ')).toBe('ventas');
  });

  it('planifica los MOVE junto a los archivos actuales, con extensiones por tipo', () => {
    const moves = planFileMoves(
      'ventas',
      [
        { logical: 'ventas', type: 'D' },
        { logical: 'ventas_2', type: 'D' },
        { logical: 'ventas_log', type: 'L' },
      ],
      { data: 'D:\\Datos', log: 'E:\\Logs' },
    );
    expect(moves).toEqual([
      { logical: 'ventas', target: 'D:\\Datos\\ventas_ventas.mdf' },
      { logical: 'ventas_2', target: 'D:\\Datos\\ventas_ventas_2.ndf' },
      { logical: 'ventas_log', target: 'E:\\Logs\\ventas_ventas_log.ldf' },
    ]);
  });

  it('usa "/" con rutas de Linux y falla si no conoce la carpeta', () => {
    const move = planFileMoves('v', [{ logical: 'a', type: 'D' }], {
      data: '/var/opt/mssql/data',
      log: undefined,
    });
    expect(move[0]!.target).toBe('/var/opt/mssql/data/v_a.mdf');
    expect(() => planFileMoves('v', [{ logical: 'l', type: 'L' }], { data: '/d', log: undefined })).toThrow();
  });
});
