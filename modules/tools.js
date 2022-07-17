import crypto from "crypto";
import { Money } from "./schema.js";

const moneyFractions = [100000, 75000, 50000, 20000, 10000, 5000, 1000, 500, 200, 100];

function compareWithDB(value, valueCount, DBdata) {
    let suffice = true;
    let required = 0;
    let DBcount = (DBdata.filter(item => item._id === value))[0];
    if (!DBcount) DBcount = 0;
    else DBcount = DBcount.count;
    if (DBcount < valueCount) {
        suffice = false;
        required = valueCount - DBcount;
    }
    return {
        suffice: suffice,
        required: required
    };
}

function breakMoney(amount, DBdata) {
    let fractions = {};
    for (const fr of moneyFractions) fractions[`${fr}`] = 0;
    let iter = 0;
    while (iter < moneyFractions.length) {
        if (moneyFractions[iter] <= amount) {
            fractions[`${moneyFractions[iter]}`]++;
            amount -= moneyFractions[iter];
        } else {
            const check = compareWithDB(moneyFractions[iter], fractions[`${moneyFractions[iter]}`], DBdata);
            if (!check.suffice) {
                amount += check.required * moneyFractions[iter];
                fractions[`${moneyFractions[iter]}`] -= check.required;
            }
            iter++;
        }
    }

    return {
        fractions: fractions,
        remainder: amount
    };
}

function hash(string) {
    return crypto.createHash("sha256").update(string).digest("hex");
}

function sum(arr) {
    let sum = 0;
    for (const i of arr) sum += i;
    return sum;
}

// function getSerials(DBmoney, fractions) {
//     const updates = [];
//     for (const fr of moneyFractions) {
//         const count = fractions[`${fr}`];
//         const filtered = DBmoney.filter(item => item.value === fr);
//         for (let i = 0; i < count; i++) {
//             updates.push(filtered[i]);
//         }
//     }
//     return updates;
// }

async function getBalance(username) {
    const agg = await Money.aggregate([
        {
            $match: { owner: username }
        },
        {
            $group: {
                _id: null,
                balance: { $sum: "$value" }
            }
        }
    ]);
    const balance = agg[0] ? agg[0].balance : 0;
    return balance;
}

class Chain {
    constructor() {
        this.chain = [];
        this.addBlock("", "", 0, "GENESIS");
    }

    addBlock(sender, receiver, amount, description) {
        const timestamp = new Date().toString();
        const previousHash = this.chain.length > 0 ? this.getLatestBlock().hash : "0";
        const block = {
            _id: this.chain.length + 1,
            previousHash: previousHash,
            hash: this.hash(previousHash + sender + receiver + amount.toString() + description + timestamp),
            sender: sender,
            receiver: receiver,
            amount: amount,
            description: description,
            timestamp: timestamp
        };
        this.chain.push(block);
        return block;
    }

    getLatestBlock() {
        return this.chain[this.chain.length - 1];
    }

    hash(string) {
        return crypto.createHash("sha256").update(string).digest("hex");
    }
}

function getQueryAgg(fractions, owner) {
    let docs = {
        $facet: {}
    };
    for (const fr of moneyFractions) {
        if (fractions[`${fr}`] === 0) continue;
        let temp = [
            {
                $match: {
                    value: fr,
                    owner: owner,
                }
            },
            {
                $project: {
                    serial: 1,
                    value: 1,
                    _id: 0,
                }
            },
            {
                $limit: fractions[`${fr}`]
            }
        ]
        docs.$facet[`${fr}`] = temp;
    }
    return [docs];
}

export { hash, breakMoney, moneyFractions, sum, getBalance, Chain, getQueryAgg };