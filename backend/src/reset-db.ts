import 'dotenv/config';
import {sequelize} from './sequelize';
import './models';
import {resetGame} from './game/engine';

// npm run reset-db: puts the active game back in the lobby (players, bets, chat and results wiped,
// racers, races and games kept). Same as the admin's "Réinitialiser" button.
// npm run reset-db -- --rebuild: drops every table and recreates them empty.
const main = async () => {
    await sequelize.authenticate();
    if (process.argv.includes('--rebuild')) {
        await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
        const [tables] = await sequelize.query('SHOW TABLES');
        for (const row of tables as Record<string, string>[]) {
            await sequelize.query(`DROP TABLE IF EXISTS \`${Object.values(row)[0]}\``);
        }
        await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
        await sequelize.sync();
        console.log('Database rebuilt: every table dropped and recreated empty.');
    } else {
        await sequelize.sync();
        await resetGame();
        console.log('Active game reset: back to the lobby, players, bets and chat removed.');
    }
    await sequelize.close();
};

main().catch(err => {
    console.error('Reset failed:', err);
    process.exit(1);
});
