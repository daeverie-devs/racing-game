import {DataTypes, Model} from "sequelize";
import {sequelize} from "../sequelize";

class Race extends Model {
    declare id: number;
    declare link: string;
    declare racers: number[];
    declare winner: number;
}

Race.init(
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        link: {
            type: DataTypes.STRING,
            defaultValue: ''
        },
        racers: {
            type: DataTypes.JSON
        },
        winner: {
            type: DataTypes.INTEGER
        }
    },
    {
        sequelize,
        tableName: 'race',
        modelName: 'Race',
        timestamps: false
    }
)

export default Race;