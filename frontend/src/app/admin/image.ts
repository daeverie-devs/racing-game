const MAX_SIDE = 360;

/**
 * Shrinks a pasted screenshot or dropped file to at most 360 px on its longest side, keeping
 * transparency, so racer pictures stay small on every phone. Returns a data URL for the upload.
 */
export const resizeImage = (file: Blob): Promise<string> => new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
        reject(new Error('Ce n\'est pas une image'));
        return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            reject(new Error('Image illisible'));
            return;
        }
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const webp = canvas.toDataURL('image/webp', 0.9);
        // Browsers without WebP encoding fall back to PNG
        resolve(webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png'));
    };
    img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Image illisible'));
    };
    img.src = url;
});

/** The first image in a paste or a drop, if any */
export const imageFromTransfer = (data: DataTransfer | null): File | null => {
    if (!data) return null;
    for (const item of Array.from(data.items ?? [])) {
        if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile();
    }
    return Array.from(data.files ?? []).find(f => f.type.startsWith('image/')) ?? null;
};
