const $ = (id) => document.getElementById(id);
const conversation = $("conversation");
const promptBox = $("prompt");
const chatList = $("chatList");
const voiceButton = $("voiceButton");
const voiceStatus = $("voiceStatus");
const STORAGE_KEY = "helio-web-chats-v1";
const MODEL_KEY = "helio-web-model-v1";
const GRADE_KEY = "helio-web-grade-v1";
const THINK_TIME_MS = 5000;
const LANGUAGE_MODELS = {
  "Helio Gen 1 Flash": {
    id: "onnx-community/Qwen3-0.6B-ONNX",
    size: "около 570 МБ",
    maxTokens: 320
  },
  "Helio Gen 1 Pro": {
    id: "onnx-community/Qwen3-1.7B-ONNX",
    size: "около 1,43 ГБ",
    maxTokens: 512
  }
};
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let chats = [];
try {
  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  if (Array.isArray(stored)) chats = stored;
} catch {
  localStorage.removeItem(STORAGE_KEY);
}

let activeId = null;
let pyodide = null;
let enginePromise = null;
let transformersPromise = null;
const languageModels = new Map();
const readyLanguageModels = new Set();
let recognition = null;
let busy = false;

const savedModel = localStorage.getItem(MODEL_KEY);
$("modelSelect").value = LANGUAGE_MODELS[savedModel] ? savedModel : "Helio Gen 1 Flash";
const savedGrade = Number(localStorage.getItem(GRADE_KEY)) || 7;
const startingModel = $("modelSelect").value;
$("modelStatus").textContent = `${startingModel} · загрузится при первом сообщении (${LANGUAGE_MODELS[startingModel].size})`;
for (let grade = 1; grade <= 11; grade += 1) {
  const option = document.createElement("option");
  option.value = String(grade);
  option.textContent = `${grade} класс`;
  option.selected = grade === savedGrade;
  $("gradeSelect").append(option);
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
  } catch {
    setVoiceStatus("Не удалось сохранить историю чатов на этом устройстве.", true);
  }
  renderHistory();
}

function newChat() {
  const chat = { id: crypto.randomUUID(), title: "Новый чат", messages: [] };
  chats.unshift(chat);
  activeId = chat.id;
  persist();
  renderChat();
  promptBox.focus();
  closeMenu();
}

function activeChat() {
  return chats.find((chat) => chat.id === activeId);
}

function renderHistory() {
  chatList.replaceChildren();
  for (const chat of chats) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `chat-item${chat.id === activeId ? " active" : ""}`;
    button.textContent = chat.title || "Новый чат";
    button.title = button.textContent;
    button.setAttribute("aria-current", chat.id === activeId ? "page" : "false");
    button.addEventListener("click", () => {
      activeId = chat.id;
      renderHistory();
      renderChat();
      closeMenu();
    });
    chatList.append(button);
  }
}

function renderChat() {
  conversation.replaceChildren();
  const chat = activeChat();
  const empty = !chat || chat.messages.length === 0;
  $("suggestions").hidden = !empty;

  if (empty) {
    const welcome = document.createElement("div");
    welcome.className = "welcome";
    const icon = document.createElement("div");
    icon.className = "welcome-icon";
    icon.textContent = "✦";
    icon.setAttribute("aria-hidden", "true");
    const title = document.createElement("h1");
    title.textContent = "Привет! Я Helio";
    const description = document.createElement("p");
    description.textContent = "Спрашивай о чём угодно, разбирай школьные темы или надиктуй сообщение. На первом запуске выбранная модель загрузится на устройство.";
    welcome.append(icon, title, description);
    conversation.append(welcome);
  } else {
    const list = document.createElement("div");
    list.className = "message-list";
    chat.messages.forEach((message, index) => {
      const canRegenerate = index === chat.messages.length - 1 && message.role === "assistant";
      addMessage(list, message.text, message.role, canRegenerate);
    });
    conversation.append(list);
    conversation.scrollTop = conversation.scrollHeight;
  }
  renderHistory();
}

