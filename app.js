import express from "express";
import session from "express-session";
import mongoose from "mongoose";
import http from "http";
import { WebSocket, WebSocketServer } from "ws";
import { hash, breakMoney, moneyFractions, getBalance, Chain, getQueryAgg } from "./modules/tools.js";
import { User, Money, Block } from "./modules/schema.js";
import multer from "multer";
import cors from "cors";
import "dotenv/config";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server: server });

app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));
app.use(session({
    secret: "secretkey",
    resave: false,
    saveUninitialized: false
}));

wss.on("connection", (ws) => {
    console.log("New client connected.");
    ws.isAlive = true;
    if (wss.clients.size === 1) {
        wss.interval = setInterval(() => {
            wss.clients.forEach(client => {
                if (client.isAlive === false) {
                    client.terminate();
                    console.log("Disconnected client");
                }
                client.isAlive = false;
                client.ping();
            });
        }, 25000);
    } 

    ws.on("pong", () => {
        ws.isAlive = true;
    });

    ws.on("close", function() {
        if (wss.clients.size < 1) {
            clearInterval(wss.interval);
            console.log("Interval Cleared");
        }
    });

    ws.on("message", function(message) {
        const data = JSON.parse(message);
        if (data.type === "set-id") {
            ws.id = data.message;
            ws.send(JSON.stringify({
                type: "set-id",
                message: "Username is set."
            }));
        }
    })
});

mongoose.connect(process.env.MONGO_URI, async err => {
    if (err) {
        console.log(err);
        return;
    }
    console.log("Database connected.");
});

let BC = new Chain();
(async () => {
    if (BC.chain.length > await Block.countDocuments()) {
        const block = new Block(BC.chain[0]);
        await block.save();
    } else {
        BC.chain = await Block.find();
    }
})();

app.get("/", async (req, res) => {
    if (!req.session.username) {
        res.redirect("/login");
        return;
    }
    const username = req.session.username;
    const balance = await getBalance(username);
    res.render("index", {
        username: username,
        balance: balance
    });
});

app.get("/register", (req, res) => {
    res.render("register", {
        error: ""
    });
});

app.post("/register", async (req, res) => {
    const username = req.body.username;
    if ((await User.countDocuments({ username: username })) === 0) {
        const timestamp = new Date().toString();
        const newUser = new User({
            username: username,
            createdOn: timestamp
        });
        await newUser.save(err => console.log("New user created."));
        res.redirect("/login");
    } else {
        res.render("register", {
            error: "Username already used."
        });
    }
});

app.get("/login", (req, res) => {
    res.render("login", {
        error: ""
    });
});

app.post("/login", async (req, res) => {
    const username = req.body.username;
    if ((await User.countDocuments({ username: username })) > 0) {
        req.session.username = username;
        res.redirect("/");
    } else {
        res.render("login", {
            error: "User not found."
        });
    }
});

app.post("/create-account", multer().none(), cors(), async (req, res) => {
    const username = req.body.username;
    const timestamp = new Date().toString();
    if (await User.countDocuments({ username: username }) > 0) {
        res.send("0");
        return;
    } else {
        const newUser = new User({
            username: username,
            createdOn: timestamp
        });
        await newUser.save((err, doc) => {
            if (err) {
                res.send("0");
                return;
            } else {
                res.send("1");
            }
        });
    }
});

app.post("/send", multer().none(), cors(), async (req, res) => {
    const sender = req.body.sender;
    const receiver = req.body.receiver;
    const value = parseFloat(req.body.value);
    const description = req.body.description;
    
    const partCount = await User.countDocuments({ $or: [{ username: sender }, { username: receiver } ]});
    if (partCount < 2) {
        res.send(JSON.stringify({
            type: "failed",
            message: "Transaction party(s) doesn't exist."
        }));
        return;
    }

    const aggregatedData = await Money.aggregate([{
        $facet: {
            balance: [
                {
                    $match: { owner: sender }
                },
                {
                    $group: {
                        _id: null,
                        balance: { $sum: "$value" }
                    }
                }
            ],
            fractions: [
                {
                    $match: { owner: sender }
                },
                {
                    $group: {
                        _id: "$value",
                        count: { $count: {} },
                    }
                }
            ]   
        }
    }]);
    const balance = aggregatedData[0].balance[0] ? aggregatedData[0].balance[0].balance : 0;
    const foundMoney = aggregatedData[0].fractions;
    if (balance < value) {
        res.send(JSON.stringify({
            type: "failed",
            message: "Not enough balance."
        }));
        return;
    }
    const userFractions = breakMoney(value, foundMoney);
    if (userFractions.remainder === 0) {
        const aggQuery = getQueryAgg(userFractions.fractions, sender);
        Money.aggregate(aggQuery, {}, (err, money) => {
            let updateQuery = [];
            for (const fr of Object.keys(money[0])) {
                updateQuery = [...updateQuery, ...(money[0][`${fr}`])];
            }
            Money.updateMany({
                $or: updateQuery,
            }, { $set: { owner: receiver }}, async err => {
    
                const newBlock = BC.addBlock(sender, receiver, value, description);
                (new Block(newBlock)).save(err => {
                    console.log("TRANSACTION DONE BY " + sender);
                    wss.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN && client.id === receiver) {
                            client.send(JSON.stringify({
                                type: "received",
                                received: updateQuery,
                                added: value,
                                block: newBlock,
                                message: "Received " + value.toString()
                            }));
                        }
                    });
                    res.send(JSON.stringify({
                        type: "success",
                        sent: updateQuery,
                        balance: balance - value,
                        block: newBlock,
                        message: "Successfully sent!"
                    }));
                });
    
            });
        });

    } else {
        res.send(JSON.stringify({
            type: "failed",
            message: "Money fractions owned cannot result in the values."
        }));
        return;
    }
});

app.post("/create-money", multer().none(), cors(), async (req, res) => {
    const minter = req.body.minter;
    let docs = [];
    let sum = 0;
    for (const fr of moneyFractions) {
        for (let i = 0; i < 10; i++) {
            sum += fr;
            const date = new Date().toString();
            docs.push({
                serial: hash(i.toString() + fr.toString() + date + minter),
                value: fr,
                owner: minter,
                createdOn: date
            });
        }
    } 
    await Money.insertMany(docs);
    res.send(JSON.stringify({
        added: sum
    }));
});

app.post("/get-balance", multer().none(), cors(), async (req, res) => {
    const owner = req.body.owner;
    const balance = await getBalance(owner);
    res.send(JSON.stringify({
        balance: balance
    }));
});

app.post("/get-initial", multer().none(), cors(), (req, res) => {
    const owner = req.body.owner;
    Money.find({ owner: owner }, { _id: 0, serial: 1, value: 1 }, (err, ownedMoney) => {
        Block.find({
            $or: [
                { sender: owner },
                { receiver: owner }
            ]
        }, {}, (err, blocks) => {
            res.send(JSON.stringify({
                type: "success",
                money: ownedMoney,
                blocks: blocks
            }));
        });
    });
});

server.listen(process.env.PORT || 3000, () => {
    console.log("Server is running.");
});