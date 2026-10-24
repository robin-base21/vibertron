import { env } from '../env';
import { migrateDb, openDb } from './index';

migrateDb(openDb(env.databasePath));
console.log('Migrations applied');
