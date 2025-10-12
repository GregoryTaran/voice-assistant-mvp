/* search-notes.js (Step 2)
 * Управление микрофоном + отправка аудио в whisper-search.js
 * После завершения записи отправляем аудио на сервер и получаем текст.
 */

(function () {
  'use strict';

  const SELECTORS = {
    searchSection: '.search-notes',
    searchButton: '#searchNotesBtn',
  };

  const state = {
    mediaStream: null,
    mediaRecorder: null,
    chunks: [],
    isTalking: false,
    endBtn: null,
    talkBadge: null,
    resultsContainer: null,
  };

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    const btn = document.querySelector(SELECTORS.searchButton);
    const section = document.querySelector(SELECTORS.searchSection);
    if (!btn || !section) return;

    state.resultsContainer = section.querySelector('.search-results') || document.createElement('div');
    state.resultsContainer.className = 'search-results';
    section.appendChild(state.resultsContainer);

    btn.addEventListener('click', onStartDialog);
  }

  async function onStartDialog() {
    if (state.isTalking) return;
    const btn = document.querySelector(SELECTORS.searchButton);
    const section = document.querySelector(SELECTORS.searchSection);
    btn.disabled = true;

    renderTalkUI(section);

    try {
      await startRecording();
      state.isTalking = true;
    } catch (err) {
      console.error('[search-notes] Ошибка запуска записи:', err);
      stopDialogUI();
    }
  }

  function renderTalkUI(section) {
    const toolbar = document.createElement('div');
    toolbar.className = 'search-toolbar';
    toolbar.style.display = 'flex';
    toolbar.style.gap = '8px';
    toolbar.style.alignItems = 'center';
    toolbar.style.justifyContent = 'flex-end';
    toolbar.style.margin = '8px 0';

    state.talkBadge = document.createElement('span');
    state.talkBadge.textContent = 'Разговор…';

    state.endBtn = document.createElement('button');
    state.endBtn.type = 'button';
    state.endBtn.textContent = 'ЗАКОНЧИТЬ';
    state.endBtn.className = 'secondary';
    state.endBtn.addEventListener('click', onForceStop);

    toolbar.appendChild(state.talkBadge);
    toolbar.appendChild(state.endBtn);
    const btnRow = section.querySelector(SELECTORS.searchButton)?.parentElement || section;
    btnRow.insertAdjacentElement('afterend', toolbar);
  }

  async function startRecording() {
    if (!navigator.mediaDevices) throw new Error('Нет доступа к микрофону');
    state.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = getSupportedMimeType();
    state.mediaRecorder = new MediaRecorder(state.mediaStream, mime ? { mimeType: mime } : undefined);
    state.chunks = [];

    state.mediaRecorder.addEventListener('dataavailable', (e) => {
      if (e.data && e.data.size > 0) state.chunks.push(e.data);
    });

    state.mediaRecorder.addEventListener('stop', async () => {
      console.log('[search-notes] Запись завершена.');
      const blob = new Blob(state.chunks, { type: 'audio/webm' });
      await sendAudioToWhisper(blob);
      cleanupStream();
    });

    state.mediaRecorder.start(1000);
    console.log('[search-notes] Запись началась.');
  }

  function getSupportedMimeType() {
    const types = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'];
    for (const t of types) if (MediaRecorder.isTypeSupported(t)) return t;
    return '';
  }

  function onForceStop() {
    stopRecording();
    stopDialogUI();
  }

  function stopRecording() {
    try {
      if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
        state.mediaRecorder.stop();
      }
    } catch (e) {
      console.warn('[search-notes] Ошибка при остановке записи:', e);
    }
  }

  function stopDialogUI() {
    if (state.endBtn && state.endBtn.parentElement) state.endBtn.parentElement.remove();
    state.endBtn = null;
    state.talkBadge = null;
    const btn = document.querySelector(SELECTORS.searchButton);
    if (btn) btn.disabled = false;
    state.isTalking = false;
  }

  function cleanupStream() {
    if (state.mediaStream) {
      state.mediaStream.getTracks().forEach((t) => t.stop());
      state.mediaStream = null;
    }
  }

  async function sendAudioToWhisper(blob) {
    try {
      const formData = new FormData();
      formData.append('file', blob, 'audio.webm');

      const response = await fetch('/.netlify/functions/whisper-search', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Whisper API error');
      const data = await response.json();
      console.log('[Whisper результат]:', data.text);

      // Показать в интерфейсе (для теста)
      if (state.resultsContainer) {
        state.resultsContainer.innerHTML = `<div class="note-item"><strong>Распознано:</strong> ${data.text}</div>`;
      }

    } catch (err) {
      console.error('Ошибка отправки аудио в Whisper:', err);
    }
  }

})();
