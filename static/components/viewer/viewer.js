import { loadCSS, loadHTML } from "../../utils.js";

// 載入外部 CSS 文件
loadCSS('components/viewer/viewer.css');

// 載入 HTML 結構
loadHTML(`
      <div id="cesiumContainer"></div>
`);

// 設定 Cesium Ion 的存取權杖
Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJlYmE4MzBmZS0wN2ZkLTQzNmQtYmFlOS1mYzgyM2E1NGViMzkiLCJpZCI6Mjc4NTkxLCJpYXQiOjE3NDAzODAxOTZ9.sVborFjUrI_1lBH4Bi2xnUloj4N-jfNkY6y6enxSsas';

// 初始化 Cesium Viewer 並設定 Viewer 的基本參數
export const viewer = new Cesium.Viewer('cesiumContainer', {
  // terrain: Cesium.Terrain.fromWorldTerrain(),  
  // ✅ 改為使用「平滑球面」而非真實地形
  terrain: Cesium.EllipsoidTerrainProvider(),
  timeline: false,  // 關閉時間軸
  animation: false,  // 關閉動畫
  creditContainer: document.createElement('div'),  // 隱藏 Cesium 版權標誌
  navigationHelpButton: false,  // 關閉導航幫助按鈕
  homeButton: false,  // 關閉首頁按鈕
  sceneModePicker: false,  // 關閉場景模式選擇器
  baseLayerPicker: false,  // 關閉基礎圖層選擇器
  geocoder: false,  // 關閉地理編碼功能
  infoBox: true,  // 開啟資訊框
  selectionIndicator: false,  // 關閉選取指標
  navigationInstructionsInitiallyVisible: false,  // 關閉初始導航指示
});

viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(121, 23.5, 3000000),
    orientation: {
        heading: Cesium.Math.toRadians(0.0),
        pitch: Cesium.Math.toRadians(-90.0),
        roll: 0.0
    },
    duration: 1  // 動畫時間（秒）
});



viewer.scene.globe.depthTestAgainstTerrain = false;

// ✅ 讓 viewer 同時掛到 window，全站統一使用同一個 Viewer
window.CESIUM_VIEWER = viewer;
