const viewer = window.CESIUM_VIEWER;
import { loadCSS, loadHTML, makePanelDraggable } from "../../utils.js";

loadCSS("components/alarm_zones/alarm_zones.css");

loadHTML(`
  <div id="alarmControlPanel">
    <div class="panel-header">
      <h3>警戒區設定</h3>
      <button id="toggleAlarmPanelBtn">-</button>
    </div>
    <div id="alarmContent">
      
      <div class="alarm-section">
        <div class="section-header">
          <span>🆕 新增警戒區</span>
          <div class="btn-row">
            <button id="addAlarmBtn">＋</button>
            <button id="saveAlarmBtn">💾</button>
            <button id="reloadAlarmBtn">🔄</button>
          </div>
        </div>
        <div class="section-body">
          <div class="sub-label">暫存繪製</div>
          <ul id="newAlarmList"></ul>
        </div>
      </div>

      <div class="divider"></div>

      <div class="alarm-section">
        <div class="section-header">
          <span>📂 資料庫</span>
        </div>
        <div class="section-body">
          <div class="sub-label">已儲存警戒區</div>
          <ul id="oldAlarmList"></ul>
        </div>
      </div>

    </div>
  </div>
`);

makePanelDraggable("alarmControlPanel", ".panel-header");

const alarmContent = document.getElementById("alarmContent");
const toggleAlarmPanelBtn = document.getElementById("toggleAlarmPanelBtn");
let alarmCollapsed = true;
alarmContent.style.display = "none";

toggleAlarmPanelBtn.addEventListener("click", () => {
  alarmCollapsed = !alarmCollapsed;
  alarmContent.style.display = alarmCollapsed ? "none" : "block";
  toggleAlarmPanelBtn.textContent = alarmCollapsed ? "+" : "-";
});

// === 全域變數 ===
let alarmZones = [];
let oldAlarms = [];
let newAlarms = [];
let previewPoints = [];
let previewPolygon = null;
let drawHandler = null;

// === 🚀 載入資料庫的警戒區（預設不顯示） ===
window.addEventListener("DOMContentLoaded", loadAlarmZonesFromDB);
document.getElementById("reloadAlarmBtn").addEventListener("click", loadAlarmZonesFromDB);

async function loadAlarmZonesFromDB() {
  // 清除舊圖層與清單
  oldAlarms.forEach((z) => viewer.entities.remove(z.entity));
  document.getElementById("oldAlarmList").innerHTML = "";
  oldAlarms = [];

  try {
    const resp = await fetch("/api/get_alarm_zones");
    const geojson = await resp.json();

    if (geojson.features && geojson.features.length > 0) {
      geojson.features.forEach((f) => {
        if (f.geometry?.type === "Polygon") {
          const coords = f.geometry.coordinates[0];
          const flat = coords.flat();
          const id = "alarm-" + f.properties.id;
          const name = f.properties.name || "未命名警戒區";

          // 🟠 預設不顯示 entity
          const entity = viewer.entities.add({
            id,
            polygon: {
              hierarchy: Cesium.Cartesian3.fromDegreesArray(flat),
              material: Cesium.Color.ORANGE.withAlpha(0.3),
              outline: true,
              outlineColor: Cesium.Color.ORANGE,
            },
            show: false // ⬅️ 預設不顯示
          });

          const zone = { id, name, entity, coords, dbId: f.properties.id, isNew: false };
          alarmZones.push(zone);
          oldAlarms.push(zone);
          addAlarmListItem("oldAlarmList", id, name, f.properties.id, false, false);
        }
      });
    }
  } catch (err) {
    console.error("❌ 載入警戒區失敗:", err);
  }
}

