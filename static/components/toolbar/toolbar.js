import { viewer } from "../viewer/viewer.js";
import { loadCSS, loadHTML, copyToClipboard } from "../../utils.js";

// 載入 toolbar.css
loadCSS('components/toolbar/toolbar.css');

loadHTML(`
    <div id="toolbar">
        <button id="mouse-coordinates">滑鼠座標</button>
        <button id="measure-distance">測距</button>
        <button id="measure-angle">量角</button>
        <button id="draw-point">畫點</button>
        <button id="draw-line">畫線</button>
        <button id="draw-polygon">畫面</button>
        <button id="add-text">文字</button>
        <button id="load-geojson">載入GeoJSON</button>
       
        <button id="clear-drawing">清除</button>
    </div>
`);

// 工具列按鈕
const mouseCoordinatesBtn = document.getElementById('mouse-coordinates');
const measureDistanceBtn = document.getElementById('measure-distance');
const measureAngleBtn = document.getElementById('measure-angle');
const drawPointBtn = document.getElementById('draw-point');
const drawLineBtn = document.getElementById('draw-line');
const drawPolygonBtn = document.getElementById('draw-polygon');
const addTextBtn = document.getElementById('add-text');
const loadGeoJsonBtn = document.getElementById('load-geojson');
//const loadCsvBtn = document.getElementById('load-csv');
const clearDrawBtn = document.getElementById('clear-drawing');

// 全域變數
let curMouseCoordinate = ''
let tmpPolyline = undefined
let tmpPoint = undefined
let points = [];
let drawEntities = [];
let clickCount = 0;
let activeMode = "";

const scene = viewer.scene;

const mouseClickHandler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
const mouseMovehandler = new Cesium.ScreenSpaceEventHandler(scene.canvas);

