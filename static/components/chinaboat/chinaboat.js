/* global Cesium */
const viewer = window.CESIUM_VIEWER;
import { loadCSS, loadHTML, makePanelDraggable } from "../../utils.js";

// 載入 CSS
loadCSS('components/chinaboat/chinaboat.css');

// 載入 HTML
loadHTML(`
  <div id="chinaboatControlPanel">
    <div class="panel-header">
      <h3>中國籍船舶查詢</h3>
      <button id="togglechinaboatPanelBtn">+</button>
    </div>
    <div id="chinaboatControlContent">
      <h3>船舶查詢</h3>
      <label>船名: <input type="text" id="shipname" style="width: 162px;"></label><br><br>

      <button id="setQueryAreaBtn">設定查詢範圍</button>
      <button id="clearQueryAreaBtn">清除框選</button><br><br>

      <label>最小緯度: <input class="degInput" type="number" id="minLat" step="0.1" value="23"></label><br>
      <label>最大緯度: <input class="degInput" type="number" id="maxLat" step="0.1" value="30"></label><br>
      <label>最小經度: <input class="degInput" type="number" id="minLon" step="0.1" value="110"></label><br>
      <label>最大經度: <input class="degInput" type="number" id="maxLon" step="0.1" value="125"></label><br><br>

      <label>開始時間: <br><input type="datetime-local" id="start" style="width: 205px;"></label><br>
      <label>結束時間: <br><input type="datetime-local" id="end" style="width: 205px;"></label><br><br>

      <div class="button-row">
        <button id="loadchinaboatBtn">查詢</button>
        <button id="loadChinaLatestBtn">載入最新中國船</button>
      </div>
    </div>
  </div>
`);

// 讓面板可拖曳
makePanelDraggable('chinaboatControlPanel', '.panel-header');

// DOM
const chinaboatControlContent = document.getElementById('chinaboatControlContent');
const togglechinaboatPanelBtn = document.getElementById('togglechinaboatPanelBtn');
const loadchinaboatBtn = document.getElementById('loadchinaboatBtn');
const loadChinaLatestBtn = document.getElementById('loadChinaLatestBtn');
const setQueryAreaBtn = document.getElementById('setQueryAreaBtn');
const clearQueryAreaBtn = document.getElementById('clearQueryAreaBtn');

// 初始收合
let isCollapsed = true;
chinaboatControlContent.style.display = 'none';

togglechinaboatPanelBtn.addEventListener('click', () => {
  isCollapsed = !isCollapsed;
  chinaboatControlContent.style.display = isCollapsed ? 'none' : 'block';
  togglechinaboatPanelBtn.textContent = isCollapsed ? '+' : '-';
});

// ======== 顏色（同 AIS）========
function colorByShiptype(t) {
  switch (String(t)) {
    case '2': return Cesium.Color.BLUE.withAlpha(0.7);
    case '3':
    case '7':
    case '8': return Cesium.Color.GRAY.withAlpha(0.7);
    case '6': return Cesium.Color.YELLOW.withAlpha(0.7);
    case '1':
    case '9': return Cesium.Color.PINK.withAlpha(0.7);
    default:  return Cesium.Color.CYAN.withAlpha(0.7);
  }
}

// ======== 箭頭樣式生成 ========
function getArrowPolyline(lon, lat, heading, length, color) {
  const headingRad = Cesium.Math.toRadians(90 - heading);
  const baseLength = (1 / 7) * length;

  const baseLon = lon - (baseLength * Math.cos(headingRad)) / (111320 * Math.cos(Cesium.Math.toRadians(lat)));
  const baseLat = lat - (baseLength * Math.sin(headingRad)) / 110540;

  const angle = 165;
  const leftLon = lon + (length * 0.2 * Math.cos(headingRad + Cesium.Math.toRadians(angle))) / (111320 * Math.cos(Cesium.Math.toRadians(lat)));
  const leftLat = lat + (length * 0.2 * Math.sin(headingRad + Cesium.Math.toRadians(angle))) / 110540;

  const rightLon = lon + (length * 0.2 * Math.cos(headingRad - Cesium.Math.toRadians(angle))) / (111320 * Math.cos(Cesium.Math.toRadians(lat)));
  const rightLat = lat + (length * 0.2 * Math.sin(headingRad - Cesium.Math.toRadians(angle))) / 110540;

  return {
    positions: Cesium.Cartesian3.fromDegreesArray([
      lon, lat,
      leftLon, leftLat,
      baseLon, baseLat,
      rightLon, rightLat,
      lon, lat,
    ]),
    width: 3,
    material: color,
    clampToGround: true
  };
}

