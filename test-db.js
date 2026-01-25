const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: "mysql://root:toor@127.0.0.1:3306/killbill"
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
