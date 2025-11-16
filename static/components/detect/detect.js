import { viewer } from "../viewer/viewer.js";
import { loadCSS, loadHTML, makePanelDraggable } from "../../utils.js";

loadCSS('components/detect/detect.css');

loadHTML(`
    <div id="detectPanel">
        <div class="panel-header">
            <h3>目標辨識</h3>
            <button id="toggleDetectPanelBtn">-</button>
        </div>
        
        <div id="detectContent" class="detect-container">
            <div class="top-bar">
                <button id="clear-detect">清除結果</button>
                <button id="downloadBtn" style="display:none;">下載影像</button>
                <button id="downloadJsonBtn" style="display:none;">下載結果</button>
                <button id="drawResultBtn" style="display:none;">標繪</button>
            </div>
            <div id="analyzing-indicator" class="loading" style="display: none;">分析中...</div>

            <div class="input-bar">
              <input type="file" id="imageInput" accept="image/*">
              <button id="analyzeBtn">分析</button>
            </div>

            <div class="input-bar">
              影像範圍:<input type="text" id="extent-input" placeholder="格式: X_MIN, X_MAX, Y_MIN, Y_MAX" value="120,121,23,24">
            </div>

            <div id="detect-window" class="detect-window">
              <div class="input-bar">
                <img id="resultImage" style="max-width: 330px; max-height: 330px;">
              </div>

              <div class="input-bar" style="display:none;">
                <pre id="bboxData"></pre e>
              </div>

            </div>
        </div>
    </div>

`);

makePanelDraggable('detectPanel', '.panel-header');

// 取得 DOM 元素的參考
const detectContent = document.getElementById('detectContent');
const toggleDetectPanelBtn = document.getElementById('toggleDetectPanelBtn');
const clearDetectButton = document.getElementById('clear-detect');
const loadingIndicator = document.getElementById('analyzing-indicator');
const analyzeBtn = document.getElementById('analyzeBtn');
const imageInput = document.getElementById('imageInput');
const resultImage = document.getElementById('resultImage');
const bboxData = document.getElementById('bboxData');
const extentInput = document.getElementById('extent-input');

// 初始狀態設定
let isDetectPanelCollapsed = true;
detectContent.style.display = 'none';
let detectResultImage;
let addedEntities = []; // 用於追蹤新增的實體

// 點擊分析按鈕事件
analyzeBtn.addEventListener('click', async () => {
  const file = imageInput.files[0];
  if (file) {
    loadingIndicator.style.display = 'block'; // 顯示載入指示器
    resultImage.src = ''; // 重設先前結果
    bboxData.textContent = '';

    const formData = new FormData();
    formData.append('image', file);

    // const response = await fetch('http://127.0.0.1:5000/analyze', {
    const response = await fetch('/analyze', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    bboxData.textContent = JSON.stringify(data.bboxes, null, 2); // 顯示邊界框數據

    detectResultImage = data.image_path; // 顯示處理後的圖像
    resultImage.src = detectResultImage;

    const downloadBtn = document.getElementById('downloadBtn');
    downloadBtn.style.display = 'block'; // 顯示下載按鈕

    downloadBtn.addEventListener('click', function () {
      const newWindow = window.open();
      newWindow.document.write('<img src="' + resultImage.src + '" style="max-width:100%;">');
    });

    const downloadJsonBtn = document.getElementById('downloadJsonBtn');
    downloadJsonBtn.style.display = 'block'; // 顯示 JSON 下載按鈕

    downloadJsonBtn.addEventListener('click', function () {
      const jsonBlob = new Blob([JSON.stringify(data.bboxes, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(jsonBlob);
      link.download = 'data.json';
      link.click();
    });

    const drawResultBtn = document.getElementById('drawResultBtn');
    drawResultBtn.style.display = 'block'; // 顯示繪製結果按鈕

    drawResultBtn.addEventListener('click', function () {
      const imgExt = extentInput.value.trim().replace(' ', '');
      let [x_min, x_max, y_min, y_max] = imgExt.split(',').map(Number);
      const geoExtent = {
        x_min: x_min,
        x_max: x_max,
        y_min: y_min,
        y_max: y_max
      };
      const imgWidth = data.image_size.width;
      const imgHeight = data.image_size.height;

      // 將像素座標轉換為地理座標
      function pixelToGeo(pixelX, pixelY, imgWidth, imgHeight, geoExtent) {
        const { x_min, x_max, y_min, y_max } = geoExtent;
        const lon = x_min + (x_max - x_min) * (pixelX / imgWidth);
        const lat = y_max - (y_max - y_min) * (pixelY / imgHeight);
        return { lon, lat };
      }

      // 在 Cesium 中創建影像範圍的矩形實體
      const extentEntity = viewer.entities.add({
        name: "Image Extent",
        rectangle: {
          coordinates: Cesium.Rectangle.fromDegrees(x_min, y_min, x_max, y_max),
          material: Cesium.Color.BLUE.withAlpha(0.2),
        },
      });
      addedEntities.push(extentEntity);

      // 為每個邊界框繪製矩形
      data.bboxes.forEach(box => {
        const [x_min_pixel, y_min_pixel, x_max_pixel, y_max_pixel] = box.bbox;
        const topLeft = pixelToGeo(x_min_pixel, y_min_pixel, imgWidth, imgHeight, geoExtent);
        const bottomRight = pixelToGeo(x_max_pixel, y_max_pixel, imgWidth, imgHeight, geoExtent);

        const bboxEntity = viewer.entities.add({
          name: box.class_name,
          position: Cesium.Cartesian3.fromDegrees((topLeft.lon + bottomRight.lon) / 2, (topLeft.lat + bottomRight.lat) / 2),
          rectangle: {
            coordinates: Cesium.Rectangle.fromDegrees(topLeft.lon, bottomRight.lat, bottomRight.lon, topLeft.lat),
            material: Cesium.Color.RED.withAlpha(0.3),
          },
          label: {
            text: box.class_name,
            font: '16px sans-serif',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 10000000.0)
          }
        });
        addedEntities.push(bboxEntity);
      });

      viewer.camera.flyTo({
        destination: Cesium.Rectangle.fromDegrees(geoExtent.x_min, geoExtent.y_min, geoExtent.x_max, geoExtent.y_max),
        duration: 2.0
      });

    });

    loadingIndicator.style.display = 'none'; // 隱藏載入指示器

  } else {
    alert('請先上傳圖片。');
  }
});

// 切換面板顯示/隱藏
toggleDetectPanelBtn.addEventListener('click', () => {
  isDetectPanelCollapsed = !isDetectPanelCollapsed;
  detectContent.style.display = isDetectPanelCollapsed ? 'none' : 'block';
  toggleDetectPanelBtn.textContent = isDetectPanelCollapsed ? '+' : '-';
});

// 清除辨識結果
clearDetectButton.addEventListener('click', () => {
  downloadBtn.style.display = 'none';
  downloadJsonBtn.style.display = 'none';
  drawResultBtn.style.display = 'none';
  bboxData.textContent = '';
  resultImage.src = '';
  detectResultImage = '';

  // 移除場景中的實體
  addedEntities.forEach(entity => {
    viewer.entities.remove(entity);
  });

  addedEntities = []; // 清空實體追蹤陣列
});
