import { z } from 'zod';

/** Entrada de `keybindings.json` (formato de VS Code, specs/05 §Personalización). */
export const UserKeybindingSchema = z.object({
  key: z.string().min(1).max(100),
  /** Id del comando; con `-` delante quita ese atajo. */
  command: z.string().min(1).max(200),
  when: z.string().max(500).optional(),
});
export type UserKeybinding = z.infer<typeof UserKeybindingSchema>;

export interface UserKeybindings {
  rules: UserKeybinding[];
  /** Entradas que no se pudieron leer (se omiten). */
  invalid: number;
}
