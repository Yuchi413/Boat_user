import { loadCSS, loadHTML } from "../../utils.js";

// 載入 CSS 檔案
loadCSS('components/banner/banner.css');

// 載入 HTML 標籤
loadHTML(`
<div id="banner">
  <div id="banner-content">
    <img src="components/banner/assets/logo.png" alt="Logo" id="banner-logo">
    <div id="banner-text">
      <h1>智能海域監測與預警系統</h1>
      <div id="timestamp-container">
        <span id="timestamp"></span>
      </div>
    </div>
  </div>
</div>
`);

// 更新時間戳記的函式
function updateTimestamp() {
    const timestampElement = document.getElementById('timestamp');
    const now = new Date();
    timestampElement.textContent = now.toLocaleString();
}

// 每秒更新一次時間戳記
setInterval(updateTimestamp, 1000);
