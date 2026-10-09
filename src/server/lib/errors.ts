/** Errors that are safe to expose to API clients (no internals). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (message: string, details?: unknown) => new ApiError(400, "bad_request", message, details);
export const unauthorized = (message = "Authentication required") => new ApiError(401, "unauthorized", message);
export const forbidden = (message = "You do not have permission to perform this action") =>
  new ApiError(403, "forbidden", message);
export const notFound = (message = "Not found") => new ApiError(404, "not_found", message);
export const conflict = (message: string) => new ApiError(409, "conflict", message);
export const tooManyRequests = (message = "Too many requests, please try again later") =>
  new ApiError(429, "rate_limited", message);

/** Errors raised by external providers. `retryable` drives backoff behaviour. */
export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly options: {
      retryable: boolean;
      status?: number;
      rateLimitResetAt?: Date | null;
      kind?: "auth" | "rate_limit" | "network" | "server" | "client" | "parse" | "timeout" | "not_configured";
    },
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