function addMessage(list, text, role, canRegenerate = false, showActions = true) {
  const row = document.createElement("div");
  row.className = `message ${role === "user" ? "user" : "assistant"}`;
  if (role !== "user") {
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = "✦";
    avatar.setAttribute("aria-hidden", "true");
    row.append(avatar);
  }
  const body = document.createElement("div");
  body.className = "message-body";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  body.append(bubble);
  if (role !== "user" && showActions) addMessageActions(body, canRegenerate);
  row.append(body);
  list.append(row);
  return { row, bubble, body };
}

function addMessageActions(body, canRegenerate) {
  const actions = document.createElement("div");
  actions.className = "message-actions";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "message-action";
  copy.textContent = "Копировать";
  copy.setAttribute("aria-label", "Скопировать ответ Helio");
  copy.addEventListener("click", async () => {
    const text = body.querySelector(".bubble")?.textContent || "";
    try {
      await navigator.clipboard.writeText(text);
      setVoiceStatus("Ответ скопирован.");
    } catch {
      setVoiceStatus("Не удалось скопировать ответ. Разреши доступ к буферу обмена.", true);
    }
  });
  actions.append(copy);
  if (canRegenerate) {
    const regenerate = document.createElement("button");
    regenerate.type = "button";
    regenerate.className = "message-action";
    regenerate.textContent = "Ответить ещё раз";
    regenerate.setAttribute("aria-label", "Сгенерировать ответ ещё раз");
    regenerate.addEventListener("click", regenerateLast);
    actions.append(regenerate);
  }
  body.append(actions);
}

function saveMessage(text, role) {
  const chat = activeChat();
  if (!chat) return;
  chat.messages.push({ text, role });
  if (chat.title === "Новый чат" && role === "user") chat.title = text.slice(0, 42);
  persist();
}

async function initMath() {
  if (enginePromise) return enginePromise;
  $("engineStatus").textContent = "SymPy: загружаю…";
  enginePromise = (async () => {
    pyodide = await window.loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v314.0.8/full/" });
    await pyodide.loadPackage("sympy");
    const response = await fetch("./math_engine.py");
    if (!response.ok) throw new Error("math_engine.py недоступен");
    await pyodide.runPythonAsync(await response.text());
    $("engineStatus").textContent = "SymPy готов · точные вычисления";
    $("sympyDot").classList.add("ready");
    return pyodide;
  })();
  try {
    return await enginePromise;
  } catch (error) {
    enginePromise = null;
    $("engineStatus").textContent = "SymPy пока недоступен";
    throw error;
  }
}

