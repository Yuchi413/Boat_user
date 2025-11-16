import { viewer } from "../viewer/viewer.js";
import { loadCSS, loadHTML, makePanelDraggable } from "../../utils.js";

// 加載 layers.css
loadCSS('components/layers/layers.css');

loadHTML(`
    <!-- 圖層清單 -->
    <div id="layerControlPanel">
        <div class="panel-header">
            <h3>圖層清單</h3>
            <button id="toggleLayersPanelBtn">-</button>
        </div>
        <div id="layerControlContent">
            <button id="newLayerBtn">新增圖層</button>
            <button id="downloadSettingsBtn">下載設定</button>
            <input type="file" id="uploadSettingsFile" style="display:none;">
            <button id="uploadSettingsBtn">上傳設定</button>
            <ul id="layerList"></ul>
            
        </div>
    </div>
`);

makePanelDraggable('layerControlPanel', '.panel-header');

// DOM 元素選取
const layerListElement = document.getElementById('layerList');
const newLayerBtn = document.getElementById('newLayerBtn');
const downloadSettingsBtn = document.getElementById('downloadSettingsBtn');
const uploadSettingsBtn = document.getElementById('uploadSettingsBtn');
const uploadSettingsFile = document.getElementById('uploadSettingsFile');
const layerSettingsForm = document.getElementById('layerSettingsForm');
const setupModal = document.getElementById('setupModal');
const cancelSetupBtn = document.getElementById('cancelSetupBtn');
const confirmSetupBtn = document.getElementById('confirmSetupBtn');
const toggleLayersPanelBtn = document.getElementById('toggleLayersPanelBtn');
const layerControlContent = document.getElementById('layerControlContent');

// 設置初始狀態
let isCollapsed = true;
layerControlContent.style.display = 'none';

// 儲存圖層資料
let layers = [];

// 設置 Viewer 的初始視野
function setViewerInitialView(viewExtension) {
    if (Array.isArray(viewExtension) && viewExtension.length === 4) {
        viewer.camera.setView({
            destination: Cesium.Rectangle.fromDegrees(...viewExtension)
        });
    } else {
        console.warn('視野設定無效:', viewExtension);
    }
}

// 加載預設圖層設定（允許 JSON 有註解）
async function loadDefaultLayers() {
    try {
        const response = await fetch('default.json');
        if (!response.ok) throw new Error('網絡回應不正確');

        // 以純文字方式讀入
        let text = await response.text();

        // 🧹 自動移除註解與多餘逗號
        text = text
            .replace(/\/\/.*$/gm, '')         // 移除單行註解 //
            .replace(/\/\*[\s\S]*?\*\//gm, '') // 移除多行註解 /* ... */
            .replace(/,(\s*[}\]])/g, '$1');    // 移除結尾多餘逗號

        // 轉為 JSON
        return JSON.parse(text);

    } catch (error) {
        console.error('無法加載預設圖層:', error);
        return { layers: [], "view extension": [] };
    }
}


// 渲染圖層清單
async function renderLayerList() {
    layerListElement.innerHTML = '';
    viewer.imageryLayers.removeAll();

    // 添加 Bing Maps Aerial 作為基礎圖層
    const layer = viewer.imageryLayers.addImageryProvider(
        await Cesium.IonImageryProvider.fromAssetId(2)
    );

    // 遍歷 layers 陣列，為每個圖層創建清單項目
    layers.forEach((layer, index) => {
        if (layer && typeof layer === 'object') {
            const layerItem = createLayerListItem(layer, index);
            layerListElement.appendChild(layerItem);
            addLayerToViewer(layer);
        } else {
            console.warn('圖層資料無效，索引', index);
        }
    });
}

