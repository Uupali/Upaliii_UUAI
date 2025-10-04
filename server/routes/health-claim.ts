import { RequestHandler } from "express";
import https from "https";
import { URL } from "url";

// const REMOTE_ROOT = "https://uppsala-ai-hackthon-food-ingredient.onrender.com";
const REMOTE_ROOT = "https://a52205da9c96.ngrok-free.app"
export const handleHealthClaim: RequestHandler = async (req, res) => {
  try {
    const target = new URL("/api/health-claim/check", REMOTE_ROOT);
    const body = JSON.stringify(req.body || {});
    console.log(body);
    const optionsBase: https.RequestOptions = {
      method: "POST",
      hostname: target.hostname,
      path: target.pathname + target.search,
      port: target.port ? Number(target.port) : 443,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: 90000, // 90 seconds
    };

    const sendRequest = () => new Promise<{ status?: number; text: string }>((resolve, reject) => {
      const options = { ...optionsBase };
      const proxyReq = https.request(options, (proxyRes) => {
        const chunks: Buffer[] = [];
        proxyRes.on("data", (c) => chunks.push(Buffer.from(c)));
        proxyRes.on("end", () => {
          const responseText = Buffer.concat(chunks).toString("utf-8");
          resolve({ status: proxyRes.statusCode, text: responseText });
        });
      });

      proxyReq.on("error", (err) => reject(err));
      proxyReq.on("timeout", () => {
        proxyReq.destroy();
        reject(new Error("timeout"));
      });

      proxyReq.write(body);
      proxyReq.end();
    });

    // try once, retry one time on transient network errors
    let attempt = 0;
    const maxAttempts = 2;
    while (attempt < maxAttempts) {
      try {
        const result = await sendRequest();
        res.status(result.status || 500);
        try {
          const json = JSON.parse(result.text);
          res.json(json);
        } catch (e) {
          res.send(result.text);
        }
        return;
      } catch (err: any) {
        attempt += 1;
        console.error(`/api/health-claim/check proxy attempt ${attempt} error:`, err?.message ?? err);
        if (attempt >= maxAttempts) {
          if (!res.headersSent) {
            if (err.message === "timeout") res.status(504).json({ error: "Gateway Timeout" });
            else res.status(502).json({ error: "Bad Gateway", message: err.message ?? String(err) });
          }
          return;
        }
        // small delay before retry
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  } catch (err: any) {
    console.error("/api/health-claim/check unexpected error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Internal Server Error", message: String(err) });
  }
};
