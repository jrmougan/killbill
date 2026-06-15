import { PrismaClient } from '@prisma/client';

const databaseUrl =
    process.env.DATABASE_URL ||
    `mysql://${process.env.DATABASE_USER || 'killbill'}:${process.env.DATABASE_PASSWORD || 'change_me_password'}@${process.env.DATABASE_HOST || '127.0.0.1'}:3306/${process.env.DATABASE_NAME || 'killbill'}`;

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: databaseUrl
        }
    }
});

async function main() {
    console.log('Testing connection...');
    try {
        await prisma.$connect();
        console.log('Connected to database.');
        const count = await prisma.user.count();
        console.log('User count:', count);
    } catch (e) {
        console.error('Connection failed:', e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