// 創建圖層清單項目
function createLayerListItem(layer, index) {
    const layerItem = document.createElement('li');
    layerItem.className = 'layer-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !layer.hide;
    checkbox.addEventListener('change', () => {
        handleLayerVisibility(layer, checkbox.checked);
    });

    const title = document.createElement('span');
    title.textContent = layer.title;

    const opacitySlider = document.createElement('input');
    opacitySlider.type = 'range';
    opacitySlider.min = 0;
    opacitySlider.max = 1;
    opacitySlider.step = 0.1;
    opacitySlider.value = layer.opacity || 1;
    opacitySlider.addEventListener('input', () => {
        handleLayerOpacity(layer, opacitySlider.value);
    });

    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'layer-buttons';

    const setupBtn = document.createElement('button');
    setupBtn.textContent = '⚙️';
    setupBtn.addEventListener('click', () => {
        handleLayerSetup(layer, index);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '❌';
    deleteBtn.addEventListener('click', () => {
        handleLayerDelete(index);
    });

    buttonsDiv.appendChild(setupBtn);
    buttonsDiv.appendChild(deleteBtn);

    layerItem.appendChild(checkbox);
    layerItem.appendChild(title);
    layerItem.appendChild(opacitySlider);
    layerItem.appendChild(buttonsDiv);

    return layerItem;
}

// // 添加圖層到 Viewer
// function addLayerToViewer(layer) {
//     let imageryProvider;
//     if (layer.type === 'UrlTemplateImagery') {
//         imageryProvider = new Cesium.UrlTemplateImageryProvider(layer.options);  
//     } else if (layer.type === 'WebMapServiceImagery') {
//         imageryProvider = new Cesium.WebMapServiceImageryProvider({
//             url: layer.options.url,
//             layers: layer.options.layers,
//             parameters: layer.options.parameters
//         });  
//     }

//     if (imageryProvider) {
//         const imageryLayer = viewer.imageryLayers.addImageryProvider(imageryProvider);
//         imageryLayer.alpha = layer.opacity || 1;  
//         imageryLayer.show = !layer.hide;  
//         layer.cesiumLayer = imageryLayer;  
//     }
// }


// 添加圖層到 Viewer
async function addLayerToViewer(layer) {
    let imageryProvider;
    if (layer.type === 'UrlTemplateImagery') {
        imageryProvider = new Cesium.UrlTemplateImageryProvider(layer.options);
    } else if (layer.type === 'WebMapServiceImagery') {
        imageryProvider = new Cesium.WebMapServiceImageryProvider({
            url: layer.options.url,
            layers: layer.options.layers,
            parameters: layer.options.parameters
        });
    } else if (layer.type === 'GeoJson') {  // 新增 GeoJSON 圖層類型
        const resource = await Cesium.IonResource.fromAssetId(layer.assetId); // 從 Ion 資源加載 GeoJSON
        const dataSource = await Cesium.GeoJsonDataSource.load(resource);
        viewer.dataSources.add(dataSource);  // 將圖層加到 viewer
        layer.cesiumLayer = dataSource;  // 儲存圖層對象以便後續操作
    }

    if (imageryProvider) {
        const imageryLayer = viewer.imageryLayers.addImageryProvider(imageryProvider);
        imageryLayer.alpha = layer.opacity || 1;
        imageryLayer.show = !layer.hide;
        layer.cesiumLayer = imageryLayer;
    }
}


// 處理圖層顯示與隱藏
function handleLayerVisibility(layer, visible) {
    layer.hide = !visible;
    if (layer.cesiumLayer) {
        layer.cesiumLayer.show = visible;
    }
}

// 處理圖層透明度
function handleLayerOpacity(layer, opacity) {
    if (layer.cesiumLayer) {
        layer.cesiumLayer.alpha = parseFloat(opacity);
    }
    layer.opacity = parseFloat(opacity);
}


// 從 Viewer 移除圖層
function removeLayerFromViewer(layer, index) {
    if (index !== undefined) {
        const cesiumLayer = viewer.imageryLayers.get(index + 1);
        viewer.imageryLayers.remove(cesiumLayer);
    }
}

// 刪除圖層功能
function handleLayerDelete(index) {
    if (confirm("確定要刪除此圖層嗎？")) {
        const layerToRemove = layers[index];

        if (layerToRemove && layerToRemove.cesiumLayer) {
            layerToRemove.cesiumLayer.show = false;
        }

        setTimeout(() => {
            removeLayerFromViewer(layerToRemove, index);
            layers.splice(index, 1);
            renderLayerList();
        }, 100);
    }
}

// 開啟設定對話框並顯示當前圖層設定
function handleLayerSetup(layer, index) {
    layerSettingsForm.innerHTML = '';

    const nameLabel = document.createElement('label');
    nameLabel.textContent = '圖層名稱: ';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = layer.title;
    nameLabel.appendChild(nameInput);
    layerSettingsForm.appendChild(nameLabel);
    layerSettingsForm.appendChild(document.createElement('br'));

    const opacityLabel = document.createElement('label');
    opacityLabel.textContent = '透明度: ';
    const opacityInput = document.createElement('input');
    opacityInput.type = 'range';
    opacityInput.min = 0;
    opacityInput.max = 1;
    opacityInput.step = 0.1;
    opacityInput.value = layer.opacity;
    opacityLabel.appendChild(opacityInput);
    layerSettingsForm.appendChild(opacityLabel);
    layerSettingsForm.appendChild(document.createElement('br'));

    const typeLabel = document.createElement('label');
    typeLabel.textContent = '圖層類型: ';
    const typeSelect = document.createElement('select');
    ['IonWorldTerrain', 'UrlTemplateImagery', 'WebMapServiceImagery'].forEach(type => {
        const option = document.createElement('option');
        option.value = type;
        option.textContent = type;
        if (layer.type === type) {
            option.selected = true;
        }
        typeSelect.appendChild(option);
    });
    typeLabel.appendChild(typeSelect);
    layerSettingsForm.appendChild(typeLabel);
    layerSettingsForm.appendChild(document.createElement('br'));

    const extraSettingsDiv = document.createElement('div');
    layerSettingsForm.appendChild(extraSettingsDiv);

    function renderExtraSettings() {
        extraSettingsDiv.innerHTML = '';
        if (typeSelect.value === 'UrlTemplateImagery') {
            const urlLabel = document.createElement('label');
            urlLabel.textContent = 'URL 模板: ';
            const urlInput = document.createElement('input');
            urlInput.type = 'text';
            urlInput.value = layer.options?.url || '';
            urlLabel.appendChild(urlInput);
            extraSettingsDiv.appendChild(urlLabel);
            extraSettingsDiv.appendChild(document.createElement('br'));
        } else if (typeSelect.value === 'WebMapServiceImagery') {
            const urlLabel = document.createElement('label');
            urlLabel.textContent = 'WMS URL: ';
            const urlInput = document.createElement('input');
            urlInput.type = 'text';
            urlInput.value = layer.options?.url || '';
            urlLabel.appendChild(urlInput);
            extraSettingsDiv.appendChild(urlLabel);
            extraSettingsDiv.appendChild(document.createElement('br'));

            const layersLabel = document.createElement('label');
            layersLabel.textContent = 'WMS 圖層: ';
            const layersInput = document.createElement('input');
            layersInput.type = 'text';
            layersInput.value = layer.options?.layers || '';
            layersLabel.appendChild(layersInput);
            extraSettingsDiv.appendChild(layersLabel);
            extraSettingsDiv.appendChild(document.createElement('br'));

            const parametersLabel = document.createElement('label');
            parametersLabel.textContent = 'WMS 參數 (transparent, format): ';
            const parametersInput = document.createElement('input');
            parametersInput.type = 'text';
            parametersInput.value = JSON.stringify(layer.options?.parameters || {});
            parametersLabel.appendChild(parametersInput);
            extraSettingsDiv.appendChild(parametersLabel);
            extraSettingsDiv.appendChild(document.createElement('br'));
        }
    }

    typeSelect.addEventListener('change', renderExtraSettings);
    renderExtraSettings();

    setupModal.style.display = 'block';

    cancelSetupBtn.removeEventListener('click', closeModal);
    cancelSetupBtn.addEventListener('click', closeModal);

    function closeModal() {
        setupModal.style.display = 'none';
    }

    confirmSetupBtn.removeEventListener('click', applySettings);
    confirmSetupBtn.addEventListener('click', applySettings);

    function applySettings() {
        layer.title = nameInput.value;
        layer.opacity = opacityInput.value;
        layer.type = typeSelect.value;

        if (layer.type === 'UrlTemplateImagery') {
            layer.options = { url: extraSettingsDiv.querySelector('input').value };
        } else if (layer.type === 'WebMapServiceImagery') {
            layer.options = {
                url: extraSettingsDiv.querySelectorAll('input')[0].value,
                layers: extraSettingsDiv.querySelectorAll('input')[1].value,
                parameters: JSON.parse(extraSettingsDiv.querySelectorAll('input')[2].value),
            };
        }

        viewer.imageryLayers.removeAll();
        renderLayerList();

        closeModal();
    }
}

// 切換按鈕事件監聽
toggleLayersPanelBtn.addEventListener('click', () => {
    isCollapsed = !isCollapsed;
    if (isCollapsed) {
        layerControlContent.style.display = 'none';
        toggleLayersPanelBtn.textContent = '+';
    } else {
        layerControlContent.style.display = 'block';
        toggleLayersPanelBtn.textContent = '-';
    }
});

// 新增圖層
newLayerBtn.addEventListener('click', () => {
    const newLayer = {
        name: `newLayer${layers.length + 1}`,
        title: `New Layer ${layers.length + 1}`,
        hide: false,
        opacity: 1,
        type: 'UrlTemplateImagery',
        options: {
            url: 'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'
        }
    };
    layers.push(newLayer);
    renderLayerList();
});

// 下載設定
downloadSettingsBtn.addEventListener('click', () => {
    const viewerRectangle = viewer.camera.computeViewRectangle();
    const viewExtension = [
        Cesium.Math.toDegrees(viewerRectangle.west),
        Cesium.Math.toDegrees(viewerRectangle.south),
        Cesium.Math.toDegrees(viewerRectangle.east),
        Cesium.Math.toDegrees(viewerRectangle.north)
    ];

    const layersToDownload = layers.map(layer => {
        const { cesiumLayer, ...layerWithoutCesiumLayer } = layer;
        return layerWithoutCesiumLayer;
    });

    const dataToDownload = {
        "view extension": viewExtension,
        "layers": layersToDownload
    };

    const dataStr = JSON.stringify(dataToDownload, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'layer-settings.json';
    a.click();
    URL.revokeObjectURL(url);
});

// 上傳設定
uploadSettingsBtn.addEventListener('click', () => {
    uploadSettingsFile.click();
});

uploadSettingsFile.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function () {
            try {
                const uploadedSettings = JSON.parse(reader.result);

                if (!Array.isArray(uploadedSettings.layers)) {
                    throw new Error('設定檔案格式無效');
                }
                layers = uploadedSettings.layers;

                if (Array.isArray(uploadedSettings["view extension"]) && uploadedSettings["view extension"].length === 4) {
                    const [west, south, east, north] = uploadedSettings["view extension"];
                    viewer.camera.setView({
                        destination: Cesium.Rectangle.fromDegrees(west, south, east, north)
                    });
                }

                viewer.imageryLayers.removeAll();
                renderLayerList();
            } catch (error) {
                console.error('無法解析設定檔案:', error);
                alert('無法載入圖層設定，請檢查檔案格式。');
            }
        };
        reader.readAsText(file);

        uploadSettingsFile.value = '';
    }
});

