const fetch = require('node-fetch');
const FormData = require('form-data');

exports.handler = async function(event) {
  const formData = new FormData();
  const buffer = Buffer.from(event.body.split(',')[1], 'base64');
  formData.append('file', buffer, { filename: 'audio.webm', contentType: 'audio/webm' });
  formData.append('model', 'whisper-1');

  const whisper = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: formData,
  });
  const whisperJson = await whisper.json();
  const prompt = whisperJson.text || "Не понял";

  const chat = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const chatJson = await chat.json();
  const reply = chatJson.choices?.[0]?.message?.content || "Нет ответа";

  const tts = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'tts-1',
      voice: 'nova',
      input: reply
    })
  });
  const audioBuffer = await tts.arrayBuffer();
  const base64Audio = Buffer.from(audioBuffer).toString('base64');
  const audio_url = `data:audio/mp3;base64,${base64Audio}`;

  return {
    statusCode: 200,
    body: JSON.stringify({ reply, audio_url })
  };
};
