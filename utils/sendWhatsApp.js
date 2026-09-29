// WhatsApp messages via the Meta WhatsApp Cloud API.
//
// Nothing in the app sent WhatsApp before this — the "WhatsApp" checkbox under
// Notify via was stored and ignored. Configure in .env:
//
//   WHATSAPP_TOKEN            permanent access token of the Meta app
//   WHATSAPP_PHONE_NUMBER_ID  the sending number's id (not the number itself)
//   WHATSAPP_TEMPLATE_NAME    an APPROVED message template (see below)
//   WHATSAPP_TEMPLATE_LANG    its language code, default "en"
//   WHATSAPP_DEFAULT_COUNTRY_CODE  prefixed to 10-digit numbers, default "91"
//
// WhatsApp only lets a business START a conversation with an approved
// template. Without WHATSAPP_TEMPLATE_NAME a plain text message is sent, and
// WhatsApp delivers that only within 24 hours of the student last messaging
// the number — fine for testing, not for real announcements.
//
// Unconfigured, every send is a logged no-op that resolves { skipped: true } —
// never a throw — so a missing WhatsApp setup never blocks Dashboard or Gmail.

const axios = require("axios");

const isWhatsAppConfigured = () =>
  Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);

/** Digits only, with the default country code in front of a bare 10-digit number. */
const toWhatsAppNumber = (raw) => {
  const cc = process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || "91";
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 10) return `${cc}${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `${cc}${digits.slice(1)}`;
  return digits.length > 10 ? digits : null;
};

let warnedUnconfigured = false;

/**
 * @param {string} phone  as stored on the user (any formatting)
 * @param {{ text: string, templateParams?: string[] }} message
 *   `text` is the plain-text fallback; `templateParams` fill the approved
 *   template's body variables {{1}}, {{2}}, … in order.
 * @returns {Promise<{ success: boolean, skipped?: boolean, id?: string, error?: string }>}
 */
async function sendWhatsApp(phone, { text, templateParams } = {}) {
  if (!isWhatsAppConfigured()) {
    if (!warnedUnconfigured) {
      console.warn("[whatsapp] not configured (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID) — WhatsApp sends are skipped");
      warnedUnconfigured = true;
    }
    return { success: false, skipped: true, error: "WhatsApp is not configured on the server" };
  }
  const to = toWhatsAppNumber(phone);
  if (!to) return { success: false, error: "No valid phone number" };

  const template = process.env.WHATSAPP_TEMPLATE_NAME;
  const payload = template && Array.isArray(templateParams) && templateParams.length
    ? {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: template,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "en" },
          components: [{
            type: "body",
            parameters: templateParams.map((value) => ({ type: "text", text: String(value ?? "") })),
          }],
        },
      }
    : { messaging_product: "whatsapp", to, type: "text", text: { body: text || "" } };

  try {
    const version = process.env.WHATSAPP_API_VERSION || "v20.0";
    const res = await axios.post(
      `https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      payload,
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }, timeout: 15000 }
    );
    return { success: true, id: res.data?.messages?.[0]?.id };
  } catch (err) {
    return { success: false, error: err.response?.data?.error?.message || err.message };
  }
}

module.exports = { sendWhatsApp, isWhatsAppConfigured, toWhatsAppNumber };
