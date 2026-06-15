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
