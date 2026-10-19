import { getDatabase } from "@/lib/server/database";
import {
  createLibraryAccount,
  sessionCookie,
} from "@/lib/server/library-account";
import {
  LibraryError,
  readJson,
  sameOrigin,
} from "@/lib/server/library-validation";
import { libraryFailure, libraryResponse } from "@/lib/server/library-http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const database = getDatabase();
    if (!database)
      throw new LibraryError(
        "Library accounts need a configured PostgreSQL database.",
        503
      );
    const body = await readJson(request);
    if (!body || (body.action !== "register" && body.action !== "login"))
      throw new LibraryError("Invalid account operation.");
    const token = await createLibraryAccount(database).signIn(
      body,
      body.action === "register"
    );
    return libraryResponse({ ok: true }, 200, {
      "Set-Cookie": sessionCookie(request, token),
    });
  } catch (error) {
    return libraryFailure(error);
  }
}
export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    const database = getDatabase();
    if (database) await createLibraryAccount(database).signOut(request);
    return libraryResponse({ ok: true }, 200, {
      "Set-Cookie": sessionCookie(request, "", true),
    });
  } catch (error) {
    return libraryFailure(error);
  }
}
