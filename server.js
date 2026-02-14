const express = require("express");
const fs = require("fs");
const path = require("path");

require("./robo"); // inicia o robô normalmente

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/status", (req, res) => {
    try {
        const data = fs.readFileSync("status.json");
        res.json(JSON.parse(data));
    } catch {
        res.json({ status: "Inicializando..." });
    }
});

app.get("/api/trades", (req, res) => {
    try {
        const data = fs.readFileSync("trades.json");
        res.json(JSON.parse(data));
    } catch {
        res.json([]);
    }
});

app.listen(PORT, () => {
    console.log("Painel rodando na porta", PORT);
});