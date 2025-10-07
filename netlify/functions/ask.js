
exports.handler = async (event) => {
  return {
    statusCode: 200,
    body: JSON.stringify({
      text: "Тестовый ответ от сервера.",
      transcript: "Тестовый голосовой ввод"
    })
  };
};
