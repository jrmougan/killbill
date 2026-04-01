import { NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { getSession } from '@/lib/auth';

export async function POST(request: Request) {
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
        }

        const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
        if (!ALLOWED_MIME_TYPES.includes(file.type)) {
            return NextResponse.json({ error: 'Invalid file type. Only JPEG, PNG, WEBP and HEIC images are allowed.' }, { status: 400 });
        }

        const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
        if (file.size > MAX_SIZE_BYTES) {
            return NextResponse.json({ error: 'File too large. Maximum size is 10 MB.' }, { status: 400 });
        }

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        // Use only the extension from the MIME type to avoid path traversal via file.name
        const ext = file.type.split('/')[1].replace('jpeg', 'jpg');
        const filename = `${Date.now()}-${userId}.${ext}`;
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
