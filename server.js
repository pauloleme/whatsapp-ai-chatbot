require("dotenv").config();
const crypto = require("crypto");
const express = require("express");

const {
  PORT = 3000,
  AI_PROVIDER = "openai", // 'openai' ou 'claude'
  OPENAI_API_KEY,
  OPENAI_MODEL = "gpt-4o-mini",
  ANTHROPIC_API_KEY,
  CLAUDE_MODEL = "claude-sonnet-5-5",
  WHATSAPP_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_VERIFY_TOKEN,
  META_APP_SECRET,
  GRAPH_VERSION = "v21.0",
  SYSTEM_PROMPT = "Você é um assistente prestativo no WhatsApp. Responda em português, de forma clara e curta.",
  MAX_HISTORY = 20,
} = process.env;

const app = express();

// Guardamos o corpo bruto para validar a assinatura da Meta
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

// ---------- Memória de conversa (em RAM; use Redis/DB em produção) ----------
const historico = new Map(); // telefone -> [{role, content}]
const processadas = new Set(); // ids de mensagens já tratadas (evita duplicidade)

function addHistorico(telefone, role, content) {
  const msgs = historico.get(telefone) || [];
  msgs.push({ role, content });
  while (msgs.length > Number(MAX_HISTORY)) msgs.shift();
  historico.set(telefone, msgs);
  return msgs;
}

// ---------- Chamadas às IAs ----------
async function perguntarOpenAI(mensagens) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...mensagens],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

async function perguntarClaude(mensagens) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: mensagens,
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

const perguntarIA =
  AI_PROVIDER === "claude" ? perguntarClaude : perguntarOpenAI;

// ---------- WhatsApp ----------
async function enviarWhatsApp(para, texto) {
  // Limite do WhatsApp: 4096 caracteres por mensagem
  const partes = texto.match(/[\s\S]{1,4000}/g) || [""];
  for (const parte of partes) {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: para,
          type: "text",
          text: { body: parte },
        }),
      },
    );
    if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${await res.text()}`);
  }
}

async function marcarComoLida(messageId) {
  try {
    await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: messageId,
        }),
      },
    );
  } catch (_) {
11    /* não é crítico */
  }
}

function assinaturaValida(req) {
  if (!META_APP_SECRET) return true; // sem segredo configurado, não valida (apenas para testes)
  const header = req.get("x-hub-signature-256");
  if (!header || !req.rawBody) return false;
  const esperado =
    "sha256=" +
    crypto
      .createHmac("sha256", META_APP_SECRET)
      .update(req.rawBody)
      .digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function tratarMensagem(msg) {
  const telefone = msg.from;

  if (msg.type !== "text") {
    await enviarWhatsApp(
      telefone,
      "Por enquanto só consigo responder mensagens de texto 🙂",
    );
    return;
  }

  const texto = msg.text.body.trim();

  // Comando para limpar o contexto
  if (texto.toLowerCase() === "/reset") {
    historico.delete(telefone);
    await enviarWhatsApp(telefone, "Conversa reiniciada ✅");
    return;
  }

  const mensagens = addHistorico(telefone, "user", texto);
  const resposta = await perguntarIA(mensagens);
  addHistorico(telefone, "assistant", resposta);
  await enviarWhatsApp(telefone, resposta);
}

// ---------- Rotas ----------
// Verificação do webhook (a Meta chama uma vez ao configurar)
app.get("/webhook", (req, res) => {
  const {
    "hub.mode": mode,
    "hub.verify_token": token,
    "hub.challenge": challenge,
  } = req.query;
  if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Recebimento de mensagens
app.post("/webhook", (req, res) => {
  if (!assinaturaValida(req)) return res.sendStatus(401);

  // Responde 200 logo para a Meta não reenviar; processa em segundo plano
  res.sendStatus(200);

  const mensagens = (req.body.entry || [])
    .flatMap((e) => e.changes || [])
    .flatMap((c) => c.value?.messages || []);

  for (const msg of mensagens) {
    if (processadas.has(msg.id)) continue;
    processadas.add(msg.id);
    if (processadas.size > 5000)
      processadas.delete(processadas.values().next().value);

    marcarComoLida(msg.id);
    tratarMensagem(msg).catch(async (err) => {
      console.error("Erro ao tratar mensagem:", err.message);
      try {
        await enviarWhatsApp(
          msg.from,
          "Desculpe, tive um problema para responder agora. Tente de novo.",
        );
      } catch (_) {}
    });
  }
});

app.get("/", (_req, res) => res.send(`Bot ativo (provedor: ${AI_PROVIDER})`));

app.listen(PORT, () =>
  console.log(`Servidor rodando na porta ${PORT} | IA: ${AI_PROVIDER}`),
);
