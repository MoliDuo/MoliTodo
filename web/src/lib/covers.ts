// Book covers: public-domain paintings shipped with the site, or a picture she uploads.

import { MAX_COVER_LENGTH } from "@shared/records";

export const COVERS = [
  { id: "monet", name: "鲁昂大教堂", artist: "莫奈" },
  { id: "almond", name: "杏花", artist: "梵高" },
  { id: "wave", name: "神奈川冲浪里", artist: "葛饰北斋" },
  { id: "starry", name: "星月夜", artist: "梵高" },
  { id: "lilies", name: "睡莲", artist: "莫奈" },
  { id: "kiss", name: "吻", artist: "克里姆特" },
  { id: "parasol", name: "撑阳伞的女人", artist: "莫奈" },
] as const;

export const UPLOAD = "upload";

/** The picture for a cover choice; an upload that is not there (yet) falls back to the first painting. */
export function coverSrc(choice: string, uploaded: string | null): string {
  if (choice === UPLOAD && uploaded) return uploaded;
  const cover = COVERS.find((c) => c.id === choice) ?? COVERS[0];
  return `/covers/${cover.id}.webp`;
}

export const COVER_WIDTH = 600;
export const COVER_HEIGHT = 860;

/** The crop (in source pixels) that fills a w x h box from an image of the given size, centred. */
export function coverCrop(width: number, height: number, w = COVER_WIDTH, h = COVER_HEIGHT) {
  const scale = Math.max(w / width, h / height);
  const sw = w / scale;
  const sh = h / scale;
  return { sx: (width - sw) / 2, sy: (height - sh) / 2, sw, sh };
}

/** A picture cut to the cover's shape and saved as a JPEG small enough to sync, as a data URL. */
export async function compressCover(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = COVER_WIDTH;
  canvas.height = COVER_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no canvas");
  const { sx, sy, sw, sh } = coverCrop(bitmap.width, bitmap.height);
  context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, COVER_WIDTH, COVER_HEIGHT);
  for (const quality of [0.85, 0.75, 0.62, 0.5, 0.38]) {
    const url = canvas.toDataURL("image/jpeg", quality);
    if (url.length <= MAX_COVER_LENGTH) return url;
  }
  throw new Error("too big");
}
