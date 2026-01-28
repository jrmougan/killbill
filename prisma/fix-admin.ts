import 'dotenv/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../src/generated/prisma/client';

const adapter = new PrismaMariaDb({
    host: process.env.DATABASE_HOST || 'localhost',
    user: process.env.DATABASE_USER || 'root',
    password: process.env.DATABASE_PASSWORD || 'toor',
    database: process.env.DATABASE_NAME || 'killbill',
    port: Number(process.env.DATABASE_PORT) || 3306,
    connectionLimit: 10
});

const prisma = new PrismaClient({ adapter });

async function main() {
    console.log('Fixing admin user...');

    const result = await prisma.user.updateMany({
        where: { email: 'admin@killbill.app' },
        data: { isAdmin: true }
    });

    console.log('Updated:', result);

    // Verify
    const admin = await prisma.user.findUnique({
        where: { email: 'admin@killbill.app' }
    });

    console.log('Admin user:', admin ? {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        isAdmin: admin.isAdmin
    } : 'NOT FOUND');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