// 加載圖層清單並設置視野
loadDefaultLayers().then(defaultLayers => {
    layers = defaultLayers.layers || [];
    renderLayerList();
    setViewerInitialView(defaultLayers["view extension"]);
});

async function addGeoJsonLayer(name, ionAssetId) {
    try {
        const resource = await Cesium.IonResource.fromAssetId(ionAssetId);

        // 不貼地（避免被地球吃掉）
        const dataSource = await Cesium.GeoJsonDataSource.load(resource, {
            clampToGround: false
        });

        await viewer.dataSources.add(dataSource);

        // ✅ 根據名稱設定不同顏色
        let lineColor = Cesium.Color.YELLOW.withAlpha(0.9); // 預設海纜線為黃色

        if (name.includes("12")) {
            lineColor = Cesium.Color.WHITE.withAlpha(1.0); // 12海里 → 白色
        } else if (name.includes("24")) {
            lineColor = Cesium.Color.WHITE.withAlpha(0.5); // 24海里 → 淡灰白半透明
        }

        // 設定線條樣式（高度、顏色、透明度等）
        dataSource.entities.values.forEach(entity => {
            if (entity.polyline) {
                entity.polyline.height = 50;  // 浮起 50 公尺
                entity.polyline.width = 2;    // 線條寬度
                entity.polyline.material = lineColor;
            }
        });

        // 預設不顯示（等使用者勾選）
        dataSource.show = false;

        // 建立圖層清單項目
        const li = document.createElement("li");

        // 勾選框
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = false;

        // 文字標籤
        const label = document.createElement("span");
        label.textContent = name;

        // 控制顯示/隱藏
        checkbox.addEventListener("change", () => {
            dataSource.show = checkbox.checked;
        });

        // 加入元素
        li.appendChild(checkbox);
        li.appendChild(label);
        layerList.appendChild(li);
    } catch (error) {
        console.error("Error adding GeoJSON layer:", error);
    }
}



// 呼叫函數
addGeoJsonLayer("電纜", 3390457);
//addGeoJsonLayer("12nm_tw_area", 3455678);
addGeoJsonLayer("12海哩領海範圍", 3460591);
addGeoJsonLayer("24海哩範圍", 3860511);
