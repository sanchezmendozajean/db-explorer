/**
 * Registro central de comandos `db.*`. Menús, paleta, atajos y botones
 * ejecutan siempre a través de aquí.
 */

export interface Command {
  id: string;
  /** Categoría para la paleta ("Ver: Mostrar/ocultar barra lateral"). */
  category?: string;
  /** Título; si falta se toma de i18n. */
  title?: string;
  run: () => void | Promise<void>;
  /** Si devuelve false, el comando está deshabilitado. */
  enabled?: () => boolean;
  /** Estado de marca en menús (p. ej. tema activo). */
  checked?: () => boolean;
  /** No aparece en la paleta. */
  hidden?: boolean;
}

type Listener = () => void;

export class CommandRegistry {
  private readonly commands = new Map<string, Command>();
  private readonly listeners = new Set<Listener>();

  register(command: Command): () => void {
    this.commands.set(command.id, command);
    this.emit();
    return () => {
      if (this.commands.get(command.id) === command) {
        this.commands.delete(command.id);
        this.emit();
      }
    };
  }

  registerMany(commands: readonly Command[]): () => void {
    const disposers = commands.map((c) => this.register(c));
    return () => disposers.forEach((d) => d());
  }

  get(id: string): Command | undefined {
    return this.commands.get(id);
  }

  has(id: string): boolean {
    return this.commands.has(id);
  }

  isEnabled(id: string): boolean {
    const command = this.commands.get(id);
    return command !== undefined && (command.enabled?.() ?? true);
  }

  all(): Command[] {
    return [...this.commands.values()];
  }

  /** Ejecuta un comando. Devuelve false si no existe o está deshabilitado. */
  async execute(id: string): Promise<boolean> {
    const command = this.commands.get(id);
    if (!command || !(command.enabled?.() ?? true)) return false;
    await command.run();
    return true;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
