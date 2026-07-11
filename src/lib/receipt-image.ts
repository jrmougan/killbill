/**
 * Shared receipt-image validation for the paid Gemini Vision endpoints (OCR and
 * list reconciliation). Validates the ACTUAL bytes (magic numbers) rather than the
 * client-supplied MIME type before spending a Gemini call.
 */

/** Content types accepted by the Gemini vision endpoints. */
export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** Max upload size forwarded to Gemini (8 MB). */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Validate the first bytes of a buffer as JPEG/PNG/GIF/WEBP. */
export function isAllowedImage(buffer: Buffer): boolean {
    if (buffer.length < 12) return false;
    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
    // PNG: 89 50 4E 47
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return true;
    // GIF: 47 49 46 38 ("GIF8")
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return true;
    // WEBP: "RIFF" .... "WEBP"
    if (
        buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
    ) return true;
    return false;
}
