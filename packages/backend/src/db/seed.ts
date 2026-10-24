import { eq } from 'drizzle-orm';
import { hashPassword } from '../auth/session';
import { env } from '../env';
import { migrateDb, openDb, type DB } from './index';
import { users } from './schema';

/** Creates the admin user if no user with that email exists. Returns true when created. */
export async function seedAdmin(db: DB, email: string, password: string, displayName = 'Admin'): Promise<boolean> {
	const normalized = email.toLowerCase();
	if (db.select({ id: users.id }).from(users).where(eq(users.email, normalized)).get()) return false;
	db.insert(users)
		.values({ id: crypto.randomUUID(), role: 'admin', email: normalized, passwordHash: await hashPassword(password), displayName })
		.run();
	return true;
}

if (import.meta.main) {
	if (!env.adminEmail || !env.adminPassword) {
		console.log('ADMIN_EMAIL / ADMIN_PASSWORD not set; skipping admin seed');
		process.exit(0);
	}
	if (env.adminPassword.length < 8) {
		console.error('ADMIN_PASSWORD must be at least 8 characters');
		process.exit(1);
	}
	const db = openDb(env.databasePath);
	migrateDb(db);
	const created = await seedAdmin(db, env.adminEmail, env.adminPassword);
	console.log(created ? `Admin ${env.adminEmail} created` : `Admin ${env.adminEmail} already exists`);
}
