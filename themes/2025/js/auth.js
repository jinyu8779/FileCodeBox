// 用户认证模块 - 处理用户登录、登出、认证状态管理

/**
 * 用户认证管理器
 */
const UserAuth = {
    // 用户令牌key
    TOKEN_KEY: 'user_token',
    USER_INFO_KEY: 'user_info',
    
    /**
     * 获取用户令牌
     * @returns {string|null} 用户令牌
     */
    getToken() {
        return localStorage.getItem(this.TOKEN_KEY);
    },
    
    /**
     * 设置用户令牌
     * @param {string} token 用户令牌
     */
    setToken(token) {
        localStorage.setItem(this.TOKEN_KEY, token);
    },
    
    /**
     * 移除用户令牌
     */
    removeToken() {
        localStorage.removeItem(this.TOKEN_KEY);
    },
    
    /**
     * 获取用户信息
     * @returns {Object|null} 用户信息
     */
    getUserInfo() {
        const userInfo = localStorage.getItem(this.USER_INFO_KEY);
        return userInfo ? JSON.parse(userInfo) : null;
    },
    
    /**
     * 设置用户信息
     * @param {Object} userInfo 用户信息
     */
    setUserInfo(userInfo) {
        localStorage.setItem(this.USER_INFO_KEY, JSON.stringify(userInfo));
    },
    
    /**
     * 移除用户信息
     */
    removeUserInfo() {
        localStorage.removeItem(this.USER_INFO_KEY);
    },
    
    /**
     * 检查用户是否已登录
     * @returns {boolean} 是否已登录
     */
    isLoggedIn() {
        return !!(this.getToken() && this.getUserInfo());
    },
    
    /**
     * 获取认证头
     * @returns {Object} 认证头对象
     */
    getAuthHeaders() {
        const token = this.getToken();
        const headers = {
            'Content-Type': 'application/json'
        };
        
        if (token) {
            headers['Authorization'] = 'Bearer ' + token;
        }
        
        return headers;
    },
    
    /**
     * 退出登录
     */
    async logout() {
        try {
            const token = this.getToken();
            if (token) {
                await fetch('/user/logout', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + token
                    }
                });
            }
        } catch (error) {
            console.error('退出登录失败:', error);
        }
        
        this.removeToken();
        this.removeUserInfo();
        this.updateUI();
    },
    
    /**
     * 更新用户界面
     */
    updateUI() {
        const guestLinks = document.getElementById('guest-links');
        const userLoggedIn = document.getElementById('user-logged-in');
        const userNameElement = document.getElementById('user-name');
        const userAvatarElement = document.getElementById('user-avatar');
        
        if (!guestLinks || !userLoggedIn) return;
        
        if (this.isLoggedIn()) {
            const userInfo = this.getUserInfo();
            // 显示已登录状态
            guestLinks.style.display = 'none';
            userLoggedIn.style.display = 'block';
            
            // 更新用户信息显示
            if (userNameElement && userInfo) {
                userNameElement.textContent = userInfo.nickname || userInfo.username;
            }
            if (userAvatarElement && userInfo) {
                userAvatarElement.textContent = (userInfo.nickname || userInfo.username).charAt(0).toUpperCase();
            }
        } else {
            // 显示未登录状态
            guestLinks.style.display = 'flex';
            userLoggedIn.style.display = 'none';
            // 若允许匿名上传，继续隐藏登录按钮
            if (typeof UserSystem !== 'undefined' && UserSystem.applyAnonymousUploadUI) {
                UserSystem.applyAnonymousUploadUI();
            }
        }
    }
};

/**
 * 用户系统管理器
 */
