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
            <!-- API 選擇和設置的頂部欄 -->
            <div class="top-bar">
                <select id="api-selector">
                <option value="GPT-4o-mini">GPT-4o mini</option>
                </select>
                <button id="clear-chat">清除對話</button>
            </div>

            <!-- 加載指示器 -->
            <div id="loading-indicator" class="loading" style="display: none;">思考中...</div>

            <!-- 聊天窗口 -->
            <div id="chat-window" class="chat-window">
                <!-- 對話消息將插入此處 -->
            </div>

            <!-- 輸入欄 -->
            <div class="input-bar">
                <input type="text" id="user-input" placeholder="在此輸入訊息...">
                <button id="send-button">傳送</button>
            </div>
        </div>
    </div>
`);

makePanelDraggable('chatPanel', '.panel-header');

// 獲取 DOM 元素的引用
const chatContent = document.getElementById('chatContent');
const toggleChatPanelBtn = document.getElementById('toggleChatPanelBtn');
const chatWindow = document.getElementById('chat-window');
const userInput = document.getElementById('user-input');
const sendButton = document.getElementById('send-button');
const apiSelector = document.getElementById('api-selector');
const clearChatButton = document.getElementById('clear-chat');
const loadingIndicator = document.getElementById('loading-indicator');

// 設置初始狀態
let isChatPanelCollapsed = true;
let numGoejson = 0;
let geoJsonDataSource;

chatContent.style.display = 'none';

// 將消息附加到聊天窗口的函數
function appendMessage(content, sender) {
  let match = content.match(/geojson\s+```([^`]+)```/);

  if (match && match[1]) {
    let geojson = JSON.parse(match[1].trim());
    let newContent = content.replace(match[0], '').trim();
    numGoejson = numGoejson + 1

    const btnHTML = `
    <button id="drawGeoJaon_${numGoejson}">繪製成果 ${numGoejson}</button>
    <button id="clearChatDraw_${numGoejson}">清除繪製 ${numGoejson}</button>
    <button id="downloadGeoJson_${numGoejson}">下載 JSON ${numGoejson}</button>
    <button id="downloadCSV_${numGoejson}">下載 CSV ${numGoejson}</button>
    `;

    const messageBubble = document.createElement('div');
    messageBubble.classList.add('chat-bubble');
    messageBubble.classList.add(sender === 'user' ? 'user-message' : 'model-message');
    messageBubble.innerHTML = `${sender === 'user' ? '你' : '人工智慧'}:<br>${marked.parse(newContent)}<br>${btnHTML}`;
    chatWindow.appendChild(messageBubble);

    const drawGeoJaonBtn = document.getElementById(`drawGeoJaon_${numGoejson}`);
    const downloadGeoJsonBtn = document.getElementById(`downloadGeoJson_${numGoejson}`);
    const downloadCSVBtn = document.getElementById(`downloadCSV_${numGoejson}`);
    const clearChatDrawBtn = document.getElementById(`clearChatDraw_${numGoejson}`);

    clearChatDrawBtn.addEventListener('click', () => {
      if (geoJsonDataSource) {
        viewer.dataSources.remove(geoJsonDataSource);
        geoJsonDataSource = undefined
      }
    })

    drawGeoJaonBtn.addEventListener('click', () => {
      copyToClipboard(JSON.stringify(geojson))

      if (geoJsonDataSource) {
        viewer.dataSources.remove(geoJsonDataSource);
      }

      geoJsonDataSource = new Cesium.GeoJsonDataSource();

      geoJsonDataSource.load(geojson).then(function (dataSource) {
        viewer.dataSources.add(dataSource);

        dataSource.entities.values.forEach(function (entity) {
          entity.billboard = new Cesium.BillboardGraphics({
            image: 'https://img.icons8.com/emoji/48/000000/round-pushpin-emoji.png',
            width: 32,
            height: 32,
            heightReference: Cesium.HeightReference.CLAMP_TO_TERRAIN,
            // verticalOrigin : Cesium.VerticalOrigin.BOTTOM,     // 垂直對齊
            disableDepthTestDistance : 1000
          });
          
          entity.label = new Cesium.LabelGraphics({
            text: entity.properties.name.getValue(),
            font: '20pt sans-serif',
            fillColor: Cesium.Color.GREEN,
            pixelOffset: new Cesium.Cartesian2(0, -32),
            heightReference: Cesium.HeightReference.CLAMP_TO_TERRAIN,
            // verticalOrigin : Cesium.VerticalOrigin.BOTTOM,     // 垂直對齊
            disableDepthTestDistance : 1000
          });
        });

        viewer.flyTo(dataSource, {
          offset: new Cesium.HeadingPitchRange(
              0.0, // heading: 水平角度偏移（0.0 表示正前方）
              Cesium.Math.toRadians(-45.0), // pitch: 俯仰角度偏移（-45.0 表示向下傾斜 45 度）
              5000000 // range: 相機與目標點的距離（5000000 公尺）
          )
      });
      
      }).catch(function (error) {
        console.log("geojson:", geojson);
        console.error("Error loading GeoJSON:", error);
      });
    });

    downloadGeoJsonBtn.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `json_${numGoejson}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
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
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

  } else {
    const messageBubble = document.createElement('div');
    messageBubble.classList.add('chat-bubble');
    messageBubble.classList.add(sender === 'user' ? 'user-message' : 'model-message');
    messageBubble.innerHTML = `${sender === 'user' ? '你' : '人工智慧'}:<br>${marked.parse(content)}`;
    chatWindow.appendChild(messageBubble);
  }

  chatWindow.scrollTop = chatWindow.scrollHeight;
}

// 將 GeoJSON 轉換為 CSV 的函數（名稱、經度、緯度）
function geojsonToCSV(geojson) {
  const features = geojson.features;
  if (!features || features.length === 0) return '';

  const headers = 'name,longitude,latitude';
  const rows = features.map(feature => {
    const name = feature.properties.name || '';
    const [longitude, latitude] = feature.geometry.coordinates;
    return `${name},${longitude},${latitude}`;
  });

  return `${headers}\n${rows.join('\n')}`;
}

// 處理發送消息的函數
async function sendMessage() {
  const message = userInput.value.trim();
  if (!message) return;

  appendMessage(message, 'user');
  userInput.value = '';
  loadingIndicator.style.display = 'block';
  const selectedApi = apiSelector.value;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 180000); // 3 minutes timeout

  try {
    let endpoint = '/generate'; // Default endpoint

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ llm: selectedApi, prompt: message }),
      signal: controller.signal // Pass the signal property to fetch
    });

    clearTimeout(timeoutId); // Clear the timeout if the request completes

    const data = await response.json();

    if (response.ok) {
      appendMessage(data.response, 'model');
    } else {
      appendMessage(data.error, 'model');
    }

  } catch (error) {
    if (error.name === 'AbortError') {
      appendMessage('Error: Request timed out', 'model');
    } else {
      appendMessage('Error: Could not connect to the API', 'model');
    }
  } finally {
    loadingIndicator.style.display = 'none';
  }
}

// 切換按鈕的事件監聽器
toggleChatPanelBtn.addEventListener('click', () => {
  isChatPanelCollapsed = !isChatPanelCollapsed;
  if (isChatPanelCollapsed) {
    chatContent.style.display = 'none';
    toggleChatPanelBtn.textContent = '+';
  } else {
    chatContent.style.display = 'block';
    toggleChatPanelBtn.textContent = '-';
  }
});

// 發送按鈕的事件監聽器
sendButton.addEventListener('click', sendMessage);

// Enter 鍵的事件監聽器
userInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    sendMessage();
  }
});

// 清除聊天的事件監聽器
clearChatButton.addEventListener('click', () => {
  chatWindow.innerHTML = '';
  numGoejson = 0;
});
