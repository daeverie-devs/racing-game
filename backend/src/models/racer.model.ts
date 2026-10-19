import {DataTypes, Model, UUID} from "sequelize";
import {sequelize} from "../sequelize";

class Racer extends Model {
    declare id: number;
    declare bidAmount: number;
}

Racer.init(
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        image: {
            type: DataTypes.TEXT('long'),
        },
        bidAmount: {
            type: DataTypes.FLOAT,
            defaultValue: 0
        }
    },
    {
        sequelize,
        tableName: 'racer',
        modelName: 'Racer',
        timestamps: false
    }
)

export default Racer;