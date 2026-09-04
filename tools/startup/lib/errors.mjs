export class StartupError extends Error {
  constructor(message, code = "STARTUP_ERROR", details = undefined) {
    super(message);
    this.name = "StartupError";
    this.code = code;
    this.details = details;
  }
}

export function formatError(error) {
  if (error instanceof StartupError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}
