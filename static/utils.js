export function loadCSS(url) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  document.head.appendChild(link);
}

export function loadHTML(htmlString) {
  // 建立一個容器來承載 HTML
  const container = document.createElement('div');
  container.innerHTML = htmlString;

  // 將容器的內容加入到 body 中
  document.body.appendChild(container);
}

export function copyToClipboard(str) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(str).then(function () {
      console.log('已複製到剪貼簿: ' + str);
    }, function (err) {
      console.error('無法複製文字: ', err);
    });
  } else {
    // Fallback for unsupported browsers
    const textarea = document.createElement('textarea');
    textarea.value = str;
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      console.log('已複製到剪貼簿: ' + str);
    } catch (err) {
      console.error('無法複製文字: ', err);
    }
    document.body.removeChild(textarea);
  }
}


export function makePanelDraggable(panelId, headerClass) {
  const panel = document.getElementById(panelId);
  const header = panel.querySelector(headerClass);

  let isDragging = false;
  let offsetX = 0;
  let offsetY = 0;

  header.addEventListener('mousedown', (event) => {
    isDragging = true;
    offsetX = event.clientX - panel.offsetLeft;
    offsetY = event.clientY - panel.offsetTop;
    header.style.cursor = 'move';
  });

  document.addEventListener('mousemove', (event) => {
    if (isDragging) {
      const left = event.clientX - offsetX;
      const top = event.clientY - offsetY;
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    }
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
    header.style.cursor = 'default';
  });
}
