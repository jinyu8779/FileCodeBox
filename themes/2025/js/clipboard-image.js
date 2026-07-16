// 从系统剪贴板读取图片文件（需用户点击触发）

const ClipboardImage = {
    mimeToExt: {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/bmp': 'bmp',
        'image/svg+xml': 'svg',
    },

    /**
     * 判断 MIME 是否为图片
     * @param {string} type
     * @returns {boolean}
     */
    isImageType(type) {
        return typeof type === 'string' && type.toLowerCase().startsWith('image/');
    },

    /**
     * 读取剪贴板中的第一张图片，转为 File
     * @returns {Promise<File>}
     */
    async readImageFile() {
        if (!window.isSecureContext) {
            throw new Error('读取剪贴板需要安全上下文（HTTPS 或 localhost），当前页面无法访问剪贴板');
        }
        if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
            throw new Error('当前浏览器不支持读取剪贴板图片，请升级浏览器或改用「选择文件」');
        }

        let clipboardItems;
        try {
            clipboardItems = await navigator.clipboard.read();
        } catch (err) {
            if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
                throw new Error('没有剪贴板读取权限，请在浏览器弹窗中允许访问后再试');
            }
            throw new Error(err.message || '读取剪贴板失败');
        }

        if (!clipboardItems || clipboardItems.length === 0) {
            throw new Error('剪切板为空，请先复制一张图片');
        }

        for (const item of clipboardItems) {
            const types = item.types || [];
            const imageType = types.find((t) => this.isImageType(t));
            if (!imageType) {
                continue;
            }

            let blob;
            try {
                blob = await item.getType(imageType);
            } catch (e) {
                continue;
            }

            if (!blob || !this.isImageType(blob.type || imageType)) {
                continue;
            }

            const mime = blob.type || imageType;
            if (!this.isImageType(mime)) {
                throw new Error('剪切板中的内容不是图片文件');
            }

            const ext = this.mimeToExt[mime.toLowerCase()] || 'png';
            const fileName = `clipboard-${this.formatTimestamp()}.${ext}`;
            return new File([blob], fileName, { type: mime, lastModified: Date.now() });
        }

        // 剪贴板有内容但无图片（常见为纯文本/链接）
        const hasTextOnly = clipboardItems.some((item) =>
            (item.types || []).some((t) => t === 'text/plain' || t === 'text/html')
        );
        if (hasTextOnly) {
            throw new Error('剪切板中是文字或链接，不是图片。请先对图片使用「复制图片」后再试');
        }
        throw new Error('剪切板中没有可上传的图片文件');
    },

    formatTimestamp() {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        return (
            d.getFullYear() +
            pad(d.getMonth() + 1) +
            pad(d.getDate()) +
            '-' +
            pad(d.getHours()) +
            pad(d.getMinutes()) +
            pad(d.getSeconds())
        );
    },
};

window.ClipboardImage = ClipboardImage;
