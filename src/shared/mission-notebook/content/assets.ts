export async function saveAsset(file: File) {
  if (window.native) return window.native.saveAsset(file.name, await file.arrayBuffer());
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function saveSpaceFile(pageId: string, folderId: string | null, file: File) {
  if (!window.native) return null;
  return window.native.uploadToSpace(pageId, folderId, file.name, await file.arrayBuffer());
}

/** Decode before committing an image reference. Originals, including animated
 * GIFs and SVGs, are saved unchanged; a failed preview never replaces a cover. */
export function probeImage(url: string, timeoutMs = 15000): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => { clearTimeout(timer); image.onload = null; image.onerror = null; };
    const timer = setTimeout(() => { cleanup(); image.src = ''; reject(new Error('图片加载超时，请检查链接后重试')); }, timeoutMs);
    image.onload = () => {
      const size = { width: image.naturalWidth, height: image.naturalHeight };
      cleanup();
      if (size.width && size.height) resolve(size);
      else reject(new Error('图片没有有效尺寸，请选择其他图片'));
    };
    image.onerror = () => { cleanup(); reject(new Error('无法读取图片，请检查格式或链接')); };
    image.src = url;
  });
}
export async function saveImageAsset(file: File) {
  if (!file.size) throw new Error('图片文件为空，请重新选择');
  const preview = URL.createObjectURL(file);
  try { await probeImage(preview); }
  finally { URL.revokeObjectURL(preview); }
  return saveAsset(file);
}
