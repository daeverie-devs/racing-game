import 'dotenv/config';
import { Sequelize } from 'sequelize';

// The game has its own database (racing_game by default), separate from master-trackers
export const sequelize = new Sequelize({
    dialect: 'mysql',
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    database: process.env.DB_NAME || 'racing_game',
    username: process.env.DB_USER ?? '',
    password: process.env.DB_PASS ?? '',
    logging: false,
});