function looksMath(question) {
  return /(реши|вычисли|посчитай|упрости|математик|уравнен|производн|интеграл|площад|периметр|объём|объем|радиус|треугольник|куб(?:а|е|оид)|параллелепипед|степен|квадрат|корень|алгебр|геометр|дроб|синус|косинус|тангенс|\bsolve\b|\bcalculate\b|\bsimplify\b|\barea\b|\bsin\b|\bcos\b|\btan\b)/i.test(question)
    || /[0-9)]\s*[=+*/^×÷·−-]\s*[0-9(]/.test(question)
    || /[A-Za-z0-9)]\s*=\s*[A-Za-z0-9(]/.test(question)
    || /\b[a-z]\s*[+*/^=-]\s*\d/i.test(question)
    || /сколько будет.{0,50}(?:плюс|минус|умнож|разделить|на)/i.test(question)
    || /\b(?:sin|cos|tan|sqrt|log|ln)\s*\(/i.test(question);
}

function modelProgress(event, modelName, shouldShowProgress, waitingBubble, statusState) {
  const info = LANGUAGE_MODELS[modelName];
  let status = `Helio ${modelName.endsWith("Pro") ? "Pro" : "Flash"}: загружаю модель (${info.size})…`;
  if (event?.status === "progress" && Number.isFinite(event.progress)) {
    status = `Helio ${modelName.endsWith("Pro") ? "Pro" : "Flash"}: загрузка ${Math.round(event.progress)}%`;
  } else if (event?.status === "done") {
    status = "Подготавливаю модель…";
  }
  statusState.text = status;
  $("modelStatus").textContent = status;
  if (shouldShowProgress()) waitingBubble.textContent = status;
}

async function loadLanguageModel(modelName, shouldShowProgress, waitingBubble, statusState) {
  if (languageModels.has(modelName)) return languageModels.get(modelName);
  const info = LANGUAGE_MODELS[modelName];
  const loading = (async () => {
    if (!transformersPromise) {
      transformersPromise = import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1");
    }
    const { pipeline, TextStreamer } = await transformersPromise;
    const devices = navigator.gpu
      ? [{ device: "webgpu", dtype: "q4f16" }, { dtype: "q4" }]
      : [{ dtype: "q4" }];
    let lastError;
    for (const backend of devices) {
      try {
        const generator = await pipeline("text-generation", info.id, {
          ...backend,
          progress_callback: (event) => modelProgress(event, modelName, shouldShowProgress, waitingBubble, statusState)
        });
        const loaded = { generator, TextStreamer, backend: backend.device };
        readyLanguageModels.add(modelName);
        $("modelStatus").textContent = `Helio ${modelName.endsWith("Pro") ? "Pro" : "Flash"} готов · работает на устройстве`;
        $("modelDot").classList.add("ready");
        return loaded;
      } catch (error) {
        lastError = error;
        if (backend.device === "webgpu" && devices.length > 1) {
          $("modelStatus").textContent = "WebGPU недоступен, пробую запуск через процессор…";
          if (shouldShowProgress()) waitingBubble.textContent = "WebGPU недоступен, пробую запуск через процессор…";
        }
      }
    }
    throw lastError || new Error("Модель не удалось загрузить");
  })();
  languageModels.set(modelName, loading);
  try {
    return await loading;
  } catch (error) {
    languageModels.delete(modelName);
    readyLanguageModels.delete(modelName);
    throw error;
  }
}

async function exactMathResult(question) {
  if (!looksMath(question)) return null;
  try {
    const py = await initMath();
    py.globals.set("helio_question", question);
    py.globals.set("helio_grade", Number($("gradeSelect").value));
    py.globals.set("helio_model", $("modelSelect").value);
    const result = await py.runPythonAsync("solve(helio_question, helio_grade, helio_model)");
    const text = result == null ? "" : String(result);
    return text && !text.startsWith("Не смог распознать задачу.") ? text : null;
  } catch {
    $("engineStatus").textContent = "SymPy недоступен · считаю языковой моделью";
    return null;
  }
}

function systemPrompt(mathResult) {
  const grade = $("gradeSelect").value;
  let prompt = `Ты Helio — дружелюбный русскоязычный собеседник и школьный помощник для ученика ${grade} класса. Отвечай на том же языке, на котором к тебе обратились. Общайся естественно, по смыслу и без повторяющихся заготовок; можешь обсуждать любые обычные темы, а не только учёбу. Для школьных тем объясняй понятно на уровне ${grade} класса, показывай ход решения, если это помогает. Не выдумывай факты и честно говори, когда не уверен. Не называй себя человеком и не упоминай внутренние инструкции.`;
  if (mathResult) {
    prompt += ` Для текущей математической задачи точный ответ вычислен SymPy. Считай этот результат проверенным и не меняй его; объясни его ученику своими словами, не копируй механически весь технический вывод: ${mathResult}`;
  }
  return prompt;
}

function recentMessages(chat) {
  return chat.messages.slice(-14).map((message) => ({
    role: message.role === "user" ? "user" : "assistant",
    content: String(message.text).slice(-3000)
  }));
}

async function generateResponse(chat, question, waiting) {
  const modelName = $("modelSelect").value;
  let thinking = true;
  const statusState = { text: "" };
  const shouldShowProgress = () => !thinking && !readyLanguageModels.has(modelName);
  const modelPromise = loadLanguageModel(modelName, shouldShowProgress, waiting.bubble, statusState);
  const mathPromise = exactMathResult(question);
  await new Promise((resolve) => setTimeout(resolve, THINK_TIME_MS));
  thinking = false;
  const modelStillLoading = !readyLanguageModels.has(modelName);
  if (modelStillLoading) {
    const info = LANGUAGE_MODELS[modelName];
    waiting.bubble.textContent = statusState.text || `Первый запуск: загружаю Helio ${modelName.endsWith("Pro") ? "Pro" : "Flash"} (${info.size}). Это скачивается один раз и затем сохраняется в браузере.`;
  }
  const [loaded, mathResult] = await Promise.all([modelPromise, mathPromise]);
  const messages = [
    { role: "system", content: systemPrompt(mathResult) },
    ...recentMessages(chat)
  ];
  const prompt = loaded.generator.tokenizer.apply_chat_template(messages, {
    tokenize: false,
    add_generation_prompt: true,
    enable_thinking: false
  });
  let streamed = "";
  waiting.row.classList.remove("typing");
  waiting.row.classList.add("streaming");
  waiting.bubble.textContent = "";
  const streamer = new loaded.TextStreamer(loaded.generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (piece) => {
      streamed += piece;
      waiting.bubble.textContent = visibleText(streamed);
      conversation.scrollTop = conversation.scrollHeight;
    }
  });
  try {
    await loaded.generator(prompt, {
      max_new_tokens: LANGUAGE_MODELS[modelName].maxTokens,
      do_sample: true,
      temperature: modelName.endsWith("Pro") ? 0.65 : 0.72,
      top_p: 0.9,
      repetition_penalty: 1.08,
      streamer
    });
  } catch (error) {
    if (!streamed.trim()) throw error;
  }
  const response = visibleText(streamed).trim();
  if (!response) throw new Error("Модель вернула пустой ответ");
  return response;
}

