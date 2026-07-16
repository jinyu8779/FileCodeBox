// 文件上传模块 - 处理文件选择、拖拽、上传进度等

/**
 * 文件上传管理器
 */
const FileUpload = {
    // 上传配置
    config: {
        maxSize: 10485760, // 默认10MB
        allowedTypes: [], // 允许的文件类型
        chunkSize: 1024 * 1024, // 分片大小 1MB
        enableChunk: false, // 是否启用分片上传
        maxFolderFiles: 100, // 文件夹最大文件数，0=不限制
        shareResponseType: 'code', // code | url
        defaultExpireValue: 1,
        defaultExpireStyle: 'day',
        allowModifyExpire: 1,
    },
    
    // 当前上传状态
    currentUpload: null,
    
    /**
     * 初始化文件上传
     */
    init() {
        this.setupFileInput();
        this.setupDragAndDrop();
        this.setupClipboardImage();
        this.setupFormSubmit();
        this.loadConfig();
    },
    
    /**
     * 加载服务器配置
     */
    async loadConfig() {
        try {
            const response = await fetch('/', {
                method: 'POST'
            });
            const result = await response.json();
            
            if (result.code === 200) {
                this.config.maxSize = result.data.uploadSize;
                this.config.enableChunk = result.data.enableChunk;
                this.config.maxFolderFiles = result.data.maxFolderFiles ?? 100;
                this.config.shareResponseType = result.data.shareResponseType === 'url' ? 'url' : 'code';
                this.config.defaultExpireValue = result.data.defaultExpireValue ?? 1;
                this.config.defaultExpireStyle = result.data.defaultExpireStyle || 'day';
                this.config.allowModifyExpire = result.data.allowModifyExpire ?? 1;
                this.applyExpirePolicy();
                console.log('上传配置已加载:', this.config);
            }
        } catch (error) {
            console.error('获取配置失败:', error);
        }
    },

    /**
     * 按服务端配置回填/隐藏过期时间控件
     */
    applyExpirePolicy() {
        const style = this.config.defaultExpireStyle || 'day';
        const value = this.config.defaultExpireValue ?? 1;
        const allow = this.config.allowModifyExpire !== 0;

        document.querySelectorAll('select[name="expire_style"]').forEach((el) => {
            if ([...el.options].some((o) => o.value === style)) {
                el.value = style;
            }
            el.disabled = !allow;
            const group = el.closest('.form-group');
            if (group) {
                group.style.display = allow ? '' : 'none';
            }
        });

        document.querySelectorAll('input[name="expire_value"]').forEach((el) => {
            el.value = value;
            el.disabled = !allow;
            const group = el.closest('.form-group');
            if (group) {
                group.style.display = allow ? '' : 'none';
            }
        });
    }, 
    /**
     * 设置文件选择器
     */
    setupFileInput() {
        const fileInput = document.getElementById('file-input');
        const folderInput = document.getElementById('folder-input');
        
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    this.updateFileDisplay(file);
                    // 清空文件夹选择器
                    if (folderInput) folderInput.value = '';
                }
            });
        }
        
        if (folderInput) {
            folderInput.addEventListener('change', (e) => {
                const files = e.target.files;
                if (files.length > 0) {
                    this.updateFolderDisplay(files);
                    // 清空文件选择器
                    if (fileInput) fileInput.value = '';
                }
            });
        }
    },
    
    /**
     * 点击按钮：读取剪贴板中的图片并作为待上传文件
     */
    setupClipboardImage() {
        const btn = document.getElementById('clipboard-image-btn');
        if (!btn || typeof ClipboardImage === 'undefined') return;

        btn.addEventListener('click', async () => {
            const originalText = btn.textContent;
            btn.disabled = true;
            btn.textContent = '读取中...';
            try {
                const file = await ClipboardImage.readImageFile();
                if (!file || !ClipboardImage.isImageType(file.type)) {
                    throw new Error('剪切板中的内容不是图片文件');
                }
                this.validateFile(file);

                const fileInput = document.getElementById('file-input');
                const folderInput = document.getElementById('folder-input');
                if (fileInput) {
                    const dt = new DataTransfer();
                    dt.items.add(file);
                    fileInput.files = dt.files;
                }
                if (folderInput) folderInput.value = '';
                this.currentFolderFiles = null;
                this.updateFileDisplay(file);
                showNotification('已从剪贴板载入图片，请点击「上传文件」完成上传', 'success');
            } catch (err) {
                showNotification(err.message || '读取剪贴板图片失败', 'error');
            } finally {
                btn.disabled = false;
                btn.textContent = originalText;
            }
        });
    },

    /**
     * 设置拖拽上传
     */
    setupDragAndDrop() {
        const uploadArea = document.querySelector('.upload-area');
        if (!uploadArea) return;
        
        // 移除原有的点击事件，改用标签按钮处理
        // uploadArea.addEventListener('click', () => {
        //     document.getElementById('file-input')?.click();
        // });
        
        // 拖拽事件
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });
        
        uploadArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
        });
        
        uploadArea.addEventListener('drop', async (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');

            try {
                const { files, hasDirectory } = await FolderDrop.readFilesFromDataTransfer(e.dataTransfer);
                if (!files.length) {
                    showNotification('未检测到可上传的文件', 'error');
                    return;
                }

                const fileInput = document.getElementById('file-input');
                const folderInput = document.getElementById('folder-input');

                if (hasDirectory || files.length > 1) {
                    if (!this.validateFolderFileCount(files.length)) {
                        return;
                    }
                    this.updateFolderDisplay(files);
                    if (fileInput) fileInput.value = '';
                    if (folderInput) folderInput.value = '';
                } else {
                    if (fileInput) {
                        const dt = new DataTransfer();
                        dt.items.add(files[0]);
                        fileInput.files = dt.files;
                    }
                    this.updateFileDisplay(files[0]);
                    this.currentFolderFiles = null;
                    if (folderInput) folderInput.value = '';
                }
            } catch (err) {
                showNotification(err.message || '读取拖拽内容失败', 'error');
            }
        });
    },

    /**
     * 校验文件夹文件数量
     */
    validateFolderFileCount(count) {
        const max = this.config.maxFolderFiles;
        if (max > 0 && count > max) {
            showNotification(`文件夹内文件数量（${count}）超过限制（最大 ${max} 个），不允许上传`, 'error');
            return false;
        }
        return true;
    },
    
    /**
     * 设置表单提交
     */
    setupFormSubmit() {
        const form = document.getElementById('file-form');
        if (!form) return;
        
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleFileUpload(e);
        });
    },
    
    /**
     * 更新文件显示
     */
    updateFileDisplay(file) {
        const uploadText = document.querySelector('.upload-text');
        if (uploadText && file) {
            const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
            uploadText.textContent = `已选择: ${file.name} (${fileSizeMB}MB)`;
        }
    },
    
    /**
     * 更新文件夹显示
     */
    updateFolderDisplay(files) {
        const uploadText = document.querySelector('.upload-text');
        if (uploadText && files.length > 0) {
            if (!this.validateFolderFileCount(files.length)) {
                this.currentFolderFiles = null;
                return;
            }
            const totalSize = Array.from(files).reduce((sum, file) => sum + file.size, 0);
            const totalSizeMB = (totalSize / 1024 / 1024).toFixed(2);
            
            // 获取文件夹名称（从第一个文件的路径中提取）
            const firstFile = files[0];
            const folderName = firstFile.webkitRelativePath ? 
                firstFile.webkitRelativePath.split('/')[0] : 
                '未知文件夹';
                
            uploadText.textContent = `已选择文件夹: ${folderName} (${files.length}个文件, ${totalSizeMB}MB)`;
            
            // 存储文件夹信息供上传使用
            this.currentFolderFiles = files;
        }
    },
    
    /**
     * 验证文件
     */
    validateFile(file) {
        // 检查文件大小
        if (file.size > this.config.maxSize) {
            const maxSizeMB = (this.config.maxSize / 1024 / 1024).toFixed(2);
            const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
            throw new Error(`文件大小超过限制！
文件大小: ${fileSizeMB}MB
最大允许: ${maxSizeMB}MB

请选择更小的文件或使用管理后台调整上传大小限制。`);
        }
        
        // 检查文件类型（如果配置了允许的类型）
        if (this.config.allowedTypes.length > 0 && !validateFileType(file, this.config.allowedTypes)) {
            throw new Error(`不支持的文件类型: ${getFileExtension(file.name)}`);
        }
        
        return true;
    },
    
    /**
     * 处理文件上传
     */
    async handleFileUpload(event) {
        const fileInput = document.getElementById('file-input');
        const folderInput = document.getElementById('folder-input');
        
        // 检查是单文件还是文件夹
        let files = [];
        if (fileInput?.files?.length > 0) {
            files = [fileInput.files[0]];
        } else if (folderInput?.files?.length > 0) {
            files = Array.from(folderInput.files);
        } else if (this.currentFolderFiles?.length > 0) {
            files = Array.from(this.currentFolderFiles);
        }
        
        if (files.length === 0) {
            showNotification('请选择文件或文件夹', 'error');
            return;
        }
        
        try {
            if (files.length === 1) {
                // 单文件上传
                await this.uploadSingleFile(files[0], event);
            } else {
                // 文件夹上传（多文件）
                await this.uploadMultipleFiles(files, event);
            }
            
        } catch (error) {
            showNotification(error.message, 'error');
        }
    },
    
    /**
     * 上传单个文件
     */
    async uploadSingleFile(file, event) {
        // 验证文件
        this.validateFile(file);
        
        // 获取表单数据
        const formData = new FormData();
        formData.append('file', file);
        formData.append('expire_style', event.target.expire_style.value);
        formData.append('expire_value', event.target.expire_value.value);
        
        // 开始上传
        await this.uploadFile(formData, file);
    },
    
    /**
     * 上传多个文件（文件夹）
     */
    async uploadMultipleFiles(files, event) {
        // 创建压缩包
        showNotification('正在打包文件夹，请稍候...', 'info');
        
        try {
            if (!this.validateFolderFileCount(files.length)) {
                return;
            }

            // 使用JSZip创建压缩包
            if (typeof JSZip === 'undefined') {
                throw new Error('文件夹上传功能需要加载JSZip库，请刷新页面重试');
            }
            
            const zip = new JSZip();
            
            // 添加文件到压缩包
            for (const file of files) {
                const relativePath = file.webkitRelativePath || file.name;
                zip.file(relativePath, file);
            }
            
            // 生成压缩包
            const zipBlob = await zip.generateAsync({
                type: 'blob',
                compression: 'DEFLATE',
                compressionOptions: { level: 6 }
            });
            
            // 创建文件对象
            const folderName = files[0].webkitRelativePath ? 
                files[0].webkitRelativePath.split('/')[0] : 
                'folder';
            const zipFile = new File([zipBlob], `${folderName}.zip`, { type: 'application/zip' });
            
            // 验证压缩包大小
            this.validateFile(zipFile);
            
            // 上传压缩包
            const formData = new FormData();
            formData.append('file', zipFile);
            formData.append('expire_style', event.target.expire_style.value);
            formData.append('expire_value', event.target.expire_value.value);
            formData.append('folder_file_count', String(files.length));
            
            await this.uploadFile(formData, zipFile);
            
        } catch (error) {
            throw new Error('文件夹打包失败: ' + error.message);
        }
    },
    
    /**
     * 上传文件
     */
    async uploadFile(formData, file) {
        const progressContainer = document.getElementById('upload-progress');
        const progressFill = document.getElementById('progress-fill');
        const progressText = document.getElementById('progress-text');
        const uploadStatus = document.getElementById('upload-status');
        const uploadBtn = document.getElementById('upload-btn');
        
        // 显示进度条和禁用按钮
        if (progressContainer) progressContainer.classList.add('show');
        if (uploadBtn) uploadBtn.disabled = true;
        if (uploadStatus) {
            uploadStatus.textContent = '正在上传...';
            uploadStatus.className = 'upload-status status-uploading';
        }
        
        try {
            const xhr = new XMLHttpRequest();
            
            // 上传进度监听
            const uploadStartTime = Date.now();
            let lastUpdateTime = uploadStartTime;
            let smoothProgress = 0;
            
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const currentTime = Date.now();
                    const timeDiff = currentTime - lastUpdateTime;
                    
                    // 计算真实进度
                    const realProgress = (e.loaded / e.total) * 100;
                    
                    // 平滑进度更新，避免进度条跳跃
                    if (timeDiff > 50) { // 每50ms最多更新一次
                        // 如果真实进度比当前显示的进度快很多，加快追赶速度
                        const progressDiff = realProgress - smoothProgress;
                        if (progressDiff > 10) {
                            smoothProgress += progressDiff * 0.5; // 快速追赶
                        } else {
                            smoothProgress += progressDiff * 0.3; // 平滑更新
                        }
                        
                        // 确保进度不超过真实进度
                        smoothProgress = Math.min(smoothProgress, realProgress);
                        
                        // 更新UI
                        const displayProgress = Math.floor(smoothProgress);
                        if (progressFill) progressFill.style.width = smoothProgress + '%';
                        if (progressText) progressText.textContent = displayProgress + '%';
                        
                        // 计算上传速度
                        const speed = e.loaded / ((currentTime - uploadStartTime) / 1000);
                        const speedText = formatSpeed(speed);
                        
                        // 估算剩余时间
                        const remainingBytes = e.total - e.loaded;
                        const estimatedTime = remainingBytes / speed;
                        const timeText = formatTime(estimatedTime);
                        
                        if (uploadStatus) {
                            if (displayProgress < 100) {
                                uploadStatus.textContent = `正在上传... ${displayProgress}% (${speedText}, 剩余${timeText})`;
                            } else {
                                uploadStatus.textContent = '处理中...';
                            }
                        }
                        
                        lastUpdateTime = currentTime;
                    }
                }
            });
            
            // 响应处理
            xhr.addEventListener('load', () => {
                try {
                    const result = JSON.parse(xhr.responseText);
                    
                    if (result.code === 200) {
                        if (uploadStatus) {
                            uploadStatus.textContent = '上传成功！';
                            uploadStatus.className = 'upload-status status-success';
                        }

                        const responseType = result.data.response_type || this.config.shareResponseType || 'code';
                        const displayValue = result.data.display_value ||
                            (responseType === 'url'
                                ? (result.data.download_url || result.data.full_share_url)
                                : result.data.code);
                        const displayLabel = responseType === 'url' ? '下载地址' : '提取码';

                        copyToClipboardAuto(displayValue);

                        const qrCodeData = result.data.qr_code_data || displayValue;
                        
                        setTimeout(() => {
                            showResult(`
                                <h3>文件上传成功！</h3>
                                <div class="result-code">${displayValue}</div>
                                <p>${displayLabel}已生成</p>
                                <p>文件名: ${result.data.file_name || ''}</p>
                                <p>文件大小: ${formatFileSize(file.size)}</p>
                                <p>✅ ${displayLabel}已自动复制到剪贴板</p>
                                <div class="qr-section">
                                    <h4>📱 扫码分享</h4>
                                    <div id="qr-code-container" class="qr-container"></div>
                                    <p class="qr-tip">扫描二维码快速访问分享内容</p>
                                </div>
                            `);
                            
                            // 生成并显示二维码
                            this.generateQRCode(qrCodeData);
                            
                            // 重置表单
                            this.resetUpload();
                        }, 1000);
                    } else {
                        throw new Error(result.message || '上传失败');
                    }
                } catch (error) {
                    this.handleUploadError(error.message);
                }
            });
            
            // 错误处理
            xhr.addEventListener('error', () => {
                this.handleUploadError('网络错误，请重试');
            });
            
            // 超时处理
            xhr.addEventListener('timeout', () => {
                this.handleUploadError('上传超时，请重试');
            });
            
            // 发送请求
            xhr.timeout = 300000; // 5分钟超时
            xhr.open('POST', '/share/file/');
            
            // 添加认证头
            const token = UserAuth.getToken();
            if (token) {
                xhr.setRequestHeader('Authorization', 'Bearer ' + token);
            }
            
            xhr.send(formData);
            
        } catch (error) {
            this.handleUploadError(error.message);
        }
    },
    
    /**
     * 处理上传错误
     */
    handleUploadError(message) {
        const uploadStatus = document.getElementById('upload-status');
        const uploadBtn = document.getElementById('upload-btn');
        
        if (uploadStatus) {
            uploadStatus.textContent = '上传失败: ' + message;
            uploadStatus.className = 'upload-status status-error';
        }
        
        if (uploadBtn) {
            uploadBtn.disabled = false;
        }
        
        setTimeout(() => {
            showNotification('上传失败: ' + message, 'error');
        }, 500);
    },
    
    /**
     * 重置上传状态
     */
    resetUpload() {
        const progressContainer = document.getElementById('upload-progress');
        const progressFill = document.getElementById('progress-fill');
        const progressText = document.getElementById('progress-text');
        const uploadBtn = document.getElementById('upload-btn');
        const fileInput = document.getElementById('file-input');
        const folderInput = document.getElementById('folder-input');
        const uploadText = document.querySelector('.upload-text');
        
        if (progressContainer) progressContainer.classList.remove('show');
        if (uploadBtn) uploadBtn.disabled = false;
        if (progressFill) progressFill.style.width = '0%';
        if (progressText) progressText.textContent = '0%';
        if (fileInput) fileInput.value = '';
        if (folderInput) folderInput.value = '';
        if (uploadText) uploadText.textContent = '点击选择文件或拖拽到此处';
        
        // 清空文件夹文件缓存
        this.currentFolderFiles = null;
    },
    
    /**
     * 生成二维码
     * @param {string} data - 二维码数据
     */
    generateQRCode(data) {
        const container = document.getElementById('qr-code-container');
        if (!container) return;
        
        // 显示加载状态
        container.innerHTML = '<div class="qr-loading">正在生成二维码...</div>';
        
        // 调用后端API生成二维码
        const qrUrl = `/api/qrcode/generate?data=${encodeURIComponent(data)}&size=200`;
        
        const img = document.createElement('img');
        img.src = qrUrl;
        img.alt = '二维码';
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        img.style.border = '1px solid #ddd';
        img.style.borderRadius = '8px';
        img.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
        
        img.onload = () => {
            container.innerHTML = '';
            container.appendChild(img);
        };
        
        img.onerror = () => {
            console.error('二维码加载失败');
            container.innerHTML = '<div class="qr-error">二维码生成失败，请刷新重试</div>';
        };
    }
};