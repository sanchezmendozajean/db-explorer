import type { Engine } from '@shared/connection';

/** Sentencias de control de transacción por motor (guardado de la edición en grilla). */
export interface TransactionSql {
  begin: string;
  commit: string;
  rollback: string;
  savepoint: string;
  rollbackToSavepoint: string;
  /** SQL Server no libera puntos de guardado. */
  releaseSavepoint: string | null;
}

const SAVEPOINT = 'dbx_guardado';

export const TRANSACTION_SQL: Record<Engine, TransactionSql> = {
  postgres: {
    begin: 'BEGIN',
    commit: 'COMMIT',
    rollback: 'ROLLBACK',
    savepoint: `SAVEPOINT ${SAVEPOINT}`,
    rollbackToSavepoint: `ROLLBACK TO SAVEPOINT ${SAVEPOINT}`,
    releaseSavepoint: `RELEASE SAVEPOINT ${SAVEPOINT}`,
  },
  mariadb: {
    begin: 'START TRANSACTION',
    commit: 'COMMIT',
    rollback: 'ROLLBACK',
    savepoint: `SAVEPOINT ${SAVEPOINT}`,
    rollbackToSavepoint: `ROLLBACK TO SAVEPOINT ${SAVEPOINT}`,
    releaseSavepoint: `RELEASE SAVEPOINT ${SAVEPOINT}`,
  },
  sqlite: {
    begin: 'BEGIN',
    commit: 'COMMIT',
    rollback: 'ROLLBACK',
    savepoint: `SAVEPOINT ${SAVEPOINT}`,
    rollbackToSavepoint: `ROLLBACK TO SAVEPOINT ${SAVEPOINT}`,
    releaseSavepoint: `RELEASE SAVEPOINT ${SAVEPOINT}`,
  },
  sqlserver: {
    begin: 'BEGIN TRANSACTION',
    commit: 'COMMIT TRANSACTION',
    rollback: 'ROLLBACK TRANSACTION',
    savepoint: `SAVE TRANSACTION ${SAVEPOINT}`,
    rollbackToSavepoint: `ROLLBACK TRANSACTION ${SAVEPOINT}`,
    releaseSavepoint: null,
  },
};
