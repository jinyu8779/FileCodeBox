// 获取分享：图片 / 视频预览，以及 zip 内条目预览

const SharePreview = {
    MAX_ZIP_BYTES: 120 * 1024 * 1024,
    MAX_ENTRY_BYTES: 80 * 1024 * 1024,
    objectUrls: [],
    zipEntries: null,
    _zip: null,

    imageExts: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'],
    videoExts: ['mp4', 'webm', 'ogg', 'mov', 'm4v'],

    revokeAll() {
        this.objectUrls.forEach((u) => {
            try {
                URL.revokeObjectURL(u);
            } catch (e) {
                /* ignore */
            }
        });
        this.objectUrls = [];
        this.zipEntries = null;
        this._zip = null;
    },

    trackUrl(url) {
        if (url) this.objectUrls.push(url);
        return url;
    },

    getExt(name) {
        if (!name || typeof name !== 'string') return '';
        const base = name.split(/[/\\]/).pop() || '';
        const i = base.lastIndexOf('.');
        if (i < 0) return '';
        return base.slice(i + 1).toLowerCase();
    },

    getKind(name) {
        const ext = this.getExt(name);
        if (this.imageExts.includes(ext)) return 'image';
        if (this.videoExts.includes(ext)) return 'video';
        if (ext === 'zip') return 'zip';
        return 'other';
    },

    isPreviewable(name) {
        const k = this.getKind(name);
        return k === 'image' || k === 'video';
    },

    authHeaders() {
        const headers = {};
        if (typeof UserAuth !== 'undefined' && UserAuth.getToken) {
            const token = UserAuth.getToken();
            if (token) headers['Authorization'] = 'Bearer ' + token;
        }
        return headers;
    },

    async fetchBlob(url) {
        const response = await fetch(url, { headers: this.authHeaders() });
        if (!response.ok) {
            let detail = '';
            try {
                const j = await response.clone().json();
                detail = j && (j.message || j.msg) ? String(j.message || j.msg) : '';
            } catch (e) {
                /* ignore */
            }
            throw new Error(detail || '获取文件失败（HTTP ' + response.status + '）');
        }
        return response.blob();
    },

    withQuery(url, params) {
        try {
            const u = new URL(url, window.location.origin);
            Object.keys(params || {}).forEach((k) => u.searchParams.set(k, params[k]));
            if (url.startsWith('/')) {
                return u.pathname + u.search;
            }
            return u.toString();
        } catch (e) {
            const join = url.includes('?') ? '&' : '?';
            const qs = Object.keys(params || {})
                .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
                .join('&');
            return url + join + qs;
        }
    },

    guessMime(name, kind) {
        const ext = this.getExt(name);
        const map = {
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            png: 'image/png',
            gif: 'image/gif',
            webp: 'image/webp',
            bmp: 'image/bmp',
            svg: 'image/svg+xml',
            mp4: 'video/mp4',
            m4v: 'video/mp4',
            webm: 'video/webm',
            ogg: 'video/ogg',
            ogv: 'video/ogg',
            mov: 'video/quicktime',
        };
        if (map[ext]) return map[ext];
        if (kind === 'image') return 'image/png';
        if (kind === 'video') return 'video/mp4';
        return '';
    },

    async detectMp4VideoCodec(blob) {
        try {
            const buf = await blob.slice(0, Math.min(blob.size, 256 * 1024)).arrayBuffer();
            const bytes = new Uint8Array(buf);
            const ascii = (start, n) =>
                String.fromCharCode.apply(null, bytes.subarray(start, start + n));
            for (let i = 0; i < bytes.length - 8; i++) {
                const tag = ascii(i, 4);
                if (tag === 'avc1' || tag === 'avc3') return 'avc1';
                if (tag === 'hvc1' || tag === 'hev1') return 'hevc';
                if (tag === 'vp09') return 'vp9';
                if (tag === 'av01') return 'av1';
            }
        } catch (e) {
            /* ignore */
        }
        return '';
    },

    browserCanPlayHevc() {
        try {
            const v = document.createElement('video');
            return !!(
                v.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"') ||
                v.canPlayType('video/mp4; codecs="hev1.1.6.L93.B0"')
            );
        } catch (e) {
            return false;
        }
    },

    browserCanPlayAvc() {
        try {
            const v = document.createElement('video');
            return !!v.canPlayType('video/mp4; codecs="avc1.42E01E,mp4a.40.2"');
        } catch (e) {
            return true;
        }
    },

    async render(detail) {
        this.revokeAll();

        const fileName = detail.name || '未知文件';
        const fileSize = detail.size != null ? formatFileSize(detail.size) : '未知';
        const downloadUrl = detail.text;
        const kind = this.getKind(fileName);

        showResult(`
            <h3>📁 文件信息</h3>
            <div class="share-file-card">
                <p><strong>文件名:</strong> ${escapeHtml(fileName)}</p>
                <p><strong>大小:</strong> ${escapeHtml(fileSize)}</p>
                <div class="share-file-actions">
                    <a href="${escapeHtml(downloadUrl)}" class="btn share-download-btn" download>📥 下载文件</a>
                </div>
                <div id="share-preview-root" class="share-preview-root">
                    <div class="share-preview-status">正在准备预览…</div>
                </div>
            </div>
        `);

        const root = document.getElementById('share-preview-root');
        if (!root) return;

        try {
            if (kind === 'image' || kind === 'video') {
                await this.renderDirectMedia(root, downloadUrl, fileName, kind);
            } else if (kind === 'zip') {
                await this.renderZip(root, downloadUrl, detail.size);
            } else {
                root.innerHTML =
                    '<div class="share-preview-empty">该类型暂不支持在线预览，请下载后查看。</div>';
            }
        } catch (err) {
            root.innerHTML =
                '<div class="share-preview-error">预览失败：' +
                escapeHtml(err.message || String(err)) +
                '</div>';
        }
    },

    async renderDirectMedia(root, url, fileName, kind) {
        const mime = this.guessMime(fileName, kind);
        const previewUrl = this.withQuery(url, { preview: '1' });

        root.innerHTML = '<div class="share-preview-status">正在加载预览…</div>';

        // 统一 fetch→Blob：可带登录头，并能显示真实 HTTP 错误（次数用尽等）
        const blob = await this.fetchBlob(previewUrl);
        let playMime = mime;
        let codecHint = '';

        if (kind === 'video') {
            const codec = await this.detectMp4VideoCodec(blob);
            if (codec === 'hevc' && !this.browserCanPlayHevc()) {
                root.innerHTML =
                    '<div class="share-preview-error">该视频为 H.265/HEVC 编码，当前浏览器无法在线播放（微信视频常见）。请下载后观看，或转成 H.264 后重新上传。<br/><code>ffmpeg -i 输入.mp4 -c:v libx264 -c:a aac -movflags +faststart 输出.mp4</code></div>';
                return;
            }
            if (codec === 'avc1' && !this.browserCanPlayAvc()) {
                root.innerHTML =
                    '<div class="share-preview-error">当前浏览器无法播放 H.264 视频，请下载后观看。</div>';
                return;
            }
            if (codec === 'hevc') codecHint = '检测到 HEVC，若无法播放请换 Safari 或下载。';
            else if (codec === 'avc1') codecHint = '编码：H.264（浏览器兼容）';
            playMime = 'video/mp4';
        }

        const typed = this.blobWithMime(blob, kind, fileName, playMime);
        const objectUrl = this.trackUrl(URL.createObjectURL(typed));
        root.innerHTML = this.mediaHtml(kind, objectUrl, fileName, codecHint);
        if (kind === 'video') {
            this.bindVideoEvents(root);
        }
    },

    mediaHtml(kind, src, title, hint) {
        const safeTitle = escapeHtml(title || '');
        const safeSrc = escapeHtml(src);
        if (kind === 'image') {
            return `
                <div class="share-preview-panel">
                    <div class="share-preview-label">图片预览</div>
                    <img class="share-preview-media" src="${safeSrc}" alt="${safeTitle}" />
                </div>`;
        }
        const hintHtml = hint
            ? `<div class="share-preview-hint">${escapeHtml(hint)}</div>`
            : '';
        return `
            <div class="share-preview-panel">
                <div class="share-preview-label">视频播放</div>
                <div class="share-video-wrap">
                    <video class="share-preview-media" src="${safeSrc}" controls playsinline preload="metadata"></video>
                </div>
                <div class="share-video-toolbar">
                    <button type="button" class="share-video-play-btn">▶ 播放 / 暂停</button>
                </div>
                ${hintHtml}
                <div class="share-preview-error share-video-error" hidden></div>
            </div>`;
    },

    bindVideoEvents(root) {
        const video = root.querySelector('video.share-preview-media');
        const errBox = root.querySelector('.share-video-error');
        const playBtn = root.querySelector('.share-video-play-btn');
        if (!video) return;

        const showError = () => {
            if (!errBox) return;
            errBox.hidden = false;
            const code = video.error ? video.error.code : 0;
            errBox.textContent =
                '视频无法播放（错误码 ' +
                code +
                '）。请确认文件可下载；若本机播放器正常，多半是浏览器解码限制，请下载后观看。';
        };

        video.addEventListener('error', showError);

        const togglePlay = async () => {
            try {
                if (video.paused) {
                    await video.play();
                    if (playBtn) playBtn.textContent = '⏸ 暂停';
                } else {
                    video.pause();
                    if (playBtn) playBtn.textContent = '▶ 播放';
                }
            } catch (err) {
                if (!errBox) return;
                errBox.hidden = false;
                errBox.textContent =
                    '无法开始播放：' + (err && err.message ? err.message : String(err));
            }
        };

        if (playBtn) {
            playBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                togglePlay();
            });
        }

        // 点击画面也可切换（不依赖原生控件命中）
        video.addEventListener('click', (e) => {
            // 若点到原生控件区域，交给浏览器；其余区域切换播放
            const rect = video.getBoundingClientRect();
            const controlsH = 40;
            if (e.clientY > rect.bottom - controlsH) return;
            togglePlay();
        });

        video.addEventListener('play', () => {
            if (playBtn) playBtn.textContent = '⏸ 暂停';
        });
        video.addEventListener('pause', () => {
            if (playBtn) playBtn.textContent = '▶ 播放';
        });
    },

    async renderZip(root, url, totalSize) {
        if (typeof JSZip === 'undefined') {
            root.innerHTML =
                '<div class="share-preview-error">JSZip 未加载，无法解析压缩包。请直接下载。</div>';
            return;
        }
        if (totalSize > 0 && totalSize > this.MAX_ZIP_BYTES) {
            root.innerHTML =
                '<div class="share-preview-empty">压缩包较大（超过 ' +
                formatFileSize(this.MAX_ZIP_BYTES) +
                '），请下载后本地查看。</div>';
            return;
        }

        root.innerHTML = '<div class="share-preview-status">正在下载并解析压缩包…</div>';
        const blob = await this.fetchBlob(url);
        if (blob.size > this.MAX_ZIP_BYTES) {
            root.innerHTML =
                '<div class="share-preview-empty">压缩包过大，请下载后本地查看。</div>';
            return;
        }

        const zip = await JSZip.loadAsync(blob);
        this._zip = zip;

        const entries = [];
        zip.forEach((relativePath, file) => {
            if (file.dir) return;
            const name = relativePath;
            const kind = this.getKind(name);
            entries.push({
                name,
                size: file._data ? file._data.uncompressedSize : 0,
                kind,
                zipPath: relativePath,
                previewable: kind === 'image' || kind === 'video',
            });
        });
        entries.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
        this.zipEntries = entries;

        if (!entries.length) {
            root.innerHTML = '<div class="share-preview-empty">压缩包内没有可展示的文件。</div>';
            return;
        }

        const previewableCount = entries.filter((e) => e.previewable).length;
        const listHtml = entries
            .map((e, idx) => {
                const action = e.previewable
                    ? `<button type="button" class="btn-sm share-zip-preview-btn" data-idx="${idx}">预览</button>`
                    : `<span class="share-zip-no-preview">不可预览</span>`;
                return `
                    <li class="share-zip-item ${e.previewable ? 'is-previewable' : ''}">
                        <span class="share-zip-icon">${
                            e.kind === 'image' ? '🖼️' : e.kind === 'video' ? '🎬' : '📄'
                        }</span>
                        <span class="share-zip-name" title="${escapeHtml(e.name)}">${escapeHtml(
                            e.name
                        )}</span>
                        <span class="share-zip-size">${e.size ? formatFileSize(e.size) : ''}</span>
                        ${action}
                    </li>`;
            })
            .join('');

        root.innerHTML = `
            <div class="share-preview-panel share-zip-panel">
                <div class="share-preview-label">压缩包内容（${entries.length} 个文件${
                    previewableCount ? '，其中 ' + previewableCount + ' 个可预览' : ''
                }）</div>
                <ul class="share-zip-list">${listHtml}</ul>
                <div id="share-zip-media" class="share-zip-media"></div>
            </div>`;

        root.querySelectorAll('.share-zip-preview-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.getAttribute('data-idx'), 10);
                this.previewZipEntry(idx);
            });
        });
    },

    async previewZipEntry(idx) {
        const entry = this.zipEntries && this.zipEntries[idx];
        const media = document.getElementById('share-zip-media');
        if (!entry || !media || !entry.previewable) return;

        media.innerHTML =
            '<div class="share-preview-status">正在解压：' + escapeHtml(entry.name) + '…</div>';
        try {
            if (!this._zip) {
                throw new Error('压缩包会话已失效，请重新获取分享');
            }
            if (entry.size > this.MAX_ENTRY_BYTES) {
                throw new Error('该条目过大，请下载压缩包后本地查看');
            }
            const file = this._zip.file(entry.zipPath);
            if (!file) throw new Error('找不到条目');
            const blob = await file.async('blob');
            if (blob.size > this.MAX_ENTRY_BYTES) {
                throw new Error('该条目过大，请下载压缩包后本地查看');
            }

            let playMime = this.guessMime(entry.name, entry.kind);
            if (entry.kind === 'video') {
                const codec = await this.detectMp4VideoCodec(blob);
                if (codec === 'hevc' && !this.browserCanPlayHevc()) {
                    media.innerHTML =
                        '<div class="share-preview-error">条目为 H.265/HEVC，当前浏览器无法播放，请下载后观看。</div>';
                    return;
                }
                playMime = 'video/mp4';
            }

            const typed = this.blobWithMime(blob, entry.kind, entry.name, playMime);
            const objectUrl = this.trackUrl(URL.createObjectURL(typed));
            media.innerHTML = this.mediaHtml(entry.kind, objectUrl, entry.name);
            if (entry.kind === 'video') {
                this.bindVideoEvents(media);
            }
            media.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch (err) {
            media.innerHTML =
                '<div class="share-preview-error">预览失败：' +
                escapeHtml(err.message || String(err)) +
                '</div>';
        }
    },

    blobWithMime(blob, kind, name, forcedMime) {
        const guessed = forcedMime || this.guessMime(name, kind);
        if (kind === 'video') {
            const mime = guessed || 'video/mp4';
            if (blob.type === mime) return blob;
            return new Blob([blob], { type: mime });
        }
        if (blob.type && blob.type !== 'application/octet-stream') return blob;
        if (!guessed) return blob;
        return new Blob([blob], { type: guessed });
    },
};