// 監聽滑鼠移動事件，顯示座標
mouseMovehandler.setInputAction((movement) => {
    const cartesian = viewer.camera.pickEllipsoid(movement.endPosition);
    if (cartesian) {
        const cartographic = Cesium.Ellipsoid.WGS84.cartesianToCartographic(cartesian);
        const longitude = Cesium.Math.toDegrees(cartographic.longitude).toFixed(2);
        const latitude = Cesium.Math.toDegrees(cartographic.latitude).toFixed(2);
        curMouseCoordinate = `經度: ${longitude}, 緯度: ${latitude}`;
        mouseCoordinatesBtn.innerText = curMouseCoordinate;

        // 當處於量距模式且已選擇一個點時，繪製動態線段
        if (activeMode === "measureDistance" && clickCount === 1 && points.length > 0) {
            if (tmpPoint) {
                viewer.entities.remove(tmpPoint);
                tmpPoint = undefined;
            }
            tmpPoint = drawPoint(points[0]);
            if (tmpPolyline) {
                viewer.entities.remove(tmpPolyline);
                tmpPolyline = undefined;
            }
            // 繪製一條動態的線段，從第一個點到滑鼠當前位置
            tmpPolyline = drawLine([points[0], cartesian]);
        }

        if (activeMode === "measureAngle" && clickCount > 0) {
            if (tmpPolyline) {
                viewer.entities.remove(tmpPolyline);
                tmpPolyline = undefined;
            }
            tmpPolyline = drawLine([...points, cartesian]);
        }
    }
}, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

// 處理不同模式的按鈕點擊事件
clearDrawBtn.addEventListener("click", function () {
    activeMode = "";
    reset();
    viewer.entities.remove(tmpPolyline);

    drawEntities.forEach((entity) => {
        viewer.entities.remove(entity);
    });
});

mouseCoordinatesBtn.addEventListener("click", function () {
    activeMode = "mouseCoordinates";
    reset();
    copyToClipboard(curMouseCoordinate);
});

measureDistanceBtn.addEventListener("click", function () {
    activeMode = "measureDistance";
    reset();
    tmpPolyline = undefined;  // 點擊測距按鈕時清空暫存的線段
});

measureAngleBtn.addEventListener("click", function () {
    activeMode = "measureAngle";
    reset();
});

drawPointBtn.addEventListener("click", function () {
    activeMode = "drawPoint";
    reset();
});

drawLineBtn.addEventListener("click", function () {
    activeMode = "drawLine";
    reset();
});

drawPolygonBtn.addEventListener("click", function () {
    activeMode = "drawPolygon";
    reset();
});

addTextBtn.addEventListener("click", function () {
    activeMode = "addText";
    reset();
});

loadGeoJsonBtn.addEventListener("click", function () {
    loadGeoJson();
});

/*loadCsvBtn.addEventListener("click", function () {
    loadCSV();
});*/

// 重置功能，清除點與點擊計數
function reset() {
    points = [];
    clickCount = 0;
    mouseClickHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
    mouseClickHandler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK);

    // 根據不同模式處理滑鼠左鍵點擊事件
    mouseClickHandler.setInputAction(function (click) {
        const pickedPosition = viewer.camera.pickEllipsoid(click.position, scene.globe.ellipsoid);

        if (pickedPosition) {
            points.push(pickedPosition);
            clickCount++;

            if (activeMode === "measureDistance") {
                if (clickCount === 1) {
                    if (tmpPoint) {
                        viewer.entities.remove(tmpPoint);
                        tmpPoint = undefined;
                    }
                    tmpPoint = drawPoint(points[0]);
                }
                if (clickCount === 2) {
                    if (tmpPoint) {
                        viewer.entities.remove(tmpPoint);
                        tmpPoint = undefined;
                    }
                    if (tmpPolyline) {
                        viewer.entities.remove(tmpPolyline);
                        tmpPolyline = undefined;
                    }

                    const distance = Cesium.Cartesian3.distance(points[0], points[1]); // 單位: 公尺
                    const distanceNM = distance / 1852; // 換算成海浬

                    const msg = `距離: ${distance.toFixed(2)} 公尺 (${distanceNM.toFixed(2)} 海浬)`;
                    alert(msg);
                    copyToClipboard(msg);

                    reset();
                }

            }

            if (activeMode === "measureAngle") {
                if (clickCount === 2) {
                    if (tmpPolyline) {
                        viewer.entities.remove(tmpPolyline);
                        tmpPolyline = undefined;
                    }
                    tmpPolyline = drawLine(points);
                }
                if (clickCount === 3) {
                    if (tmpPolyline) {
                        viewer.entities.remove(tmpPolyline);
                        tmpPolyline = undefined;
                    }
                    const angle = calculateAngle(points[0], points[1], points[2]);
                    alert(`角度:${angle.toFixed(2)} 度`);
                    copyToClipboard(`角度:${angle.toFixed(2)} 度`);
                    reset();
                }
            }

            if (activeMode === "drawPoint") {
                drawEntities.push(drawPoint(pickedPosition));
                reset();
            }

            if (activeMode === "drawLine") {
                if (clickCount > 1) {
                    if (tmpPolyline) {
                        viewer.entities.remove(tmpPolyline);
                        tmpPolyline = undefined;
                    }
                    tmpPolyline = drawLine(points);
                }
            }

            if (activeMode === "drawPolygon" && clickCount >= 3) {
                if (tmpPolyline) {
                    viewer.entities.remove(tmpPolyline);
                    tmpPolyline = undefined;
                }
                tmpPolyline = drawLine(points);
            }

            if (activeMode === "addText") {
                const inputText = prompt("Enter text to display:");
                if (inputText) {
                    drawEntities.push(addText(pickedPosition, inputText));
                    reset();
                }
            }
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // 根據不同模式處理滑鼠右鍵點擊事件
    mouseClickHandler.setInputAction(function (click) {
        if (activeMode === "drawLine" && clickCount > 1) {
            drawEntities.push(drawLine(points));
        }

        if (activeMode === "drawPolygon" && clickCount >= 3) {
            drawEntities.push(drawPolygon(points));
        }
        reset();
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
}

// 計算三點之間的角度
function calculateAngle(pointA, pointB, pointC) {
    const vectorAB = Cesium.Cartesian3.subtract(pointA, pointB, new Cesium.Cartesian3());
    const vectorCB = Cesium.Cartesian3.subtract(pointC, pointB, new Cesium.Cartesian3());
    const normAB = Cesium.Cartesian3.normalize(vectorAB, new Cesium.Cartesian3());
    const normCB = Cesium.Cartesian3.normalize(vectorCB, new Cesium.Cartesian3());
    const dotProduct = Cesium.Cartesian3.dot(normAB, normCB);
    const angleInRadians = Math.acos(dotProduct);
    return Cesium.Math.toDegrees(angleInRadians);
}

// 畫出紅色的點
function drawPoint(position) {
    return viewer.entities.add({
        position: position,
        point: {
            pixelSize: 10,
            color: Cesium.Color.RED,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        }
    });
}

// 畫出紅色的折線
function drawLine(positions) {
    const entity = viewer.entities.add({
        polyline: {
            positions: positions,
            width: 3,
            material: Cesium.Color.RED,
            clampToGround: true,
        }
    });
    entity.supportsPolylinesOnTerrain = true;

    return entity;
}

// 畫出半透明的紅色多邊形
function drawPolygon(positions) {
    positions.push(positions[0]);

    if (tmpPolyline) {
        viewer.entities.remove(tmpPolyline);
        tmpPolyline = undefined;
    }

    return viewer.entities.add({
        polygon: {
            hierarchy: positions,
            material: Cesium.Color.RED.withAlpha(0.5)
        }
    });
}

// 在指定位置加入白色文字標籤
function addText(position, text) {
    return viewer.entities.add({
        position: position,
        label: {
            text: text,
            font: '24px sans-serif',
            fillColor: Cesium.Color.WHITE,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            outlineWidth: 2,
            outlineColor: Cesium.Color.BLACK,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        }
    });
}

// 載入 GeoJSON 檔案的功能
function loadGeoJson() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.addEventListener('change', function (event) {
        const file = event.target.files[0];
        const reader = new FileReader();

        reader.onload = function (e) {
            const geojsonData = JSON.parse(e.target.result);
            Cesium.GeoJsonDataSource.clampToGround = true;
            viewer.dataSources.add(Cesium.GeoJsonDataSource.load(geojsonData));
        };

        reader.readAsText(file);
    });

    input.click();
}
