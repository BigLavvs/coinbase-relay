import express from "express";
import { WebSocketServer } from "ws";
import WebSocket from "ws";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const COINBASE_WS = "wss://ws-feed.exchange.coinbase.com";
const REQUIRED_TOKEN = process.env.RELAY_TOKEN || "";

const app = express();
app.get("/", (req, res) => res.send("Coinbase Relay is running"));
const server = app.listen(PORT, () => console.log(`HTTP server listening on ${PORT}`));

const wss = new WebSocketServer({ server });

let coinbaseWs = null;
let coinbaseConnected = false;
let aggregatedSubscriptions = new Set();
let clientSubscriptions = new Map();
let reconnectTimer = 1000;

function connectCoinbase() {
  console.log("Connecting to Coinbase...");
  coinbaseWs = new WebSocket(COINBASE_WS);

  coinbaseWs.on("open", () => {
    console.log("Connected to Coinbase WebSocket");
    coinbaseConnected = true;
    reconnectTimer = 1000;
    if (aggregatedSubscriptions.size > 0) {
      subscribeCoinbase(Array.from(aggregatedSubscriptions));
    }
  });

  coinbaseWs.on("message", (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.product_id) {
        const pid = data.product_id;
        for (const [client, setOf] of clientSubscriptions.entries()) {
          if (setOf.has(pid) && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
          }
        }
      }
    } catch (err) {
      console.warn("Failed to parse coinbase message", err);
    }
  });

  coinbaseWs.on("close", (code, reason) => {
    console.warn("Coinbase WS closed", code, reason);
    coinbaseConnected = false;
    setTimeout(() => {
      reconnectTimer = Math.min(reconnectTimer * 2, 60000);
      connectCoinbase();
    }, reconnectTimer);
  });

  coinbaseWs.on("error", (err) => {
    console.error("Coinbase WS error", err);
    try { coinbaseWs.close(); } catch(e){ }
  });
}

function subscribeCoinbase(productIds) {
  if (!coinbaseConnected) return;
  const msg = {
    type: "subscribe",
    channels: [{ name: "ticker", product_ids: productIds }]
  };
  coinbaseWs.send(JSON.stringify(msg));
  console.log("Sent subscribe to Coinbase:", productIds);
}

function unsubscribeCoinbase(productIds) {
  if (!coinbaseConnected) return;
  const msg = {
    type: "unsubscribe",
    channels: [{ name: "ticker", product_ids: productIds }]
  };
  coinbaseWs.send(JSON.stringify(msg));
  console.log("Sent unsubscribe to Coinbase:", productIds);
}

function addAggregated(product) {
  if (!aggregatedSubscriptions.has(product)) {
    aggregatedSubscriptions.add(product);
    if (coinbaseConnected) subscribeCoinbase([product]);
  }
}

function removeAggregated(product) {
  if (aggregatedSubscriptions.has(product)) {
    aggregatedSubscriptions.delete(product);
    if (coinbaseConnected) unsubscribeCoinbase([product]);
  }
}

wss.on("connection", (client, req) => {
  console.log("Client connected");
  if (REQUIRED_TOKEN) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get("token") || "";
    if (token !== REQUIRED_TOKEN) {
      client.send(JSON.stringify({ type: "error", message: "invalid token" }));
      client.close();
      return;
    }
  }

  clientSubscriptions.set(client, new Set());

  client.on("message", (msg) => {
    try {
      const payload = JSON.parse(msg.toString());
      if (payload.type === "subscribe" && Array.isArray(payload.products)) {
        for (const p of payload.products) {
          const product = p.toUpperCase();
          clientSubscriptions.get(client).add(product);
          addAggregated(product);
        }
        client.send(JSON.stringify({ type: "subscribed", products: payload.products }));
      } else if (payload.type === "unsubscribe" && Array.isArray(payload.products)) {
        for (const p of payload.products) {
          const product = p.toUpperCase();
          clientSubscriptions.get(client).delete(product);
          let stillNeeded = false;
          for (const setOf of clientSubscriptions.values()) {
            if (setOf.has(product)) { stillNeeded = true; break; }
          }
          if (!stillNeeded) removeAggregated(product);
        }
        client.send(JSON.stringify({ type: "unsubscribed", products: payload.products }));
      } else {
        client.send(JSON.stringify({ type: "error", message: "invalid message" }));
      }
    } catch (err) {
      client.send(JSON.stringify({ type: "error", message: "invalid json" }));
    }
  });

  client.on("close", () => {
    console.log("Client disconnected");
    const subs = clientSubscriptions.get(client) || new Set();
    clientSubscriptions.delete(client);
    for (const product of subs) {
      let stillNeeded = false;
      for (const setOf of clientSubscriptions.values()) {
        if (setOf.has(product)) { stillNeeded = true; break; }
      }
      if (!stillNeeded) removeAggregated(product);
    }
  });
});

connectCoinbase();
