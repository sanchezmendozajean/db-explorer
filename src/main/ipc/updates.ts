import type { UpdateService } from '../services/update-service';
import { AppError, handle } from './handle';

export function registerUpdateHandlers(updates: UpdateService): void {
  handle('updates:get-status', () => updates.status);
  handle('updates:check', () => updates.check());
  handle('updates:install', () => {
    if (updates.status.state !== 'ready')
      throw new AppError('not-found', 'No hay una actualización descargada');
    updates.install();
    return {};
  });
}
