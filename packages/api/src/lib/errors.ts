/** Typed application error. The error plugin renders these as
 *  { error: { code, message, details? } } with the given status code. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthorized = (message = "Authentication required") =>
  new AppError(401, "UNAUTHORIZED", message);

export const forbidden = (message = "Not allowed") =>
  new AppError(403, "FORBIDDEN", message);

export const notFound = (message = "Not found") =>
  new AppError(404, "NOT_FOUND", message);

export const conflict = (code: string, message: string) =>
  new AppError(409, code, message);

export const badRequest = (message = "Bad request") =>
  new AppError(400, "BAD_REQUEST", message);
