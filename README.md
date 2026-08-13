# Cash Top WhatsApp AI — Vercel

Upload these files to the root of the GitHub repository linked to your Vercel project.

Required Vercel Environment Variables:
- GREEN_API_URL
- GREEN_INSTANCE_ID
- GREEN_API_TOKEN

Optional:
- GROQ_API_KEY
- GROQ_MODEL

The bot uses the existing Firebase Realtime Database and reads:
- cashTopAI/settings
- cashTopAI/qa
- cashTopAI/knowledge

It stores per-customer conversation memory in:
- cashTopAI/whatsappSessions

It stores processed message IDs in:
- cashTopAI/whatsappProcessed


## Diagnostics
- `api/diagnostics.js`: checks GREEN API state, current webhook URL, incomingWebhook, Firebase and Groq readiness without exposing the API token.
