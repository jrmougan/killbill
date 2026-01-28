import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST() {
    const cookieStore = await cookies();
    cookieStore.delete('session_token');
    cookieStore.delete('user_id'); // cleanup old cookie too
    return NextResponse.json({ success: true });
}
