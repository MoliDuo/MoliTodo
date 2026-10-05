// Pictures attached to lines. The browser shrinks a picture before sending it; the server keeps the file and the
// task keeps only its id (see server/src/routes/files.ts), so syncing never carries pictures.

import { CLIENT_HEADER, FILE_TYPES, fileResponseSchema, MAX_FILE_BYTES } from "@shared/records";

/** Longest side of a picture after shrinking: sharp on a phone, a few hundred KB as a JPEG. */
export const IMAGE_MAX_SIDE = 1600;
const QUALITY = 0.82;

export const fileUrl = (id: string): string => `/api/v2/files/${id}`;

/** The size that fits `width` x `height` inside `max` on its longest side, never enlarged. */
export function fitWithin(width: number, height: number, max = IMAGE_MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** A picture shrunk to `IMAGE_MAX_SIDE` and saved as a JPEG. */
export async function compressImage(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no canvas");
  context.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("no blob"))),
      "image/jpeg",
      QUALITY
    )
  );
}

export class UploadError extends Error {
  constructor(readonly reason: "offline" | "unsupported" | "failed") {
    super(reason);
    this.name = "UploadError";
  }
}

export interface FileApi {
  /** Shrinks and sends a picture; resolves to its id. */
  upload(file: Blob): Promise<string>;
  /** Forgets a picture on the server; failures are ignored (the line no longer points to it anyway). */
  remove(id: string): Promise<void>;
}

const isAllowed = (type: string) => (FILE_TYPES as readonly string[]).includes(type);

export function createFileApi(
  client: string,
  fetchFn: typeof fetch,
  compress: (file: Blob) => Promise<Blob> = compressImage
): FileApi {
  return {
    async upload(file) {
      let body: Blob;
      try {
        body = await compress(file);
      } catch {
        // A browser that cannot shrink it: send it as it is when the server would take it.
        if (!isAllowed(file.type) || file.size > MAX_FILE_BYTES)
          throw new UploadError("unsupported");
        body = file;
      }
      let response: Response;
      try {
        response = await fetchFn("/api/v2/files", {
          method: "POST",
          headers: { [CLIENT_HEADER]: client, "content-type": body.type || "image/jpeg" },
          credentials: "same-origin",
          body,
        });
      } catch {
        throw new UploadError("offline");
      }
      if (!response.ok) throw new UploadError(response.status === 413 ? "unsupported" : "failed");
      const parsed = fileResponseSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) throw new UploadError("failed");
      return parsed.data.id;
    },
    async remove(id) {
      try {
        await fetchFn(fileUrl(id), {
          method: "DELETE",
          headers: { [CLIENT_HEADER]: client },
          credentials: "same-origin",
        });
      } catch {
        // Left on the server; nothing shows it.
      }
    },
  };
}