// ======== Entity 群組 ========
let chinaboatEntities = [];
let chinaboatLatestEntities = [];

// ======== 移除工具 ========
function removeEntities(arr) {
  arr.forEach(e => viewer.entities.remove(e));
  arr.length = 0;
}

// ======== addShipEntity（已改）========
function addShipEntity(ship, asLatest = false) {
  if (!ship || isNaN(ship.lat) || isNaN(ship.lon)) return;

  const course = parseFloat(ship.course);
  const hasCourse = !isNaN(course);
  const speed = parseFloat(ship.speed) || 0;

  const baseLength = Math.min(30 + speed * 200, 3000); // ✅ 最大長度限制
  const color = colorByShiptype(ship.shiptype);
  const position = Cesium.Cartesian3.fromDegrees(ship.lon, ship.lat);

  const entity = viewer.entities.add({
    position,
    properties: {
      lon: ship.lon,
      lat: ship.lat,
      course: hasCourse ? course : null,
      baseLength
    },
    ...(hasCourse
      ? { polyline: getArrowPolyline(ship.lon, ship.lat, course, baseLength, color) }
      : {
          point: {
            pixelSize: 10,
            color,
            outlineColor: Cesium.Color.BLACK.withAlpha(0.5),
            outlineWidth: 1
          }
        })
  });

  (asLatest ? chinaboatLatestEntities : chinaboatEntities).push(entity);
}

// ======== 鏡頭縮放 → 更新箭頭大小 ========
viewer.camera.changed.addEventListener(() => {
  const height = viewer.scene.camera.positionCartographic.height;

  let scale = 1;
  if (height > 8_000_000) scale = 1.8;      // ✅ 遠距離也放大
  else if (height > 3_000_000) scale = 2.0;
  else if (height > 1_000_000) scale = 3.0;
  else if (height > 300_000) scale = 4.0;
  else scale = 5.0;                         // ✅ 近距離最大

  const all = [...chinaboatEntities, ...chinaboatLatestEntities];

  all.forEach(entity => {
    if (!entity.polyline || !entity.properties) return;
    const base = entity.properties.baseLength.getValue();
    const lon = entity.properties.lon.getValue();
    const lat = entity.properties.lat.getValue();
    const course = entity.properties.course.getValue();
    const color = entity.polyline.material;
    const newArrow = getArrowPolyline(lon, lat, course, base * scale, color);
    entity.polyline.positions = newArrow.positions;
  });
});


// ======== 歷史查詢 ========
loadchinaboatBtn.addEventListener('click', async () => {
  try {
    const shipname = document.getElementById('shipname').value;
    const startTime = document.getElementById('start').value;
    const endTime = document.getElementById('end').value;
    const minLat = document.getElementById('minLat').value;
    const maxLat = document.getElementById('maxLat').value;
    const minLon = document.getElementById('minLon').value;
    const maxLon = document.getElementById('maxLon').value;

    const p = new URLSearchParams();
    if (shipname) p.set('shipname', shipname);
    if (startTime && endTime) {
      p.set('start', startTime.replace('T', ' ') + '.000');
      p.set('end',   endTime.replace('T', ' ') + '.000');
    }
    if (minLat && maxLat) { p.set('min_lat', minLat); p.set('max_lat', maxLat); }
    if (minLon && maxLon) { p.set('min_lon', minLon); p.set('max_lon', maxLon); }

    const url = `http://127.0.0.1:5000/api/chinaboat/all?${p.toString()}`;
    console.log(`🚀 查詢 URL: ${url}`);

    const resp = await fetch(url);
    const json = await resp.json();
    const ships = json.data || [];

    removeEntities(chinaboatEntities);
    ships.forEach(s => addShipEntity(s, false));

    if (ships.length === 0) alert("查無結果");
    else viewer.zoomTo(viewer.entities);
  } catch (err) {
    console.error(err);
    alert("查詢時發生錯誤");
  }
});

