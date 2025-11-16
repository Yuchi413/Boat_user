import { viewer } from "../viewer/viewer.js";
import { loadCSS, loadHTML, copyToClipboard, makePanelDraggable } from "../../utils.js";

loadCSS('components/chat/chat.css');

loadHTML(`
  <div id="chatPanel">
    <div class="panel-header">
      <h3>人工智慧</h3>
      <button id="toggleChatPanelBtn">-</button>
    </div>

    <div id="chatContent" class="chat-container">
      <div class="top-bar">
        <select id="api-selector">
          <option value="GPT-4o-mini">GPT-4o mini</option>
        </select>
        <button id="clear-chat">清除對話</button>
      </div>

      <div id="loading-indicator" class="loading" style="display: none;">思考中...</div>

      <div id="chat-window" class="chat-window"></div>

      <div class="input-bar">
        <input type="text" id="user-input" placeholder="在此輸入訊息...">
        <button id="send-button">傳送</button>
      </div>
    </div>
  </div>
`);

makePanelDraggable('chatPanel', '.panel-header');

// 🔹 元件引用
const chatContent = document.getElementById('chatContent');
const toggleChatPanelBtn = document.getElementById('toggleChatPanelBtn');
const chatWindow = document.getElementById('chat-window');
const userInput = document.getElementById('user-input');
const sendButton = document.getElementById('send-button');
const apiSelector = document.getElementById('api-selector');
const clearChatButton = document.getElementById('clear-chat');
const loadingIndicator = document.getElementById('loading-indicator');

let isChatPanelCollapsed = true;
let numGoejson = 0;
let geoJsonDataSource;
chatContent.style.display = 'none';

// 🔹 初始化聊天歷史（從 localStorage 載入）
let chatHistory = JSON.parse(localStorage.getItem("chatHistory") || "[]");
if (chatHistory.length > 0) {
  chatHistory.forEach(msg => appendMessage(msg.content, msg.role === "user" ? "user" : "model"));
}

