import {DataTypes, Model} from "sequelize";
import {sequelize} from "../sequelize";
import Player from "./player.model";

class Message extends Model {
    declare id: number;
    declare sender: number;
    declare message: string;
    declare time: string;
}

Message.init(
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        sender: {
            type: DataTypes.INTEGER,
            defaultValue: -1,
            references: {
                model: 'player',
                key: 'id'
            }
        },
        message: {
            type: DataTypes.STRING,
            defaultValue: ''
        },
        time: {
            type: DataTypes.STRING,
            defaultValue: ''
        }
    },
    {
        sequelize,
        tableName: 'message',
        modelName: 'Message',
        timestamps: false
    }
)

Message.belongsTo(Player, {
    foreignKey: 'sender',
    as: 'sender_fk'
});

export default Message;