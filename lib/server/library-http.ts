import "server-only";
import { LibraryError } from "./library-validation.ts";
export function libraryResponse(
  value: unknown,
  status = 200,
  headers: HeadersInit = {}
) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store", ...headers },
  });
}
export function libraryFailure(error: unknown) {
  return libraryResponse(
    {
      error:
        error instanceof LibraryError
          ? error.message
          : "Your library is unavailable. Check the database setup or try again shortly.",
    },
    error instanceof LibraryError ? error.status : 503
  );
}