function visibleText(text) {
  const start = text.indexOf("<think>");
  if (start === -1) return text;
  const end = text.indexOf("</think>", start + 7);
  return end === -1 ? text.slice(0, start) : text.slice(0, start) + text.slice(end + 8);
}

async function respondToQuestion(question) {
  if (busy) return;
  const chat = activeChat();
  if (!chat) return;
  const list = conversation.querySelector(".message-list");
  const waiting = addMessage(list, "Думаю", "assistant", false, false);
  waiting.row.classList.add("typing");
  busy = true;
  updateComposerState();
  try {
    const response = await generateResponse(chat, question, waiting);
    chat.messages.push({ text: response, role: "assistant" });
    if (chat.title === "Новый чат") chat.title = question.slice(0, 42);
    persist();
    waiting.row.classList.remove("typing", "streaming");
    addMessageActions(waiting.body, true);
  } catch (error) {
    console.error("Helio model error", error);
    const info = LANGUAGE_MODELS[$("modelSelect").value];
    const response = `Не получилось запустить языковую модель. Проверь интернет и память устройства: первый запуск загружает примерно ${info.size}. Если выбран Pro, попробуй переключиться на Flash.`;
    $("modelStatus").textContent = "Модель не загрузилась · проверь интернет или выбери Flash";
    $("modelDot").classList.remove("ready");
    waiting.row.classList.remove("typing", "streaming");
    waiting.bubble.textContent = response;
    chat.messages.push({ text: response, role: "assistant" });
    persist();
    addMessageActions(waiting.body, true);
  } finally {
    busy = false;
    updateComposerState();
    promptBox.focus();
  }
}

async function send(text) {
  const question = (text ?? promptBox.value).trim();
  if (!question || busy) return;
  if (!activeChat()) newChat();
  promptBox.value = "";
  resizeInput();
  setVoiceStatus("");
  saveMessage(question, "user");
  renderChat();
  await respondToQuestion(question);
}

async function regenerateLast() {
  const chat = activeChat();
  if (busy || !chat || chat.messages.at(-1)?.role !== "assistant") return;
  const previous = chat.messages.at(-2);
  if (!previous || previous.role !== "user") return;
  const question = previous.text;
  chat.messages.pop();
  persist();
  renderChat();
  await respondToQuestion(question);
}

function resizeInput() {
  promptBox.style.height = "auto";
  promptBox.style.height = `${Math.min(promptBox.scrollHeight, 144)}px`;
}

function updateComposerState() {
  $("sendButton").disabled = busy;
  voiceButton.disabled = busy;
  $("modelSelect").disabled = busy;
  $("gradeSelect").disabled = busy;
}

