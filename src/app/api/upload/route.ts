import { NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { getSession } from '@/lib/auth';

// Whitelist of accepted content types mapped to their canonical extension.
// The extension is derived solely from this map so the stored filename can
// never be influenced by attacker-controlled input.
const ALLOWED_TYPES: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
};

const MAX_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB

// Validate the actual file bytes (magic numbers) rather than trusting the
// client-supplied MIME type / extension. Accepts JPEG, PNG, WEBP and GIF.
function isAllowedImage(buffer: Buffer): boolean {
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

export async function POST(request: Request) {
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
        }

        const ext = ALLOWED_TYPES[file.type];
        if (!ext) {
            return NextResponse.json({ error: 'Invalid file type. Only PNG, JPEG and WEBP images are allowed.' }, { status: 400 });
        }

        if (file.size > MAX_SIZE_BYTES) {
            return NextResponse.json({ error: 'File too large. Maximum size is 8 MB.' }, { status: 413 });
        }

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        // Validate the actual bytes, not just the client-supplied MIME/extension.
        if (!isAllowedImage(buffer)) {
            return NextResponse.json({ error: 'Invalid image file' }, { status: 400 });
        }

        // Unpredictable filename with a whitelisted extension. It does NOT embed
        // the user id, so the public URL leaks no information about the uploader.
        const filename = `${randomUUID()}.${ext}`;
        const path = join(process.cwd(), 'public/uploads', filename);

        await writeFile(path, buffer);
        console.log(`File uploaded to ${path}`);

        return NextResponse.json({
            success: true,
            url: `/uploads/${filename}`
        });
    } catch (error) {
        console.error('Error uploading file:', error);
        return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }
}
