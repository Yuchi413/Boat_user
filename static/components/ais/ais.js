const viewer = window.CESIUM_VIEWER;                            
import { loadCSS, loadHTML, makePanelDraggable } from "../../utils.js";

// 載入 CSS
loadCSS('components/ais/ais.css');

// 載入 HTML                                            
loadHTML(`
    <div id="aisControlPanel">
        <div class="panel-header">
            <h3>AIS MAP</h3>
            <button id="toggleAisPanelBtn">+</button>
        </div>
        <div id="aisControlContent">
            <h3>船舶查詢</h3>
            <label>船名: <input type="text" id="shipname" style="width: 162px;"></label><br><br>

            <button id="setQueryAreaBtn">設定查詢範圍</button><br>  
            <button id="clearQueryAreaBtn">清除框選</button><br><br>

            <label>最小緯度: <input class="degInput" type="number" id="minLat" step="0.1" value="23"></label><br>
            <label>最大緯度: <input class="degInput" type="number" id="maxLat" step="0.1" value="30"></label><br>
            <label>最小經度: <input class="degInput" type="number" id="minLon" step="0.1" value="110"></label><br>
            <label>最大經度: <input class="degInput" type="number" id="maxLon" step="0.1" value="125"></label><br><br>

            <label>開始時間: <br><input type="datetime-local" id="start" style="width: 205px;"></label><br>
            <label>結束時間: <br><input type="datetime-local" id="end" style="width: 205px;"></label><br>
            <button id="loadAisBtn">查詢</button>
        </div>
    </div>
`);

// 讓面板可拖曳
makePanelDraggable('aisControlPanel', '.panel-header');

// 取得 DOM 元素
const aisControlContent = document.getElementById('aisControlContent');
const toggleAisPanelBtn = document.getElementById('toggleAisPanelBtn');
const loadAisBtn = document.getElementById('loadAisBtn');
const setQueryAreaBtn = document.getElementById('setQueryAreaBtn');
const clearQueryAreaBtn = document.getElementById('clearQueryAreaBtn');

// 初始收合狀態
let isCollapsed = true;
aisControlContent.style.display = 'none';

// 切換面板顯示/收合
toggleAisPanelBtn.addEventListener('click', () => {
    isCollapsed = !isCollapsed;
    aisControlContent.style.display = isCollapsed ? 'none' : 'block';
    toggleAisPanelBtn.textContent = isCollapsed ? '+' : '-';
});

// ======== 基本函式 ========
function getArrowPolyline(longitude, latitude, heading, length, color) {
    const headingRad = Cesium.Math.toRadians(90 - heading);
    const baseLength = (1 / 7) * length;

    const baseLongitude = longitude - (baseLength * Math.cos(headingRad)) / (111320 * Math.cos(Cesium.Math.toRadians(latitude)));
    const baseLatitude = latitude - (baseLength * Math.sin(headingRad)) / 110540;

    const angle = 165;
    const leftWingLongitude = longitude + (length * 0.2 * Math.cos(headingRad + Cesium.Math.toRadians(angle))) / (111320 * Math.cos(Cesium.Math.toRadians(latitude)));
    const leftWingLatitude = latitude + (length * 0.2 * Math.sin(headingRad + Cesium.Math.toRadians(angle))) / 110540;

    const rightWingLongitude = longitude + (length * 0.2 * Math.cos(headingRad - Cesium.Math.toRadians(angle))) / (111320 * Math.cos(Cesium.Math.toRadians(latitude)));
    const rightWingLatitude = latitude + (length * 0.2 * Math.sin(headingRad - Cesium.Math.toRadians(angle))) / 110540;

    return {
        positions: Cesium.Cartesian3.fromDegreesArray([
            longitude, latitude,
            leftWingLongitude, leftWingLatitude,
            baseLongitude, baseLatitude,
            rightWingLongitude, rightWingLatitude,
            longitude, latitude,
        ]),
        width: 3,
        material: color || Cesium.Color.RED,
        clampToGround: true,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 30000000.0),
    };
}