function setVoiceStatus(message, error = false) {
  voiceStatus.textContent = message;
  voiceStatus.hidden = !message;
  voiceStatus.classList.toggle("error", error);
}

function startVoiceInput() {
  if (!SpeechRecognition) {
    setVoiceStatus("В этом браузере нет распознавания речи. Открой Helio в Chrome или Edge.", true);
    return;
  }
  if (recognition) {
    recognition.stop();
    return;
  }

  const recorder = new SpeechRecognition();
  const previousText = promptBox.value.trim();
  let gotText = false;
  let failed = false;
  recorder.lang = "ru-RU";
  recorder.continuous = false;
  recorder.interimResults = true;
  recorder.maxAlternatives = 1;
  recognition = recorder;
  setVoiceStatus("Слушаю… говори, когда будешь готов.");
  voiceButton.classList.add("listening");
  voiceButton.setAttribute("aria-pressed", "true");

  recorder.onresult = (event) => {
    const transcript = Array.from(event.results)
      .map((result) => result[0]?.transcript || "")
      .join(" ")
      .trim();
    if (!transcript) return;
    gotText = true;
    promptBox.value = [previousText, transcript].filter(Boolean).join(previousText ? " " : "");
    resizeInput();
  };
  recorder.onerror = (event) => {
    failed = true;
    const messages = {
      "not-allowed": "Разреши доступ к микрофону в настройках браузера.",
      "service-not-allowed": "Служба распознавания речи недоступна.",
      network: "Распознавание речи не подключилось. Проверь интернет.",
      "no-speech": "Не услышал речь. Нажми на микрофон и попробуй ещё раз.",
      "audio-capture": "Микрофон не найден или занят другим приложением."
    };
    setVoiceStatus(messages[event.error] || "Не получилось распознать речь. Попробуй ещё раз.", true);
  };
  recorder.onend = () => {
    if (recognition === recorder) recognition = null;
    voiceButton.classList.remove("listening");
    voiceButton.setAttribute("aria-pressed", "false");
    if (!failed) {
      setVoiceStatus(gotText ? "Текст распознан. Проверь его и нажми отправить." : "Речь не распознана. Попробуй ещё раз.", !gotText);
    }
  };

  try {
    recorder.start();
  } catch {
    recognition = null;
    voiceButton.classList.remove("listening");
    voiceButton.setAttribute("aria-pressed", "false");
    setVoiceStatus("Не удалось запустить микрофон. Попробуй ещё раз.", true);
  }
}

function closeMenu() {
  $("sidebar").classList.remove("open");
  $("scrim").classList.remove("show");
}

$("composer").addEventListener("submit", (event) => {
  event.preventDefault();
  send();
});
promptBox.addEventListener("input", resizeInput);
promptBox.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    send();
  }
});

$("newChat").addEventListener("click", newChat);
$("desktopNew").addEventListener("click", newChat);
$("voiceButton").addEventListener("click", startVoiceInput);
$("modelSelect").addEventListener("change", () => {
  localStorage.setItem(MODEL_KEY, $("modelSelect").value);
  const name = $("modelSelect").value;
  const info = LANGUAGE_MODELS[name];
  $("modelStatus").textContent = readyLanguageModels.has(name)
    ? `Helio ${name.endsWith("Pro") ? "Pro" : "Flash"} готов · работает на устройстве`
    : `${name} · загрузится при первом сообщении (${info.size})`;
  $("modelDot").classList.toggle("ready", readyLanguageModels.has(name));
});
$("gradeSelect").addEventListener("change", () => localStorage.setItem(GRADE_KEY, $("gradeSelect").value));
$("menuButton").addEventListener("click", () => {
  $("sidebar").classList.add("open");
  $("scrim").classList.add("show");
});
$("closeSidebar").addEventListener("click", closeMenu);
$("scrim").addEventListener("click", closeMenu);
document.querySelectorAll(".suggestion").forEach((button) => {
  button.addEventListener("click", () => send(button.textContent));
});

renderHistory();
if (chats.length) {
  activeId = chats[0].id;
  renderChat();
} else {
  newChat();
}