const UserSystem = {
    // 上传是否强制登录：1=需要登录，0=允许匿名上传
    requireLoginUpload: null,

    /**
     * 加载上传登录策略
     */
    async loadUploadAuthPolicy() {
        try {
            const response = await fetch('/api/config');
            const result = await response.json();
            if (result.code === 200 && result.data) {
                this.requireLoginUpload = result.data.requireLogin === 1 ? 1 : 0;
            }
        } catch (e) {
            console.warn('加载上传登录策略失败:', e);
            this.requireLoginUpload = null;
        }
    },

    /**
     * 允许匿名上传时隐藏「登录」入口，避免误导操作人员
     */
    applyAnonymousUploadUI() {
        const guestLinks = document.getElementById('guest-links');
        const loginLink = guestLinks ? guestLinks.querySelector('.login') : null;

        // 允许匿名上传且当前未登录：隐藏登录按钮
        if (this.requireLoginUpload === 0 && !UserAuth.isLoggedIn()) {
            if (loginLink) {
                loginLink.style.display = 'none';
            }
            // 同时不展示注册入口（匿名场景不需要引导登录/注册）
            const registerLink = guestLinks ? guestLinks.querySelector('.register') : null;
            if (registerLink) {
                registerLink.style.display = 'none';
            }
            // 若游客区域已无可见链接，整体隐藏
            if (guestLinks) {
                const visible = Array.from(guestLinks.querySelectorAll('a')).some(
                    (el) => el.style.display !== 'none'
                );
                guestLinks.style.display = visible ? 'flex' : 'none';
            }
            console.log('允许匿名上传，已隐藏登录按钮');
            return;
        }

        // 需要登录才能上传，或已登录：恢复登录按钮可见性（注册仍由 allow_user_registration 控制）
        if (loginLink) {
            loginLink.style.display = '';
        }
        if (guestLinks && !UserAuth.isLoggedIn()) {
            guestLinks.style.display = 'flex';
        }
    },

    /**
     * 检查用户系统是否启用
     * @returns {Promise<boolean>} 是否启用用户系统
     */
    async checkSystemStatus() {
        try {
            const response = await fetch('/user/system-info');
            const result = await response.json();
            
            if (result.code === 200) {
                const systemEnabled = result.data.user_system_enabled;
                const userLinksContainer = document.getElementById('user-links');
                
                if (!systemEnabled) {
                    // 用户系统未启用，隐藏整个用户链接区域
                    if (userLinksContainer) {
                        userLinksContainer.style.display = 'none';
                    }
                    console.log('用户系统已禁用，隐藏登录入口');
                } else {
                    // 用户系统已启用，显示用户链接区域
                    if (userLinksContainer) {
                        userLinksContainer.style.display = 'block';
                    }
                    console.log('用户系统已启用');
                    
                    // 检查是否允许注册，动态显示注册链接
                    // 后端使用 0/1 表示开关，严格比较为 1
                    const allowRegistration = result.data.allow_user_registration === 1;
                    const guestLinks = document.getElementById('guest-links');
                    
                    if (guestLinks) {
                        if (allowRegistration) {
                            // 如果允许注册且还没有注册链接，添加注册链接
                            if (!guestLinks.querySelector('.register')) {
                                const registerLink = document.createElement('a');
                                registerLink.href = '/user/register';
                                registerLink.className = 'user-link register';
                                registerLink.textContent = '注册';
                                guestLinks.appendChild(registerLink);
                                console.log('用户注册已启用，显示注册入口');
                            }
                        } else {
                            // 如果不允许注册，移除注册链接
                            const registerLink = guestLinks.querySelector('.register');
                            if (registerLink) {
                                registerLink.remove();
                                console.log('用户注册已禁用，隐藏注册入口');
                            }
                        }
                    }
                }
                
                return systemEnabled;
            } else {
                console.warn('获取用户系统状态失败:', result.message);
                // 如果无法获取状态，默认显示登录链接（保持兼容性）
                return true;
            }
        } catch (error) {
            console.error('检查用户系统状态失败:', error);
            // 网络错误时默认显示登录链接
            return true;
        }
    },
    
    /**
     * 初始化用户系统
     */
    async init() {
        // 先检查用户系统是否启用
        const systemEnabled = await this.checkSystemStatus();
        
        // 只有在用户系统启用时才检查登录状态
        if (systemEnabled) {
            UserAuth.updateUI();
            this.setupDropdownEvents();
            // 匿名上传场景下隐藏登录按钮
            await this.loadUploadAuthPolicy();
            this.applyAnonymousUploadUI();
        }
    },
    
    /**
     * 设置下拉菜单事件
     */
    setupDropdownEvents() {
        const dropdown = document.querySelector('.dropdown');
        const dropdownContent = document.querySelector('.dropdown-content');
        
        if (!dropdown || !dropdownContent) return;
        
        let dropdownTimer = null;
        
        // 鼠标进入下拉菜单区域
        dropdown.addEventListener('mouseenter', function() {
            if (dropdownTimer) {
                clearTimeout(dropdownTimer);
                dropdownTimer = null;
            }
            dropdownContent.classList.add('show');
        });
        
        // 鼠标离开下拉菜单区域
        dropdown.addEventListener('mouseleave', function() {
            // 设置延迟隐藏，给用户时间移动到菜单项
            dropdownTimer = setTimeout(function() {
                dropdownContent.classList.remove('show');
            }, 200); // 200ms延迟
        });
        
        // 鼠标进入下拉菜单内容区域
        dropdownContent.addEventListener('mouseenter', function() {
            if (dropdownTimer) {
                clearTimeout(dropdownTimer);
                dropdownTimer = null;
            }
        });
        
        // 鼠标离开下拉菜单内容区域
        dropdownContent.addEventListener('mouseleave', function() {
            dropdownTimer = setTimeout(function() {
                dropdownContent.classList.remove('show');
            }, 200); // 200ms延迟
        });
    }
};

/**
 * 全局退出登录函数
 */
window.logout = function() {
    UserAuth.logout();
};

/**
 * 全局跳转到用户中心函数
 */
window.goToUserDashboard = function() {
    window.location.href = '/user/dashboard';
};