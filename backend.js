import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(express.json({ limit: "1mb" }));

app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN,
    credentials: true,
  }),
);

const PORT = process.env.PORT || 3000;

function ringCentralBaseUrl() {
  return process.env.RC_ENV === "sandbox"
    ? "https://platform.devtest.ringcentral.com"
    : "https://platform.ringcentral.com";
}

async function getRingCentralToken() {
  const clientId = process.env.RC_CLIENT_ID;
  const clientSecret = process.env.RC_CLIENT_SECRET;
  const jwt = process.env.RC_JWT;

  if (!clientId || !clientSecret || !jwt) {
    throw new Error("Missing RingCentral credentials");
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(`${ringCentralBaseUrl()}/restapi/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const data = await res.json();

  if (!res.ok || !data.access_token) {
    throw new Error(
      data.message || data.error_description || "RingCentral auth failed",
    );
  }

  return data.access_token;
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "SignalSend Backend",
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/phone-numbers", async (req, res) => {
  try {
    const token = await getRingCentralToken();

    const rcRes = await fetch(
      `${ringCentralBaseUrl()}/restapi/v1.0/account/~/extension/~/phone-number`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    const data = await rcRes.json();

    if (!rcRes.ok) {
      return res.status(rcRes.status).json(data);
    }

    const numbers = (data.records || [])
      .filter((record) => record.features?.includes("SmsSender"))
      .map((record) => ({
        phoneNumber: record.phoneNumber,
        label: record.label || "",
      }));

    res.json({ numbers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/sms", async (req, res) => {
  try {
    const { from, to, text } = req.body;

    if (!from || !to || !text) {
      return res.status(400).json({
        error: "Missing required fields: from, to, text",
      });
    }

    if (!Array.isArray(to) || to.length === 0) {
      return res.status(400).json({
        error: "to must be a non-empty array of phone numbers",
      });
    }

    if (text.length > 1000) {
      return res.status(400).json({
        error: "Message is too long",
      });
    }

    const token = await getRingCentralToken();

    const results = [];

    for (const phoneNumber of to) {
      const rcRes = await fetch(
        `${ringCentralBaseUrl()}/restapi/v1.0/account/~/extension/~/sms`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: { phoneNumber: from },
            to: [{ phoneNumber }],
            text,
          }),
        },
      );

      const data = await rcRes.json();

      results.push({
        phoneNumber,
        ok: rcRes.ok,
        status: rcRes.status,
        data,
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/inbox", async (req, res) => {
  try {
    const token = await getRingCentralToken();

    const rcRes = await fetch(
      `${ringCentralBaseUrl()}/restapi/v1.0/account/~/extension/~/message-store?messageType=SMS&direction=Inbound&perPage=50`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    const data = await rcRes.json();

    if (!rcRes.ok) {
      return res.status(rcRes.status).json(data);
    }

    res.json({
      records: data.records || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`SignalSend backend running on port ${PORT}`);
});