// 🔹 將訊息顯示到聊天視窗
function appendMessage(content, sender) {
  let match = content.match(/geojson\s+```([^`]+)```/);

  if (match && match[1]) {
    let geojson = JSON.parse(match[1].trim());
    let newContent = content.replace(match[0], '').trim();
    numGoejson++;

    const btnHTML = `
      <button id="drawGeoJaon_${numGoejson}">繪製成果 ${numGoejson}</button>
      <button id="clearChatDraw_${numGoejson}">清除繪製 ${numGoejson}</button>
      <button id="downloadGeoJson_${numGoejson}">下載 JSON ${numGoejson}</button>
      <button id="downloadCSV_${numGoejson}">下載 CSV ${numGoejson}</button>
    `;

    const messageBubble = document.createElement('div');
    messageBubble.classList.add('chat-bubble', sender === 'user' ? 'user-message' : 'model-message');
    messageBubble.innerHTML = `${sender === 'user' ? '你' : '人工智慧'}:<br>${marked.parse(newContent)}<br>${btnHTML}`;
    chatWindow.appendChild(messageBubble);

    // --- 各按鈕事件 ---
    const drawGeoJaonBtn = document.getElementById(`drawGeoJaon_${numGoejson}`);
    const clearChatDrawBtn = document.getElementById(`clearChatDraw_${numGoejson}`);
    const downloadGeoJsonBtn = document.getElementById(`downloadGeoJson_${numGoejson}`);
    const downloadCSVBtn = document.getElementById(`downloadCSV_${numGoejson}`);

    clearChatDrawBtn.addEventListener('click', () => {
      if (geoJsonDataSource) viewer.dataSources.remove(geoJsonDataSource);
    });

    drawGeoJaonBtn.addEventListener('click', () => {
      copyToClipboard(JSON.stringify(geojson));
      if (geoJsonDataSource) viewer.dataSources.remove(geoJsonDataSource);

      geoJsonDataSource = new Cesium.GeoJsonDataSource();
      geoJsonDataSource.load(geojson).then(ds => {
        viewer.dataSources.add(ds);
        ds.entities.values.forEach(ent => {
          ent.billboard = new Cesium.BillboardGraphics({
            image: 'https://img.icons8.com/emoji/48/000000/round-pushpin-emoji.png',
            width: 32, height: 32,
            heightReference: Cesium.HeightReference.CLAMP_TO_TERRAIN,
            disableDepthTestDistance: 1000
          });
          ent.label = new Cesium.LabelGraphics({
            text: ent.properties.name.getValue(),
            font: '20pt sans-serif',
            fillColor: Cesium.Color.GREEN,
            pixelOffset: new Cesium.Cartesian2(0, -32),
            heightReference: Cesium.HeightReference.CLAMP_TO_TERRAIN,
            disableDepthTestDistance: 1000
          });
        });
        viewer.flyTo(ds, { offset: new Cesium.HeadingPitchRange(0.0, Cesium.Math.toRadians(-45.0), 5000000) });
      });
    });

    downloadGeoJsonBtn.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `geojson_${numGoejson}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    downloadCSVBtn.addEventListener('click', () => {
      const csvData = geojsonToCSV(geojson);
      const blob = new Blob([csvData], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `data_${numGoejson}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

  } else {
    const messageBubble = document.createElement('div');
    messageBubble.classList.add('chat-bubble', sender === 'user' ? 'user-message' : 'model-message');
    messageBubble.innerHTML = `${sender === 'user' ? '你' : '人工智慧'}:<br>${marked.parse(content)}`;
    chatWindow.appendChild(messageBubble);
  }

  chatWindow.scrollTop = chatWindow.scrollHeight;
}

// 🔹 GeoJSON → CSV
function geojsonToCSV(geojson) {
  const features = geojson.features;
  if (!features || features.length === 0) return '';
  const headers = 'name,longitude,latitude';
  const rows = features.map(f => {
    const name = f.properties.name || '';
    const [lon, lat] = f.geometry.coordinates;
    return `${name},${lon},${lat}`;
  });
  return `${headers}\n${rows.join('\n')}`;
}

// 🔹 發送訊息
async function sendMessage() {
  const message = userInput.value.trim();
  if (!message) return;

  appendMessage(message, 'user');
  chatHistory.push({ role: "user", content: message });
  localStorage.setItem("chatHistory", JSON.stringify(chatHistory));

  userInput.value = '';
  loadingIndicator.style.display = 'block';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000);

  try {
    const response = await fetch('/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        llm: apiSelector.value,
        prompt: message,
        history: chatHistory
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const data = await response.json();

    if (response.ok) {
      appendMessage(data.response, 'model');
      chatHistory.push({ role: "assistant", content: data.response });
      localStorage.setItem("chatHistory", JSON.stringify(chatHistory));
    } else {
      appendMessage(data.error, 'model');
    }
  } catch (error) {
    appendMessage(error.name === 'AbortError' ? '⚠️ 請求逾時' : '❌ 無法連線至伺服器', 'model');
  } finally {
    loadingIndicator.style.display = 'none';
  }
}

// 🔹 面板開關
toggleChatPanelBtn.addEventListener('click', () => {
  isChatPanelCollapsed = !isChatPanelCollapsed;
  chatContent.style.display = isChatPanelCollapsed ? 'none' : 'block';
  toggleChatPanelBtn.textContent = isChatPanelCollapsed ? '+' : '-';
});

// 🔹 傳送訊息
sendButton.addEventListener('click', sendMessage);
userInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(); });

// 🔹 清除聊天紀錄
clearChatButton.addEventListener('click', () => {
  chatWindow.innerHTML = '';
  numGoejson = 0;
  chatHistory = [];
  localStorage.removeItem("chatHistory");
});
