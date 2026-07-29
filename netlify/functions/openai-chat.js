// Netlify Function (v2) — proxies a chat message to OpenAI's Chat Completions API.
// Requires environment variable OPENAI_API_KEY set in:
// Netlify dashboard -> Site configuration -> Environment variables -> Add a variable

export default async (req) => {
  try {
    const { message } = await req.json();
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "ยังไม่ได้ตั้งค่า OPENAI_API_KEY บน Netlify (Site configuration > Environment variables)" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    if (!message) {
      return new Response(JSON.stringify({ error: "ไม่มีข้อความส่งมา" }), { status: 400 });
    }

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: message }]
      })
    });

    const data = await r.json();
    const reply = data.choices?.[0]?.message?.content || data.error?.message || "ไม่มีคำตอบจาก OpenAI";

    return new Response(JSON.stringify({ reply }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};
