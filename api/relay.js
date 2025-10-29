export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // ✅ Allow all origins (fix for Bubble)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight (OPTIONS) request
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  const { symbol } = req.query;
  if (!symbol) {
    res.status(400).end("Missing symbol");
    return;
  }

  console.log("🔌 Streaming price for", symbol);

  // Connect to Coinbase WebSocket feed
  const WebSocket = (await import("ws")).default;
  const ws = new WebSocket("wss://ws-feed.exchange.coinbase.com");

  ws.on("open", () => {
    ws.send(JSON.stringify({
      type: "subscribe",
      product_ids: [symbol],
      channels: ["ticker"]
    }));
  });

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === "ticker" && data.price) {
        res.write(`data: ${JSON.stringify({ price: data.price })}\n\n`);
      }
    } catch (err) {
      console.error("Error parsing WS message:", err);
    }
  });

  req.on("close", () => {
    console.log("❌ Client closed connection");
    ws.close();
    res.end();
  });
}
