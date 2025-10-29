import WebSocket from "ws";

export default function handler(req, res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const coinbase = new WebSocket("wss://ws-feed.exchange.coinbase.com");

  coinbase.on("open", () => {
    coinbase.send(JSON.stringify({
      type: "subscribe",
      channels: [{ name: "ticker", product_ids: ["BTC-USD"] }]
    }));
  });

  coinbase.on("message", (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.type === "ticker") {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    } catch (e) {}
  });

  req.on("close", () => {
    coinbase.close();
    res.end();
  });
}
