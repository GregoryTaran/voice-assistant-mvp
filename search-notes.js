/* search-notes.js (Step 1)
 * Минимальный UI + контроль микрофона.
 * Ничего не отправляем в GPT, не показываем распознанный текст.
 * Добавляем индикатор «Разговор…» и кнопку «ЗАКОНЧИТЬ» динамически.
 * Результаты ниже — пока пустой контейнер для будущих результатов.
 */

(function () {
  'use strict';

  // Конфиг селекторов
  const SELECTORS = {
    searchSection: '.search-notes',         // секция, куда добавим индикатор и контейнер результатов
    searchButton:  '#searchNotesBtn',       // основная кнопка «ПОИСК ПО ЗАМЕТКАМ»
  };

  // Состояние модуля
  const state = {
    mediaStream: null,
    mediaRecorder: null,
    isTalking: false,
    endBtn: null,
    talkBadge: null,
    resultsContainer: null,
    chunks: [], // аудио чанки (на будущее)
  };

  // Инициализация после DOMContentLoaded
  document.addEventListener('DOMContentLoaded', init);

  function init() {
    const btn = document.querySelector(SELECTORS.searchButton);
    const section = document.querySelector(SELECTORS.searchSection);
    if (!btn || !section) {
      console.warn('[search-notes] Не найдены требуемые элементы UI.');
      return;
    }

    // Создадим контейнер для будущих результатов (под кнопкой), если его нет
    state.resultsContainer = section.querySelector('.search-results');
    if (!state.resultsContainer) {
      state.resultsContainer = document.createElement('div');
      state.resultsContainer.className = 'search-results';
      state.resultsContainer.style.marginTop = '12px';
      section.appendChild(state.resultsContainer);
    }

    // Навесим обработчик на кнопку поиска
    btn.addEventListener('click', onStartDialog);
  }

  async function onStartDialog() {
    if (state.isTalking) return;

    const btn = document.querySelector(SELECTORS.searchButton);
    const section = document.querySelector(SELECTORS.searchSection);

    // Заблокировать кнопку поиска
    btn.disabled = true;

    // Показать индикатор «Разговор…» и кнопку «ЗАКОНЧИТЬ»
    renderTalkUI(section);

    // Запросить микрофон и запустить запись
    try {
      await startRecording();
      state.isTalking = true;
    } catch (err) {
      console.error('[search-notes] Не удалось запустить запись:', err);
      stopDialogUI(); // убрать UI и разблокировать кнопку
    }
  }

  function renderTalkUI(section) {
    // Контейнер для правой части (индикатор + end)
    const toolbar = document.createElement('div');
    toolbar.className = 'search-toolbar';
    toolbar.style.display = 'flex';
    toolbar.style.gap = '8px';
    toolbar.style.alignItems = 'center';
    toolbar.style.justifyContent = 'flex-end';
    toolbar.style.margin = '8px 0';

    // Индикатор «Разговор…»
    state.talkBadge = document.createElement('span');
    state.talkBadge.textContent = 'Разговор…';
    state.talkBadge.setAttribute('aria-live', 'polite');

    // Кнопка «ЗАКОНЧИТЬ» (принудительное завершение)
    state.endBtn = document.createElement('button');
    state.endBtn.type = 'button';
    state.endBtn.textContent = 'ЗАКОНЧИТЬ';
    state.endBtn.className = 'secondary';
    state.endBtn.addEventListener('click', onForceStop);

    toolbar.appendChild(state.talkBadge);
    toolbar.appendChild(state.endBtn);

    // Вставляем под основной кнопкой
    const btnRow = section.querySelector(SELECTORS.searchButton)?.parentElement || section;
    btnRow.insertAdjacentElement('afterend', toolbar);
  }

  async function startRecording() {
    // Проверим поддержку
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Браузер не поддерживает getUserMedia.');
    }

    // Запрашиваем микрофон
    state.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = getSupportedMimeType();

    state.mediaRecorder = new MediaRecorder(state.mediaStream, mime ? { mimeType: mime } : undefined);
    state.chunks = [];

    // Обработчики событий MediaRecorder
    state.mediaRecorder.addEventListener('dataavailable', (e) => {
      if (e.data && e.data.size > 0) {
        state.chunks.push(e.data);
      }
    });

    state.mediaRecorder.addEventListener('stop', () => {
      // Здесь позже можно будет собрать Blob и отправить в Whisper
      cleanupStream();
    });

    state.mediaRecorder.start(1000); // собираем чанки раз в 1s (на будущее, для стриминга)

    // На этом шаге ничего не отправляем и не показываем текст
    console.log('[search-notes] Запись началась.');
  }

  function getSupportedMimeType() {
    const types = [
      'audio/webm;codecs=opus',
      'audio/ogg;codecs=opus',
      'audio/webm',
      'audio/mp4',
    ];
    for (const t of types) {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) {
        return t;
      }
    }
    return '';
  }

  function onForceStop() {
    // Принудительное завершение разговора
    stopRecording();
    stopDialogUI();
  }

  function stopRecording() {
    try {
      if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
        state.mediaRecorder.stop();
      }
    } catch (e) {
      console.warn('[search-notes] Ошибка при остановке mediaRecorder:', e);
    }
  }

  function stopDialogUI() {
    // Удаляем «Разговор…» и «ЗАКОНЧИТЬ»
    if (state.endBtn && state.endBtn.parentElement) state.endBtn.parentElement.remove();
    state.endBtn = null;
    state.talkBadge = null;

    // Разблокируем кнопку поиска
    const btn = document.querySelector(SELECTORS.searchButton);
    if (btn) btn.disabled = false;

    state.isTalking = false;
  }

  function cleanupStream() {
    if (state.mediaStream) {
      state.mediaStream.getTracks().forEach((t) => t.stop());
      state.mediaStream = null;
    }
    console.log('[search-notes] Запись завершена.');
  }

})();