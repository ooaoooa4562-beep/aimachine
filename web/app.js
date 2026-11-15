const $ = (id) => document.getElementById(id);
const conversation = $("conversation");
const promptBox = $("prompt");
const chatList = $("chatList");
const voiceButton = $("voiceButton");
const voiceStatus = $("voiceStatus");
const STORAGE_KEY = "helio-web-chats-v1";
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
let recognition = null;
let busy = false;

for (let grade = 1; grade <= 11; grade += 1) {
  const option = document.createElement("option");
  option.value = String(grade);
  option.textContent = `${grade} класс`;
  option.selected = grade === 7;
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
    description.textContent = "Напиши задачу или нажми на микрофон, чтобы надиктовать её. Математические вычисления SymPy выполняет прямо в браузере.";
    welcome.append(icon, title, description);
    conversation.append(welcome);
  } else {
    const list = document.createElement("div");
    list.className = "message-list";
    for (const message of chat.messages) addMessage(list, message.text, message.role);
    conversation.append(list);
    conversation.scrollTop = conversation.scrollHeight;
  }
  renderHistory();
}

function addMessage(list, text, role) {
  const row = document.createElement("div");
  row.className = `message ${role === "user" ? "user" : "assistant"}`;
  if (role !== "user") {
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = "✦";
    avatar.setAttribute("aria-hidden", "true");
    row.append(avatar);
  }
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  row.append(bubble);
  list.append(row);
  return row;
}

function saveMessage(text, role) {
  const chat = activeChat();
  if (!chat) return;
  chat.messages.push({ text, role });
  if (chat.title === "Новый чат" && role === "user") chat.title = text.slice(0, 42);
  persist();
}

function smallTalk(text) {
  const question = text.toLowerCase().trim();
  if (/^(привет|здравствуй|здравствуйте|хай|салам|салом|hello|hi)[!,. ]*$/.test(question)) {
    return "Привет! 🙂 Рад тебя видеть. Что сегодня разберём — задачу или просто поболтаем?";
  }
  if (/как дела|как ты|как настроение/.test(question)) return "Всё хорошо, спасибо 🙂 Я готов помочь. А у тебя как дела?";
  if (/спасибо|благодарю|красава|молодец/.test(question)) return "Пожалуйста! 🙂 Если захочешь, разберём ещё одну задачу.";
  if (/^(пока|до свидания|увидимся|bye)[!. ]*$/.test(question)) return "Пока! Удачи тебе 👋 Возвращайся, когда понадобится помощь.";
  if (/кто ты|как тебя зовут|ты кто/.test(question)) return "Я Helio — школьный помощник. Для математики использую SymPy, который работает прямо в браузере.";
  if (/что ты умеешь|что умеешь|помоги|помощь/.test(question)) {
    return "Могу считать выражения, решать уравнения, упрощать выражения, находить производные и интегралы, а ещё помогать с геометрией. Например: 2214÷(12²+15²)+36.";
  }
  return null;
}

async function initMath() {
  if (enginePromise) return enginePromise;
  $("engineStatus").textContent = "Загружаю SymPy…";
  enginePromise = (async () => {
    pyodide = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v314.0.8/full/" });
    await pyodide.loadPackage("sympy");
    const response = await fetch("./math_engine.py");
    if (!response.ok) throw new Error("math_engine.py недоступен");
    await pyodide.runPythonAsync(await response.text());
    $("engineStatus").textContent = "SymPy готов · расчёт в браузере";
    document.querySelector(".status-dot").classList.add("ready");
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
  return /[0-9=+*/^()√π²³×÷·]/.test(question)
    || /(реши|вычисли|посчитай|производн|интеграл|площад|периметр|объём|объем|радиус|треугольник|квадрат|кубоид|параллелепипед|sin|cos|tan)/i.test(question);
}

async function answer(question) {
  const friendly = smallTalk(question);
  if (friendly) return friendly;
  if (!looksMath(question)) {
    return "Я могу поддержать короткий разговор и помочь с математикой. Свободную беседу на любые темы добавим после подключения обученной языковой модели.";
  }
  try {
    const py = await initMath();
    py.globals.set("helio_question", question);
    py.globals.set("helio_grade", Number($("gradeSelect").value));
    py.globals.set("helio_model", $("modelSelect").value);
    const result = await py.runPythonAsync("solve(helio_question, helio_grade, helio_model)");
    return result == null ? "Не понял сообщение. Напиши математический пример или задачу словами." : String(result);
  } catch {
    return "Не смог запустить SymPy. Проверь подключение к интернету и попробуй ещё раз.";
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
  const list = conversation.querySelector(".message-list");
  const waiting = addMessage(list, "Секунду…", "assistant");
  waiting.classList.add("typing");
  busy = true;
  updateComposerState();
  try {
    const result = await answer(question);
    waiting.remove();
    saveMessage(result, "assistant");
    renderChat();
  } finally {
    busy = false;
    updateComposerState();
    promptBox.focus();
  }
}

function resizeInput() {
  promptBox.style.height = "auto";
  promptBox.style.height = `${Math.min(promptBox.scrollHeight, 144)}px`;
}

function updateComposerState() {
  $("sendButton").disabled = busy;
  voiceButton.disabled = busy;
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
