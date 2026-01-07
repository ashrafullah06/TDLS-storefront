// app/api/whatsapp/webhook/route.js
export const dynamic = "force-dynamic";

function isLiveHoursDhaka() {
  // 10:00–20:00 Asia/Dhaka
  const now = new Date();
  const dhakaHour = Number(
    new Date(now.toLocaleString("en-US", { timeZone: "Asia/Dhaka", hour12: false })).getHours()
  );
  return dhakaHour >= 10 && dhakaHour < 20;
}

function isBangla(text = "") {
  return /[\u0980-\u09FF]/.test(text);
}

async function sendText(to, body) {
  const token = process.env.WA_ACCESS_TOKEN;
  const phoneNumberId = process.env.WA_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    // Soft fail if credentials missing
    return { ok: false, error: "WA credentials missing" };
  }
  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: String(to),
    type: "text",
    text: { body: String(body) },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function menuText(bn, offline) {
  if (bn) {
    return (
      `স্বাগতম! ${offline ? "আমরা এখন অফলাইনে (১০:০০–২০:০০ GMT+6 এর বাইরে)। তবুও মেসেজ করুন—আগামী কর্মদিবসে রিপ্লাই পাবেন।" : "আজ ১০:০০–২০:০০ (GMT+6) লাইভ সাপোর্ট খোলা।"}\n` +
      `অনুগ্রহ করে একটি অপশন বাছাই করুন:\n` +
      `1) সাইজিং হেল্প\n` +
      `2) অর্ডার স্ট্যাটাস\n` +
      `3) ডেলিভারি খরচ ও সময়\n` +
      `4) রিটার্ন / এক্সচেঞ্জ\n` +
      `5) ফ্যাব্রিক ও কেয়ার\n` +
      `6) মানব এজেন্ট\n` +
      `ইমেইল: support@thednalabstore.com\n` +
      `মেনু দেখতে লিখুন: Menu`
    );
  }
  return (
    `Hi from TDLC 👋 ${offline ? "We’re offline now (outside 10:00–20:00 GMT+6). We’ll reply next business day." : "Live agents: 10:00–20:00 (GMT+6)."}\n` +
    `Choose one:\n` +
    `1) Sizing help\n` +
    `2) Order status\n` +
    `3) Delivery cost & time\n` +
    `4) Return / exchange\n` +
    `5) Fabric & care\n` +
    `6) Talk to a human\n` +
    `Email: support@thednalabstore.com\n` +
    `Type: Menu to see options again`
  );
}

function replyForChoice(n, bn) {
  const offline = !isLiveHoursDhaka();
  if (bn) {
    switch (n) {
      case "1":
        return `দয়া করে আপনার উচ্চতা (সেমি), ওজন (কেজি), এবং পছন্দের ফিট (Slim/Regular/Relaxed/Oversized) লিখুন। আমরা দ্রুত সাইজ সাজেস্ট করব।`;
      case "2":
        return `গোপনীয়তার জন্য অর্ডার তথ্য OTP দিয়ে যাচাই করি। আপনার অর্ডার নম্বর এবং ফোন/ইমেইল লিখুন—আমরা যাচাইয়ের ধাপ জানাবো।`;
      case "3":
        return `আপনার এলাকা/থানা এবং পণ্যগুলোর নাম/পরিমাণ লিখুন। আমরা কুরিয়ার অপশন, খরচ ও ETA নিশ্চিত করব।`;
      case "4":
        return `অর্ডার নম্বর ও কোন আইটেম রিটার্ন/এক্সচেঞ্জ করতে চান লিখুন। আমরা যোগ্যতা দেখে ধাপ পাঠাবো।`;
      case "5":
        return `ফ্যাব্রিক, GSM, কেয়ার বা সঙ্কোচন (shrinkage) সম্পর্কে প্রশ্ন করুন—আমরা সুনির্দিষ্ট কেয়ার স্টেপ জানাবো।`;
      case "6":
        return offline
          ? `ঠিক আছে—মানব এজেন্টের সাথে যুক্ত করা হবে। এখন অফলাইনে; আমরা আগামী কর্মদিবসে রিপ্লাই দেব।`
          : `ঠিক আছে—মানব এজেন্টের সাথে যুক্ত করা হচ্ছে।`;
      default:
        return menuText(true, offline);
    }
  }
  switch (n) {
    case "1":
      return `Please share your height (cm), weight (kg), and preferred fit (Slim/Regular/Relaxed/Oversized). We’ll suggest a size.`;
    case "2":
      return `For privacy, we verify order info via OTP. Send your order # and phone/email—we’ll guide you through verification.`;
    case "3":
      return `Share your area/thana and the items. We’ll confirm courier options, cost, and ETA.`;
    case "4":
      return `Send your order # and the item you want to return or exchange. We’ll check eligibility and send steps.`;
    case "5":
      return `Ask anything about fabric, GSM, care, or shrinkage—we’ll reply with exact care steps.`;
    case "6":
      return offline
        ? `Got it — connecting you to a human. We’re currently offline; we’ll reply next business day.`
        : `Got it — connecting you to a human now.`;
    default:
      return menuText(false, offline);
  }
}

// --- Webhook verification (Facebook/Meta) ---
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === process.env.WA_VERIFY_TOKEN && challenge) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

// --- Message receiver ---
export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const change = body?.entry?.[0]?.changes?.[0];
    const messages = change?.value?.messages;
    if (!Array.isArray(messages) || !messages.length) {
      return new Response("ok", { status: 200 });
    }

    const msg = messages[0];
    const from = msg.from; // WhatsApp number (MSISDN)
    const text =
      msg.text?.body ||
      msg.button?.text ||
      msg.interactive?.list_reply?.title ||
      msg.interactive?.button_reply?.title ||
      "";

    const bn = isBangla(text);
    const trimmed = (text || "").trim();

    let reply;
    const offline = !isLiveHoursDhaka();

    if (/^menu$/i.test(trimmed) || /^মেনু$/i.test(trimmed)) {
      reply = menuText(bn, offline);
    } else if (/^[1-6]$/.test(trimmed)) {
      reply = replyForChoice(trimmed, bn);
    } else if (!trimmed) {
      reply = menuText(bn, offline);
    } else {
      // Free text: keep safe, propose menu
      reply = bn
        ? `ধন্যবাদ! আপনার বার্তা পেয়েছি। দ্রুত সহায়তার জন্য ১–৬ থেকে একটি অপশন বাছাই করুন।\n\n${menuText(true, offline)}`
        : `Thanks! We received your message. For fastest help, choose one of 1–6.\n\n${menuText(false, offline)}`;
    }

    await sendText(from, reply);
    return new Response("ok", { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || "Unexpected error" }), {
      status: 200, // 200 so Meta doesn't retry endlessly
      headers: { "Content-Type": "application/json" },
    });
  }
}