// === 新增警戒區 ===
document.getElementById("addAlarmBtn").addEventListener("click", () => {
  if (drawHandler) drawHandler.destroy();
  clearPreviewEntities();

  let drawing = true;
  let drawPositions = [];
  alert("🟡 左鍵點選多邊形頂點，右鍵完成繪製（3 點以上會即時顯示範圍）");

  drawHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

  drawHandler.setInputAction((click) => {
    const cartesian = viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
    if (!cartesian) return;
    const carto = Cesium.Cartographic.fromCartesian(cartesian);
    const lon = Cesium.Math.toDegrees(carto.longitude);
    const lat = Cesium.Math.toDegrees(carto.latitude);
    drawPositions.push(lon, lat);

    const point = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      point: { pixelSize: 8, color: Cesium.Color.RED, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
    });
    previewPoints.push(point);

    if (drawPositions.length >= 6) {
      const hierarchy = Cesium.Cartesian3.fromDegreesArray(drawPositions);
      if (!previewPolygon) {
        previewPolygon = viewer.entities.add({
          polygon: {
            hierarchy,
            material: Cesium.Color.YELLOW.withAlpha(0.3),
            outline: true,
            outlineColor: Cesium.Color.GOLD,
          },
        });
      } else {
        previewPolygon.polygon.hierarchy = hierarchy;
      }
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  drawHandler.setInputAction(() => {
    if (drawPositions.length < 6) {
      alert("❌ 至少需要三個點才能建立多邊形！");
      clearPreviewEntities();
      drawHandler.destroy();
      drawing = false;
      return;
    }

    drawPositions.push(drawPositions[0], drawPositions[1]);
    clearPreviewEntities();

    const name = prompt("請輸入警戒區名稱：", "新警戒區");
    if (!name) {
      alert("名稱不可為空！");
      drawHandler.destroy();
      drawing = false;
      return;
    }

    if (alarmZones.some((z) => z.name === name)) {
      alert("❌ 警戒區名稱已存在，請使用不同名稱！");
      drawHandler.destroy();
      drawing = false;
      return;
    }

    const id = "alarm-" + Date.now();
    const coords = [];
    for (let i = 0; i < drawPositions.length; i += 2) {
      coords.push([drawPositions[i], drawPositions[i + 1]]);
    }

    const entity = viewer.entities.add({
      id,
      polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArray(drawPositions),
        material: Cesium.Color.LIME.withAlpha(0.3),
        outline: true,
        outlineColor: Cesium.Color.LIME,
      },
    });

    const zone = { id, name, entity, coords, isNew: true };
    alarmZones.push(zone);
    newAlarms.push(zone);
    addAlarmListItem("newAlarmList", id, name, null, true, true);

    drawHandler.destroy();
    drawing = false;
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
});

// === 💾 儲存新警戒區 ===
document.getElementById("saveAlarmBtn").addEventListener("click", async () => {
  if (newAlarms.length === 0) {
    alert("目前沒有新的警戒範圍！");
    return;
  }

  const features = newAlarms.map((zone) => ({
    type: "Feature",
    properties: { name: zone.name },
    geometry: { type: "Polygon", coordinates: [zone.coords] },
  }));

  const geojson = { type: "FeatureCollection", features };

  try {
    const resp = await fetch("/api/save_alarm_zones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geojson),
    });
    if (resp.ok) {
      alert("✅ 新警戒範圍已成功儲存！");
      await loadAlarmZonesFromDB();
      newAlarms.forEach((z) => viewer.entities.remove(z.entity));
      newAlarms = [];
      document.getElementById("newAlarmList").innerHTML = "";
    } else {
      alert("❌ 儲存失敗：" + (await resp.text()));
    }
  } catch (err) {
    console.error("儲存錯誤:", err);
    alert("無法連線到伺服器，請檢查後端是否啟動。");
  }
});

// === 工具 ===
function clearPreviewEntities() {
  previewPoints.forEach((p) => viewer.entities.remove(p));
  previewPoints = [];
  if (previewPolygon) viewer.entities.remove(previewPolygon);
  previewPolygon = null;
}

function addAlarmListItem(listId, id, name, dbId = null, isNew = false, defaultChecked = true) {
  const list = document.getElementById(listId);
  const li = document.createElement("li");
  li.style.marginBottom = "4px";
  li.innerHTML = `
    <input type="checkbox" id="chk-${id}" ${defaultChecked ? "checked" : ""}>
    <label for="chk-${id}">${name}</label>
    <button id="del-${id}" style="margin-left:5px;">🗑️</button>
  `;
  list.appendChild(li);

  // 勾選控制顯示
  document.getElementById(`chk-${id}`).addEventListener("change", (e) => {
    const zone = alarmZones.find((z) => z.id === id);
    if (zone) zone.entity.show = e.target.checked;
  });

  // 刪除
  document.getElementById(`del-${id}`).addEventListener("click", async () => {
    if (!confirm(`確定刪除 ${name}？`)) return;
    viewer.entities.removeById(id);
    alarmZones = alarmZones.filter((z) => z.id !== id);
    li.remove();

    if (!isNew && dbId) {
      try {
        const resp = await fetch(`/api/delete_alarm_zone/${dbId}`, { method: "DELETE" });
        if (!resp.ok) throw new Error(await resp.text());
        console.log(`✅ 已刪除警戒區 ${dbId}`);
      } catch (err) {
        alert("刪除失敗：" + err);
      }
    } else if (isNew) {
      newAlarms = newAlarms.filter((z) => z.id !== id);
    }
  });
}
