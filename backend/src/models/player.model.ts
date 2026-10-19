import {DataTypes, Model} from "sequelize";
import {sequelize} from "../sequelize";

class Player extends Model {
    declare id: number;
    declare name: string;
    declare balance: number;
    declare gains: number;
    declare color: string;
    declare bidAmount: number;
    declare bidRacer: number;
}

Player.init(
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        name: {
            type: DataTypes.STRING,
            defaultValue: ''
        },
        balance: {
            type: DataTypes.FLOAT,
            defaultValue: 5000
        },
        gains: {
            type: DataTypes.FLOAT,
            defaultValue: 0
        },
        color: {
            type: DataTypes.STRING,
            defaultValue: '#000000'
        },
        bidAmount: {
            type: DataTypes.FLOAT,
            defaultValue: 0
        },
        bidRacer: {
            type: DataTypes.INTEGER,
            defaultValue: -1
        }
    },
    {
        sequelize,
        tableName: 'player',
        modelName: 'Player',
        timestamps: false
    }
)

export default Player;