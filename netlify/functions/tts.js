const textToSpeech = require('@google-cloud/text-to-speech');
const fs = require('fs');
const util = require('util');

const client = new textToSpeech.TextToSpeechClient();

exports.handler = async function(event) {
  const { text } = JSON.parse(event.body || '{}');
  const request = {
    input: { text },
    voice: { languageCode: 'ru-RU', ssmlGender: 'FEMALE' },
    audioConfig: { audioEncoding: 'MP3' },
  };

  const [response] = await client.synthesizeSpeech(request);

  return {
    statusCode: 200,
    headers: { "Content-Type": "audio/mpeg" },
    body: response.audioContent.toString('base64'),
    isBase64Encoded: true,
  };
};
