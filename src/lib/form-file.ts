/**
 * Multipart helpers shared by the image-upload routes (/api/upload, /api/ocr).
 */
import { HttpError, INVALID_BODY_MESSAGE } from "@/lib/http";

/**
 * The `field` file of a multipart body, or null when it is absent or a plain
 * text value. A body that is not multipart/form-data at all is a 400
 * "Petición no válida" (it used to surface as a generic 500).
 */
export async function readFormFile(req: Request, field: string): Promise<File | null> {
    let form: FormData;
    try {
        form = await req.formData();
    } catch {
        throw new HttpError(400, INVALID_BODY_MESSAGE);
    }
    const value = form.get(field);
    return value === null || typeof value === "string" ? null : value;
}
