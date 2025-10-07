const fetch = require('node-fetch');
const { Configuration, OpenAIApi } = require('openai');
const Papa = require('papaparse');

const GOOGLE_TTS_API_KEY = 'AIzaSyBGlVlL_6cyg2feRZbIToBNNzTVMqwj3vo';
const TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';

exports.handler = async function (event) {
  try {
    const body = JSON.parse(event.body || '{}');
    const userText = body.text || '';
    const audioBase64 = body.audio || null;
    const shouldGreet = body.shouldGreet !== false;

    let transcript = userText;

    if (audioBase64) {
      const configuration = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
      const openai = new OpenAIApi(configuration);

      const whisperRes = await openai.createTranscription(
        Buffer.from(audioBase64, 'base64'),
        'whisper-1'
      );

      transcript = whisperRes.data.text;
    }

    if (!transcript) {
      return { statusCode: 200, body: JSON.stringify({ text: "Ответ не получен.", transcript }) };
    }

    // Загрузка PROMPT из Google Docs
    const promptRes = await fetch("https://docs.google.com/document/d/1_N8EDELJy4Xk6pANqu4OK50fQjiixQDfR4o_xhuk1no/export?format=txt");
    const systemPrompt = await promptRes.text();

    // Загрузка базы (CSV)
    const csvUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRppYQcoP-i-zXr0WmxsObQv3cGiSMT_7gUXkSjaHUB-zlbflKbICVMDLrMc2HtGuhWMoXyqz-f84Bp/pub?gid=0&single=true&output=csv";
    const csvData = await fetch(csvUrl).then(res => res.text());
    const parsed = Papa.parse(csvData, { header: true });
    const sliced = parsed.data.slice(0, 10); // первые 10 строк

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Вопрос: ${transcript}\nБаза:\n${JSON.stringify(sliced, null, 2)}` }
    ];

    const configuration = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
    const openai = new OpenAIApi(configuration);

    const gptRes = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages
    });

    const finalText = gptRes.data.choices[0]?.message?.content?.trim() || "Ошибка генерации ответа.";

    // Запрос в Google TTS
    const ttsRes = await fetch(`${TTS_URL}?key=${GOOGLE_TTS_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text: finalText },
        voice: { languageCode: 'ru-RU', ssmlGender: 'FEMALE' },
        audioConfig: { audioEncoding: 'MP3' }
      })
    });

    const ttsData = await ttsRes.json();

    return {
      statusCode: 200,
      body: JSON.stringify({
        text: finalText,
        transcript,
        audio: ttsData.audioContent || null
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ text: "Ошибка сервера", error: err.message })
    };
  }
};