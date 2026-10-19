import {DataTypes, Model} from "sequelize";
import {sequelize} from "../sequelize";

class Game extends Model {
    declare id: number;
    declare currentRace: number;
    declare gameStatus: string;
    declare players: number[];
    declare races: number[];
}

Game.init(
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        currentRace: {
            type: DataTypes.INTEGER,
            defaultValue: -1
        },
        gameStatus: {
            type: DataTypes.STRING,
            defaultValue: 'waiting'
        },
        players: {
            type: DataTypes.JSON
        },
        races: {
            type: DataTypes.JSON
        }
    },
    {
        sequelize,
        tableName: 'game',
        modelName: 'Game',
        timestamps: false
    }
)

export default Game;