// ======== AIS 查詢功能 ========
loadAisBtn.addEventListener('click', async () => {
    try {
        const shipname = document.getElementById('shipname').value;
        const startTime = document.getElementById('start').value;
        const endTime = document.getElementById('end').value;
        const minLat = document.getElementById('minLat').value;
        const maxLat = document.getElementById('maxLat').value;
        const minLon = document.getElementById('minLon').value;
        const maxLon = document.getElementById('maxLon').value;

        const queryParams = new URLSearchParams();
        if (shipname) queryParams.set('shipname', shipname);
        if (startTime && endTime) {
            queryParams.set('start', startTime.replace('T', ' ') + '.000');
            queryParams.set('end', endTime.replace('T', ' ') + '.000');
        }
        if (minLat && maxLat) {
            queryParams.set('min_lat', minLat);
            queryParams.set('max_lat', maxLat);
        }
        if (minLon && maxLon) {
            queryParams.set('min_lon', minLon);
            queryParams.set('max_lon', maxLon);
        }

        const url = `http://127.0.0.1:5000/api/ais/history?${queryParams.toString()}`;
        console.log(`🚀 查詢 URL: ${url}`);

        const response = await fetch(url);
        const data = await response.json();

        // 🚫 不再清空所有實體，只移除非海警船的實體
        viewer.entities.values
            .filter(e => !ccgEntities.includes(e)) // 保留 CCG 船
            .forEach(e => viewer.entities.remove(e));


        // 若後端有回傳 count/data 結構
        const ships = data.data || data;
        console.log(`✅ 共 ${ships.length} 筆結果`);

        ships.forEach(ship => {
            // === 🧩 防呆：跳過無效資料 ===
            if (
                ship.lat === null || ship.lon === null ||
                isNaN(ship.lat) || isNaN(ship.lon) ||
                ship.lat === undefined || ship.lon === undefined
            ) {
                console.warn(`❌ 無效座標: ${ship.shipname}`, ship);
                return;
            }

            const course = parseFloat(ship.course);
            if (isNaN(course)) {
                console.warn(`⚠️ 無效航向: ${ship.shipname}`, ship.course);
                return;
            }

            // === 顏色依船種 ===
            let color;
            switch (ship.shiptype) {
                case '2': color = Cesium.Color.BLUE.withAlpha(0.7); break;
                case '3':
                case '7':
                case '8': color = Cesium.Color.GRAY.withAlpha(0.7); break;
                case '6': color = Cesium.Color.YELLOW.withAlpha(0.7); break;
                case '1':
                case '9': color = Cesium.Color.PINK.withAlpha(0.7); break;
                default: color = Cesium.Color.CYAN.withAlpha(0.7); break;
            }

            // === 避免 speed 為 null 導致 NaN ===
            const speed = parseFloat(ship.speed) || 0;
            const arrowLength = 10 + speed * 100;

            const position = Cesium.Cartesian3.fromDegrees(ship.lon, ship.lat);

            viewer.entities.add({
                name: ship.shipname,
                position: position,
                polyline: getArrowPolyline(ship.lon, ship.lat, course, arrowLength, color),
                description: `
                    <table>
                        <tr><td>船名:</td><td>${ship.shipname}</td></tr>
                        <tr><td>速度:</td><td>${speed} 節</td></tr>
                        <tr><td>航向:</td><td>${course}°</td></tr>
                        <tr><td>目的地:</td><td>${ship.destination || "未知"}</td></tr>
                        <tr><td>最後更新:</td><td>${new Date(ship.timestamp).toLocaleString()}</td></tr>
                    </table>
                `//,
                // // ✅ 儲存原始資料，用於鏡頭縮放時重繪箭頭
                // properties: {
                //     lon: ship.lon,
                //     lat: ship.lat,
                //     course: ship.course,
                //     baseLength: 10 + speed * 100
                //}
            });
        });

        // 若查無資料，提示使用者
        if (ships.length === 0) {
            alert("查無結果，請調整查詢條件或範圍！");
        }

        viewer.zoomTo(viewer.entities);
    } catch (error) {
        console.error('❌ 載入船舶資料錯誤:', error);
        alert('查詢時發生錯誤，請查看 Console。');
    }
});


