export type ErrorDetail = {
  name: string
  message: string
  code?: string | number
  stack?: string
  cause?: ErrorDetail | string
}

/** Flatten anything thrown into a JSON-safe object, including `cause` chains. */
export function describeError(err: unknown, depth = 0): ErrorDetail {
  if (err instanceof Error) {
    const detail: ErrorDetail = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    }
    const code = (err as NodeJS.ErrnoException).code
    if (code !== undefined)
      detail.code = code
    if (err.cause !== undefined) {
      detail.cause = depth < 3
        ? describeError(err.cause, depth + 1)
        : String(err.cause)
    }
    return detail
  }
  return {
    name: typeof err,
    message: String(err),
  }
}
