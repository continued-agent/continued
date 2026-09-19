import type { RemoteErrorCode } from "./types.js";

export class RemoteError extends Error {
  constructor(
    public readonly code: RemoteErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "RemoteError";
  }
}

export function remoteError(
  code: RemoteErrorCode,
  message: string,
  status: number,
): RemoteError {
  return new RemoteError(code, message, status);
}

export function statusForRemoteError(code: RemoteErrorCode): number {
  switch (code) {
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "SESSION_NOT_FOUND":
    case "WORKSPACE_NOT_FOUND":
    case "FILE_NOT_FOUND":
    case "PERMISSION_NOT_FOUND":
    case "NOT_FOUND":
      return 404;
    case "SESSION_BUSY":
    case "PERMISSION_ALREADY_RESOLVED":
      return 409;
    case "PRECONDITION_FAILED":
      return 412;
    case "PAYLOAD_TOO_LARGE":
      return 413;
    case "RATE_LIMITED":
      return 429;
    case "INTERNAL_ERROR":
      return 500;
    case "PATH_OUTSIDE_WORKSPACE":
      return 403;
    case "UNSUPPORTED_PROTOCOL_VERSION":
    case "INVALID_REQUEST":
      return 400;
  }
}