// ======== 日期設定 ========
function setToday() {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const pad = n => (n < 10 ? '0' + n : n);
    const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    document.getElementById("start").value = fmt(yesterday);
    document.getElementById("end").value = fmt(now);
}
setToday();

// 建立一個專門存 CCG 船的陣列
let ccgEntities = [];

// 載入海警船資料（12nm 紅色半透明、12–24nm 黃色半透明，旁邊顯示船名）
async function loadCCGShips() {
    try {
        // 清除舊的 CCG 點
        ccgEntities.forEach(e => viewer.entities.remove(e));
        ccgEntities = [];

        // 同時撈取兩個 API（只回傳 24 小時內的資料）
        const [resp12, resp24] = await Promise.all([
            fetch("http://127.0.0.1:5000/api/ccg_check12_data"),
            fetch("http://127.0.0.1:5000/api/ccg_check24_data")
        ]);

        const data12 = await resp12.json();
        const data24 = await resp24.json();

        console.log(`📡 12nm內: ${data12.boats.length} 艘, 12–24nm: ${data24.boats.length} 艘`);

        // 顯示時間差格式
        function formatTimeDiff(timestamp) {
            if (!timestamp) return "未知";
            const now = new Date();
            const t = new Date(timestamp);
            const diff = (now - t) / 1000;
            if (diff < 60) return "剛剛更新";
            if (diff < 3600) return `${Math.floor(diff / 60)} 分前`;
            return `${Math.floor(diff / 3600)} 小時前`;
        }

        // 🔴 12 海浬內（紅色半透明）
        // 🔴 12 海浬內（紅色半透明）
        data12.boats.forEach(ship => {
            if (!ship.lat || !ship.lon) return;

            // 🚫 忽略特定海警船（防呆 + 大小寫 + 空白）
            const name = (ship.shipname || "").trim().toUpperCase();
            if (name === "CHINACOASTGUARD2303" || name === "CHINACOASTGUARD 2303") return;

            const entity = viewer.entities.add({
                name: ship.shipname || "Unknown",
                position: Cesium.Cartesian3.fromDegrees(ship.lon, ship.lat),
                point: {
                    pixelSize: 10,
                    color: Cesium.Color.RED.withAlpha(0.65),
                    outlineColor: Cesium.Color.BLACK.withAlpha(0.5),
                    outlineWidth: 1
                },
                label: {
                    text: ship.shipname || "Unknown",
                    font: "14px sans-serif",
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    pixelOffset: new Cesium.Cartesian2(15, -10), // 文字位置偏移
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 5000000.0)
                },
                description: `
                    <b>${ship.shipname}</b><br>
                    經緯度: ${ship.lat.toFixed(5)}, ${ship.lon.toFixed(5)}<br>
                    狀態: <span style="color:red;font-weight:bold;">12海浬內</span><br>
                    最後更新: ${formatTimeDiff(ship.timestamp)}<br>
                    原始時間: ${ship.timestamp}
                `
            });
            ccgEntities.push(entity);
        });

        // 🟡 12–24 海浬（黃色半透明）
        data24.boats.forEach(ship => {
            if (!ship.lat || !ship.lon) return;

            const name = (ship.shipname || "").trim().toUpperCase();
            if (name === "CHINACOASTGUARD2303" || name === "CHINACOASTGUARD 2303") return;

            const entity = viewer.entities.add({
                name: ship.shipname || "Unknown",
                position: Cesium.Cartesian3.fromDegrees(ship.lon, ship.lat),
                point: {
                    pixelSize: 10,
                    color: Cesium.Color.YELLOW.withAlpha(0.65),
                    outlineColor: Cesium.Color.BLACK.withAlpha(0.5),
                    outlineWidth: 1
                },
                label: {
                    text: ship.shipname || "Unknown",
                    font: "14px sans-serif",
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    pixelOffset: new Cesium.Cartesian2(15, -10),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 5000000.0)
                },
                description: `
                    <b>${ship.shipname}</b><br>
                    經緯度: ${ship.lat.toFixed(5)}, ${ship.lon.toFixed(5)}<br>
                    狀態: <span style="color:orange;font-weight:bold;">12–24海浬</span><br>
                    最後更新: ${formatTimeDiff(ship.timestamp)}<br>
                    原始時間: ${ship.timestamp}
                `
            });
            ccgEntities.push(entity);
        });

        console.log(`✅ 載入完成，共 ${ccgEntities.length} 艘 CCG 船`);
    } catch (error) {
        console.error("❌ 載入 CCG 資料失敗:", error);
    }
}