// ======== 最新（疊加）=======
loadChinaLatestBtn.addEventListener('click', async () => {
  try {
    const url = `http://127.0.0.1:5000/api/chinaboat/latest`;
    const resp = await fetch(url);
    const json = await resp.json();
    const ships = json.data || [];

    ships.forEach(s => addShipEntity(s, true));
  } catch (err) {
    console.error(err);
    alert("載入最新資料時發生錯誤");
  }
});

// ======== 日期預設：過去 24 小時 ========
(function () {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000);
  const pad = n => (n < 10 ? '0' + n : n);
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  document.getElementById("start").value = fmt(yesterday);
  document.getElementById("end").value = fmt(now);
})();

// ======== 匡選工具（新版可正常使用）=======

// 狀態變數
let rectHandler = null;
let rectStart = null;
let rectEntity = null;
let lastMovePos = null;

// 啟用矩形框選
function enableRectangle() {
  disableRectangle(); // 避免重複啟用

  rectHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

  // 第一次點擊：設定起點
  rectHandler.setInputAction((click) => {
    const p = viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
    if (!p) return;

    if (!rectStart) {
      rectStart = p;

      // 動態矩形
      rectEntity = viewer.entities.add({
        rectangle: {
          coordinates: new Cesium.CallbackProperty(() => {
            if (!lastMovePos) return Cesium.Rectangle.fromCartesianArray([rectStart, rectStart]);
            const p2 = viewer.camera.pickEllipsoid(lastMovePos, viewer.scene.globe.ellipsoid) || rectStart;
            return Cesium.Rectangle.fromCartesianArray([rectStart, p2]);
          }, false),
          material: Cesium.Color.YELLOW.withAlpha(0.5),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
        }
      });
    } else {
      // 第二次點擊：完成框選
      finishRectangle();
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // 滑鼠移動時更新矩形
  rectHandler.setInputAction((move) => {
    lastMovePos = move.endPosition;
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
}

// 完成框選 → 自動填數值欄位
function finishRectangle() {
  const p2 = viewer.camera.pickEllipsoid(lastMovePos, viewer.scene.globe.ellipsoid);
  if (!p2) return;

  const c1 = Cesium.Cartographic.fromCartesian(rectStart);
  const c2 = Cesium.Cartographic.fromCartesian(p2);

  document.getElementById('minLat').value = Cesium.Math.toDegrees(Math.min(c1.latitude, c2.latitude)).toFixed(3);
  document.getElementById('maxLat').value = Cesium.Math.toDegrees(Math.max(c1.latitude, c2.latitude)).toFixed(3);
  document.getElementById('minLon').value = Cesium.Math.toDegrees(Math.min(c1.longitude, c2.longitude)).toFixed(3);
  document.getElementById('maxLon').value = Cesium.Math.toDegrees(Math.max(c1.longitude, c2.longitude)).toFixed(3);

  disableRectangle();
}

// 移除矩形 + handler
function disableRectangle() {
  if (rectHandler) rectHandler.destroy();
  rectHandler = null;
  rectStart = null;
  lastMovePos = null;
}

// UI 綁定
setQueryAreaBtn.addEventListener("click", () => {
  enableRectangle();
});

clearQueryAreaBtn.addEventListener("click", () => {
  if (rectEntity) viewer.entities.remove(rectEntity);
  rectEntity = null;
  disableRectangle();
});
