import mongoose from "mongoose";

const Money = mongoose.model("money", mongoose.Schema({
    serial: {
        type: String,
        unique: true
    },
    value: Number,
    owner: String,
    createdOn: String 
}));

const User = mongoose.model("user", mongoose.Schema({
    username: String,
    createdOn: String
}));

const Block = mongoose.model("block", mongoose.Schema({
    _id: {
        type: Number,
        unique: true
    },
    previousHash: String,
    hash: String,
    sender: String,
    receiver: String,
    amount: Number, 
    description: String,
    timestamp: String
}));

export { User, Money, Block };