// ================================
// 顯示所有船隻的最新位置
// ================================
async function loadLatestShips() {
    try {
        const resp = await fetch("http://127.0.0.1:5000/api/ais/latest");
        const data = await resp.json();
        const boats = data.boats || [];

        console.log(`🛰️ 最新船舶資料: ${boats.length} 筆`);

        boats.forEach(ship => {
            if (!ship.lat || !ship.lon) return;

            // 設定顏色依照船種
            let color;
            switch (ship.shiptype) {
                case '2': color = Cesium.Color.BLUE.withAlpha(0.7); break;   // 漁船
                case '3':
                case '7':
                case '8': color = Cesium.Color.GRAY.withAlpha(0.7); break;   // 貨船
                case '6': color = Cesium.Color.YELLOW.withAlpha(0.7); break; // 客船
                case '1':
                case '9': color = Cesium.Color.PINK.withAlpha(0.7); break;   // 遊艇
                default: color = Cesium.Color.CYAN.withAlpha(0.7); break;    // 其他
            }

            // 若為海警船，強制紅色顯示
            if (ship.shipname && ship.shipname.startsWith("CHINACOASTGUARD")) {
                color = Cesium.Color.RED.withAlpha(0.75);
            }

            // 加入地圖顯示
            viewer.entities.add({
                name: ship.shipname || "Unknown",
                position: Cesium.Cartesian3.fromDegrees(ship.lon, ship.lat),
                point: {
                    pixelSize: 8,
                    color: color,
                    outlineColor: Cesium.Color.BLACK.withAlpha(0.5),
                    outlineWidth: 1
                },
                label: {
                    text: ship.shipname || "Unknown",
                    font: "13px sans-serif",
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    pixelOffset: new Cesium.Cartesian2(12, -10),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 3000000.0)
                },
                description: `
                    <b>${ship.shipname || "Unknown"}</b><br>
                    經緯度: ${ship.lat.toFixed(5)}, ${ship.lon.toFixed(5)}<br>
                    速度: ${ship.speed || "未知"} 節<br>
                    航向: ${ship.course || "未知"}°<br>
                    類型: ${ship.shiptype || "未知"}<br>
                    更新時間: ${ship.timestamp || "未知"}
                `
            });
        });

        console.log("✅ 所有最新船舶顯示完成");
    } catch (error) {
        console.error("❌ 載入最新船舶資料失敗:", error);
    }
}

// 一進來載入所有資料
loadLatestShips();   // 所有船隻（最新一筆）
loadCCGShips();      // 海警船（12nm 紅色、12–24nm 黃色）

// 每 10分鐘 自動刷新
// setInterval(() => {
//     viewer.entities.removeAll();  // 先清空舊圖層
//     loadLatestShips();
//     loadCCGShips();
// }, 600000);



// ======== 畫框查詢 ========
let points = [], drawEntities = [], clickCount = 0;
const scene = viewer.scene;
const mouseClickHandler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
let movingHandler, tmpRectangle, tmpPoint;

