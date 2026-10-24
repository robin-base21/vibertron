import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { db } from './index';

migrate(db, { migrationsFolder: `${import.meta.dir}/../../drizzle` });
console.log('Migrations applied');
