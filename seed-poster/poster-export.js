export async function posterPNG({canvas, ready = async () => {}, fonts = Promise.resolve(), render}) {
  await Promise.all([ready(), fonts]);
  render();
  try {
    return await new Promise((resolve,reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('浏览器未能生成 PNG，请重试')), 'image/png'));
  } catch(error) {
    if(error.name === 'SecurityError') throw Error('图片存在跨域限制，请通过 Worker 下载背景或重新上传本地图片后再导出');
    throw error;
  }
}
export async function downloadPoster(options, filename) {
  const blob = await posterPNG(options), href = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = href; link.download = filename;
  document.body.appendChild(link);link.click();link.remove();
  setTimeout(() => URL.revokeObjectURL(href),60000);
}
