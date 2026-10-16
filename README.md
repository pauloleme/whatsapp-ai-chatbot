# WhatsApp AI Bot (Gemini / ChatGPT / Claude)

A small Node.js server that connects the official **WhatsApp Cloud API** (Meta) to an AI model. It receives messages sent to your WhatsApp number, forwards them to the AI provider you choose, and replies in the same chat.

## Features

- Official WhatsApp Cloud API integration (no unofficial libraries, no QR code login)
- Switch AI provider with one environment variable: **Google Gemini**, **OpenAI (ChatGPT)** or **Anthropic (Claude)**
- Per-contact conversation history (in memory)
- `/reset` command to clear the conversation context
- Webhook signature validation (`X-Hub-Signature-256`) to make sure requests really come from Meta
- Duplicate message protection and automatic "read" receipts
- Long replies are split to respect WhatsApp's message size limit
- Zero AI SDKs: only `express` and `dotenv`, using Node's native `fetch`

## Requirements

- Node.js 18 or newer
- A Meta developer account with a WhatsApp app
- An API key for at least one AI provider
- A public HTTPS URL for the webhook (for local testing, [ngrok](https://ngrok.com) works well)

## Quick start

```bash
git clone <your-repo-url>
cd <your-repo-folder>
npm install
cp .env.example .env     # then fill in your values
npm start
```

You should see:

```
Servidor rodando na porta 3000 | IA: gemini
```

Opening `http://localhost:3000` should show `Bot ativo (provedor: gemini)`.

## Configuration (`.env`)

| Variable | Description |
|---|---|
| `AI_PROVIDER` | `gemini`, `openai` or `claude` |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Google AI Studio key and model name |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | OpenAI key and model name |
| `ANTHROPIC_API_KEY` / `CLAUDE_MODEL` | Anthropic key and model name |
| `WHATSAPP_TOKEN` | WhatsApp Cloud API access token |
| `WHATSAPP_PHONE_NUMBER_ID` | ID of the WhatsApp phone number |
| `WHATSAPP_VERIFY_TOKEN` | Any secret string you invent; must match the one set in the Meta webhook |
| `META_APP_SECRET` | App secret, used to validate webhook signatures |
| `GRAPH_VERSION` | Meta Graph API version (e.g. `v26.0`) |
| `PORT` | Local server port (default `3000`) |
| `SYSTEM_PROMPT` | Instructions given to the AI on every request |
| `MAX_HISTORY` | Number of messages remembered per contact (default `20`) |

Only the key for the provider you selected in `AI_PROVIDER` is required. Model names change over time, so check your provider's documentation for currently available models.

## Setting up WhatsApp (Meta)

1. Go to [developers.facebook.com](https://developers.facebook.com) and create an app with the **"Connect with customers through WhatsApp"** use case.
2. In **Use cases > Customize**, follow **Step 1: Try it out** to get a test phone number. Add your personal number as an allowed recipient.
3. Copy the **Phone number ID** to `WHATSAPP_PHONE_NUMBER_ID` and the **access token** to `WHATSAPP_TOKEN`.
   - The temporary token expires after about 24 hours. For continuous use, create a permanent token with a System User in Business Settings (permissions: `whatsapp_business_management` and `whatsapp_business_messaging`).
4. Copy the **App Secret** (**App settings > Basic**) to `META_APP_SECRET`.
5. Start the server and expose it, e.g. `ngrok http 3000`.
6. In **Use cases > Customize > Configuration**, set up the webhook:
   - **Callback URL:** `https://YOUR-PUBLIC-URL/webhook`
   - **Verify token:** the same value as `WHATSAPP_VERIFY_TOKEN`
   - Subscribe to the **messages** field.
7. From your phone, send a message to the test number. The AI reply should arrive in the same chat.

Menu names in the Meta dashboard change from time to time. See the [official getting started guide](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started) if something looks different.

## Switching AI providers

Change `AI_PROVIDER` in `.env` to `gemini`, `openai` or `claude`, then restart the server. The `.env` file is only read at startup.

## Troubleshooting

| Problem | Likely cause |
|---|---|
| Page shows the wrong provider | The file must be named exactly `.env` (not `_env` or `.env.txt`); restart after editing |
| Webhook verification fails | Server or tunnel not running, or verify token differs from `.env` |
| Webhook verifies but no messages arrive | The **messages** field is not subscribed |
| `401` when receiving webhooks | Wrong `META_APP_SECRET` |
| `401` / `190` when sending replies | Expired or invalid `WHATSAPP_TOKEN` |
| `404` from the AI provider | Model name in `.env` is wrong or retired |
| `400` / `403` from the AI provider | Invalid API key or no credit |

## Notes and limitations

- Conversation history is stored in memory and is lost on restart. For production, use Redis or a database.
- WhatsApp only allows free-form replies within 24 hours of the user's last message; outside that window you need approved message templates.
- Only text messages are handled for now.
- For always-on hosting, use a platform such as Railway, Render or Fly.io, or a VPS with HTTPS, instead of ngrok.

## Security

- **Never commit your `.env` file.** Add it to `.gitignore` and share only `.env.example` with placeholder values.
- If an API key or token is ever exposed, revoke it and create a new one.
- Keep `META_APP_SECRET` configured so webhook signatures are validated.

## License

Choose a license for your repository (for example MIT) and add a `LICENSE` file.
