// 分享功能模块 - 处理文本分享和内容获取

/**
 * 分享管理器
 */
const ShareManager = {
    /**
     * 初始化分享功能
     */
    init() {
        this.setupTextShare();
        this.setupContentGet();
    },
    
    /**
     * 设置文本分享
     */
    setupTextShare() {
        const form = document.getElementById('text-form');
        if (!form) return;
        
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleTextShare(e);
        });
    },
    
    /**
     * 设置内容获取
     */
    setupContentGet() {
        const form = document.getElementById('get-form');
        if (!form) return;
        
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleContentGet(e);
        });
    },
    
    /**
     * 处理文本分享
     */
    async handleTextShare(event) {
        const textBtn = document.getElementById('text-btn');
        const originalText = textBtn?.textContent || '分享文本';
        
        if (textBtn) {
            textBtn.disabled = true;
            textBtn.textContent = '分享中...';
        }
        
        try {
            const formData = new FormData();
            formData.append('text', event.target.text.value);
            formData.append('expire_style', event.target.expire_style.value);
            formData.append('expire_value', event.target.expire_value.value);
            
            const token = UserAuth.getToken();
            const headers = {};
            if (token) {
                headers['Authorization'] = 'Bearer ' + token;
            }
            
            const response = await fetch('/share/text/', {
                method: 'POST',
                headers: headers,
                body: formData
            });
            
            const result = await response.json();
            
            if (result.code === 200) {
                const responseType = result.data.response_type || 'code';
                const displayValue = result.data.display_value ||
                    (responseType === 'url'
                        ? (result.data.download_url || result.data.full_share_url)
                        : result.data.code);
                const displayLabel = responseType === 'url' ? '下载地址' : '提取码';
                copyToClipboardAuto(displayValue);
                
                // 生成二维码
                const qrCodeData = result.data.qr_code_data || displayValue;
                
                showResult(`
                    <h3>文本分享成功！</h3>
                    <div class="result-code">${displayValue}</div>
                    <p>${displayLabel}已生成</p>
                    <p>文本长度: ${event.target.text.value.length} 字符</p>
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
                event.target.text.value = '';
            } else {
                showNotification(result.message || '分享失败', 'error');
            }
        } catch (error) {
            showNotification('分享失败: ' + error.message, 'error');
        } finally {
            if (textBtn) {
                textBtn.disabled = false;
                textBtn.textContent = originalText;
            }
        }
    },
    
    /**
     * 从提取码或完整分享/下载 URL 中解析出分享码
     * @param {string} input
     * @returns {string}
     */
    extractShareCode(input) {
        let raw = (input || '').trim().replace(/^["']|["']$/g, '');
        if (!raw) return '';

        const looksLikeURL =
            /:\/\//.test(raw) ||
            raw.startsWith('/') ||
            /share\/download/i.test(raw) ||
            /\/s\//i.test(raw) ||
            /[?&]code=/i.test(raw);

        if (looksLikeURL) {
            try {
                let href = raw;
                if (raw.startsWith('//')) {
                    href = window.location.protocol + raw;
                } else if (raw.startsWith('/')) {
                    href = window.location.origin + raw;
                } else if (!/:\/\//.test(raw) && (raw.includes('/') || raw.includes('?'))) {
                    href = 'http://' + raw;
                }

                const url = new URL(href);
                const fromQuery = (url.searchParams.get('code') || '').trim();
                if (fromQuery) return fromQuery;

                const parts = url.pathname.split('/').filter(Boolean);
                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i].toLowerCase();
                    if (part === 's' && parts[i + 1]) {
                        return decodeURIComponent(parts[i + 1]).trim();
                    }
                    if (part === 'share' && parts[i + 1]) {
                        const next = parts[i + 1].toLowerCase();
                        if (!['download', 'select', 'file', 'text', 'chunk'].includes(next)) {
                            return decodeURIComponent(parts[i + 1]).trim();
                        }
                    }
                }
            } catch (e) {
                // fall through to regex
            }

            const match = raw.match(/[?&#]code=([^&\s#]+)/i);
            if (match && match[1]) {
                try {
                    return decodeURIComponent(match[1]).trim();
                } catch (e) {
                    return match[1].trim();
                }
            }
        }

        return raw.replace(/^\/+|\/+$/g, '');
    },

    /**
     * 处理内容获取
     */
    async handleContentGet(event) {
        const getBtn = document.getElementById('get-btn');
        const originalText = getBtn?.textContent || '获取内容';
        const codeInput = event.target.code;
        const code = this.extractShareCode(codeInput.value);

        if (!code) {
            showNotification('请输入提取码或完整下载地址', 'error');
            return;
        }

        // 若粘贴的是 URL，回填解析出的提取码，便于用户确认
        if (code !== codeInput.value.trim()) {
            codeInput.value = code;
        }
        
        if (getBtn) {
            getBtn.disabled = true;
            getBtn.textContent = '获取中...';
        }
        
        try {
            const token = UserAuth.getToken();
            const headers = {
                'Content-Type': 'application/json',
            };
            if (token) {
                headers['Authorization'] = 'Bearer ' + token;
            }
            
            const response = await fetch('/share/select/', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ code: code })
            });
            
            const result = await response.json();
            
            if (result.code === 200) {
                const detail = result.data;
                
                if (detail.text.startsWith('http') || detail.text.startsWith('/share/download')) {
                    // 文件下载
                    this.showFileResult(detail);
                } else {
                    // 文本内容
                    this.showTextResult(detail);
                }
                
                // 清空输入框
                codeInput.value = '';
            } else {
                showNotification(result.message || '获取失败', 'error');
            }
        } catch (error) {
            showNotification('获取失败: ' + error.message, 'error');
        } finally {
            if (getBtn) {
                getBtn.disabled = false;
                getBtn.textContent = originalText;
            }
        }
    },
    
    /**
     * 显示文件结果
     */
    showFileResult(detail) {
        const fileSize = detail.size ? formatFileSize(detail.size) : '未知';
        const fileName = detail.name ? escapeHtml(detail.name) : '未知文件';
        
        showResult(`
            <h3>📁 文件信息</h3>
            <div style="background: white; padding: 15px; border-radius: 8px; margin: 10px 0;">
                <p><strong>文件名:</strong> ${fileName}</p>
                <p><strong>大小:</strong> ${fileSize}</p>
                <div style="margin-top: 15px;">
                    <a href="${detail.text}" class="btn" download style="background: #28a745; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">📥 下载文件</a>
                </div>
            </div>
        `);
    },
    
    /**
     * 显示文本结果
     */
    showTextResult(detail) {
        // 转义HTML以防止XSS攻击和布局破坏
        const escapedText = escapeHtml(detail.text);
        
        // 限制文本长度显示
        const maxLength = 5000;
        const displayText = escapedText.length > maxLength 
            ? escapedText.substring(0, maxLength) + '\n\n... (文本过长，已截断)'
            : escapedText;
            
        showResult(`
            <h3>📝 文本内容</h3>
            <div style="background: white; padding: 15px; border-radius: 8px; white-space: pre-wrap; word-wrap: break-word; max-height: 400px; overflow-y: auto; border: 1px solid #ddd; font-family: monospace; font-size: 14px; line-height: 1.4;">
                ${displayText}
            </div>
            <div style="margin-top: 10px; text-align: center;">
                <button onclick="copyToClipboard('${escapedText.replace(/'/g, "\\'")}', this)" class="btn" style="background: #17a2b8; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">📋 复制文本</button>
            </div>
        `);
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

/**
 * 标签页管理器
 */
const TabManager = {
    /**
     * 初始化标签页
     */
    init() {
        this.setupTabSwitching();
    },
    
    /**
     * 设置标签页切换
     */
    setupTabSwitching() {
        // 为所有标签页按钮添加点击事件
        const tabs = document.querySelectorAll('.tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                const tabName = this.getTabName(e.target);
                if (tabName) {
                    this.switchTab(tabName);
                }
            });
        });
    },
    
    /**
     * 获取标签页名称
     */
    getTabName(element) {
        // 从onclick属性中提取标签页名称
        const onclick = element.getAttribute('onclick');
        if (onclick) {
            const match = onclick.match(/switchTab\('([^']+)'\)/);
            return match ? match[1] : null;
        }
        
        // 从data属性中获取
        return element.dataset.tab;
    },
    
    /**
     * 切换标签页
     */
    switchTab(tab) {
        // 隐藏所有标签页
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        
        // 显示当前标签页
        const activeTab = document.querySelector(`[onclick="switchTab('${tab}')"]`) || 
                         document.querySelector(`[data-tab="${tab}"]`);
        if (activeTab) {
            activeTab.classList.add('active');
        }
        
        const activeContent = document.getElementById(tab + '-tab');
        if (activeContent) {
            activeContent.classList.add('active');
        }
        
        // 隐藏结果
        hideResult();
    }
};

/**
 * 全局切换标签页函数（保持向后兼容性）
 */
window.switchTab = function(tab) {
    TabManager.switchTab(tab);
};