setQueryAreaBtn.addEventListener('click', () => {
    mouseClickHandler.setInputAction(click => {
        const picked = viewer.camera.pickEllipsoid(click.position, scene.globe.ellipsoid);
        if (!picked) return;

        points.push(picked);
        clickCount++;

        if (clickCount === 1) {
            if (tmpPoint) viewer.entities.remove(tmpPoint);
            if (tmpRectangle) viewer.entities.remove(tmpRectangle);
            tmpPoint = drawPoint(points[0]);

            movingHandler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
            movingHandler.setInputAction(move => {
                const pos = viewer.camera.pickEllipsoid(move.endPosition, scene.globe.ellipsoid);
                if (!pos) return;
                if (tmpRectangle) viewer.entities.remove(tmpRectangle);
                tmpRectangle = drawRectangle(points[0], pos, Cesium.Color.YELLOW.withAlpha(0.4));
            }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        }

        if (clickCount === 2) {
            if (tmpPoint) viewer.entities.remove(tmpPoint);
            if (tmpRectangle) viewer.entities.remove(tmpRectangle);

            const finalRect = drawRectangle(points[0], points[1], Cesium.Color.YELLOW.withAlpha(0.6));
            drawEntities.push(finalRect);

            const c1 = Cesium.Cartographic.fromCartesian(points[0]);
            const c2 = Cesium.Cartographic.fromCartesian(points[1]);
            document.getElementById('minLat').value = Cesium.Math.toDegrees(Math.min(c1.latitude, c2.latitude)).toFixed(3);
            document.getElementById('maxLat').value = Cesium.Math.toDegrees(Math.max(c1.latitude, c2.latitude)).toFixed(3);
            document.getElementById('minLon').value = Cesium.Math.toDegrees(Math.min(c1.longitude, c2.longitude)).toFixed(3);
            document.getElementById('maxLon').value = Cesium.Math.toDegrees(Math.max(c1.longitude, c2.longitude)).toFixed(3);

            mouseClickHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
            if (movingHandler) movingHandler.destroy();
            clickCount = 0;
            points = [];
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
});

// 清除框選
clearQueryAreaBtn.addEventListener('click', () => {
    drawEntities.forEach(e => viewer.entities.remove(e));
    drawEntities = [];
    points = [];
    clickCount = 0;
});

function drawPoint(cartesian) {
    return viewer.entities.add({
        position: cartesian,
        point: {
            pixelSize: 8,
            color: Cesium.Color.RED,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        }
    });
}

function drawRectangle(p1, p2, color) {
    return viewer.entities.add({
        rectangle: {
            coordinates: Cesium.Rectangle.fromCartesianArray([p1, p2]),
            material: color,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        }
    });
}

// // 🎯 讓箭頭大小隨鏡頭縮放自動更新
// viewer.camera.changed.addEventListener(() => {
//     const height = viewer.scene.camera.positionCartographic.height;
//     let scale = 1;

//     if (height > 10_000_000) scale = 50;
//     else if (height > 5_000_000) scale = 30;
//     else if (height > 1_000_000) scale = 15;
//     else if (height > 100_000) scale = 8;
//     else scale = 3;

//     viewer.entities.values.forEach(entity => {
//         if (entity.polyline && entity.polyline.positions && entity.properties?.baseLength) {
//             // 根據儲存的原始長度重新設定箭頭
//             const ship = entity.properties; // 儲存的原始屬性
//             const newArrow = getArrowPolyline(
//                 parseFloat(ship.lon.getValue()),
//                 parseFloat(ship.lat.getValue()),
//                 parseFloat(ship.course.getValue()),
//                 parseFloat(ship.baseLength.getValue()) * scale,
//                 entity.polyline.material
//             );
//             entity.polyline.positions = newArrow.positions;
//         }
//     });
// });


// ======== 海警資訊面板 ========

// 建立右側固定面板
loadHTML(`
  <div id="ccgInfoPanel">
    <div class="panel-header" id="ccgHeader">
      <h3>CCG 中國海警船現況</h3>
      <button id="toggleCcgPanelBtn">+</button>
    </div>
    <div id="ccgInfoContent">
      <div class="ccg-section">
        <h4>🔴 12 海浬內</h4>
        <ul id="ccg12List" class="ccg-list"></ul>
      </div>
      <div class="ccg-section">
        <h4>🟡 12–24 海浬</h4>
        <ul id="ccg24List" class="ccg-list"></ul>
      </div>
    </div>
  </div>
`);


// ✅ 讓面板可拖曳
makePanelDraggable('ccgInfoPanel', '#ccgHeader');

// ======== 收合控制邏輯 ========
const ccgControlContent = document.getElementById('ccgInfoContent');
const toggleCcgPanelBtn = document.getElementById('toggleCcgPanelBtn');
let ccgCollapsed = true;
ccgControlContent.style.display = 'none';

toggleCcgPanelBtn.addEventListener('click', () => {
    ccgCollapsed = !ccgCollapsed;
    ccgControlContent.style.display = ccgCollapsed ? 'none' : 'block';
    toggleCcgPanelBtn.textContent = ccgCollapsed ? '+' : '-';
});


// ✅ 讓面板可拖曳
makePanelDraggable('ccgInfoPanel', '#ccgHeader');

// ======== 抓取海警資料並更新右側面板 ========
async function updateCCGPanel() {
    try {
        const [resp12, resp24] = await Promise.all([
            fetch("http://127.0.0.1:5000/api/ccg_check12_data"),
            fetch("http://127.0.0.1:5000/api/ccg_check24_data")
        ]);

        const data12 = await resp12.json();
        const data24 = await resp24.json();

        const list12 = document.getElementById("ccg12List");
        const list24 = document.getElementById("ccg24List");
        list12.innerHTML = "";
        list24.innerHTML = "";

        function formatTimeDiff(timestamp) {
            if (!timestamp) return "未知";

            const now = new Date();
            const t = new Date(timestamp);
            const diffSec = (now - t) / 1000;

            let diffText;
            if (diffSec < 60) diffText = "剛剛";
            else if (diffSec < 3600) diffText = `${Math.floor(diffSec / 60)} 分前`;
            else if (diffSec < 86400) diffText = `${Math.floor(diffSec / 3600)} 小時前`;
            else diffText = `${Math.floor(diffSec / 86400)} 天前`;

            const localTime = new Date(t.getTime() + 8 * 60 * 60 * 1000);
            const yyyy = localTime.getUTCFullYear();
            const mm = String(localTime.getUTCMonth() + 1).padStart(2, '0');
            const dd = String(localTime.getUTCDate()).padStart(2, '0');
            const hh = String(localTime.getUTCHours()).padStart(2, '0');
            const min = String(localTime.getUTCMinutes()).padStart(2, '0');
            const formatted = `${yyyy}/${mm}/${dd} ${hh}:${min}`;

            return `${diffText}（${formatted}）`;
        }

        // 🚫 要排除的海警船清單
        const hiddenShips = ["CHINACOASTGUARD2303", "CHINACOASTGUARD 2303"];

        // 更新 12nm 內列表
        data12.boats.forEach(ship => {
            const name = (ship.shipname || "").trim().toUpperCase();
            if (hiddenShips.includes(name)) return;  // ← 跳過 2303

            const li = document.createElement("li");
            li.innerHTML = `
                <strong>${ship.shipname || "未知"}</strong><br>
                經緯度: ${ship.lat?.toFixed(3)}, ${ship.lon?.toFixed(3)}<br>
                更新: ${formatTimeDiff(ship.timestamp)}
            `;
            list12.appendChild(li);
        });

        // 更新 12–24nm 列表
        data24.boats.forEach(ship => {
            const name = (ship.shipname || "").trim().toUpperCase();
            if (hiddenShips.includes(name)) return;  // ← 跳過 2303

            const li = document.createElement("li");
            li.innerHTML = `
                <strong>${ship.shipname || "未知"}</strong><br>
                經緯度: ${ship.lat?.toFixed(3)}, ${ship.lon?.toFixed(3)}<br>
                更新: ${formatTimeDiff(ship.timestamp)}
            `;
            list24.appendChild(li);
        });

        console.log(`🛰️ 更新 CCG 面板完成: 12nm=${data12.boats.length}, 24nm=${data24.boats.length}`);
    } catch (err) {
        console.error("❌ 更新 CCG 面板失敗:", err);
    }
}


// 初始化 + 每分鐘自動更新
updateCCGPanel();
setInterval(updateCCGPanel, 60000);
