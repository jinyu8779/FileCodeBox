// Package config 上传下载配置模块
package config

import (
	"fmt"
	"strings"
)

// UploadConfig 上传配置
type UploadConfig struct {
	OpenUpload         int    `json:"open_upload"`                                            // 是否开启上传 0-禁用 1-启用
	UploadSize         int64  `json:"upload_size"`                                            // 上传文件大小限制（字节）
	EnableChunk        int    `json:"enable_chunk"`                                           // 是否启用分片上传 0-禁用 1-启用
	ChunkSize          int64  `json:"chunk_size"`                                             // 分片大小（字节）
	MaxSaveSeconds     int    `json:"max_save_seconds"`                                       // 最大保存时间（秒）
	RequireLogin       int    `json:"require_login"`                                          // 上传是否强制登录 0-否 1-是
	MaxFolderFiles     int    `json:"max_folder_files" yaml:"max_folder_files"`                 // 文件夹内最大文件数，0=不限制
	ShareResponseType  string `json:"share_response_type" yaml:"share_response_type"`         // code=提取码 / url=完整下载地址
	DefaultExpireValue int    `json:"default_expire_value" yaml:"default_expire_value"` // 默认过期值
	DefaultExpireStyle string `json:"default_expire_style" yaml:"default_expire_style"` // 默认过期样式
	AllowModifyExpire  *int   `json:"allow_modify_expire" yaml:"allow_modify_expire"`   // 是否允许上传者修改过期时间 0-否 1-是；nil=默认允许
}

// DownloadConfig 下载配置
type DownloadConfig struct {
	EnableConcurrentDownload int `json:"enable_concurrent_download"` // 是否启用并发下载
	MaxConcurrentDownloads   int `json:"max_concurrent_downloads"`   // 最大并发下载数
	DownloadTimeout          int `json:"download_timeout"`           // 下载超时时间(秒)
	RequireLogin             int `json:"require_login"`              // 下载是否强制登录 0-否 1-是
}

// TransferConfig 文件传输配置（包含上传和下载）
type TransferConfig struct {
	Upload   *UploadConfig   `json:"upload"`
	Download *DownloadConfig `json:"download"`
}

// NewUploadConfig 创建上传配置
func NewUploadConfig() *UploadConfig {
	allowModify := 1
	return &UploadConfig{
		OpenUpload:         1,
		UploadSize:         10 * 1024 * 1024, // 10MB
		EnableChunk:        0,
		ChunkSize:          2 * 1024 * 1024, // 2MB
		MaxSaveSeconds:     0,               // 0表示不限制
		RequireLogin:       0,
		MaxFolderFiles:     100, // 默认最多 100 个文件
		ShareResponseType:  "code",
		DefaultExpireValue: 1,
		DefaultExpireStyle: "day",
		AllowModifyExpire:  &allowModify, // 默认允许上传者修改
	}
}

// NewDownloadConfig 创建下载配置
func NewDownloadConfig() *DownloadConfig {
	return &DownloadConfig{
		EnableConcurrentDownload: 1,   // 默认启用
		MaxConcurrentDownloads:   10,  // 最大10个并发
		DownloadTimeout:          300, // 5分钟超时
		RequireLogin:             0,
	}
}

// NewTransferConfig 创建传输配置
func NewTransferConfig() *TransferConfig {
	return &TransferConfig{
		Upload:   NewUploadConfig(),
		Download: NewDownloadConfig(),
	}
}

// Validate 验证上传配置
func (uc *UploadConfig) Validate() error {
	var errors []string

	// 验证上传大小限制
	if uc.UploadSize < 0 {
		errors = append(errors, "上传文件大小限制不能为负数")
	}
	if uc.UploadSize > 10*1024*1024*1024 { // 10GB
		errors = append(errors, "上传文件大小限制不能超过10GB")
	}

	// 验证分片大小
	if uc.EnableChunk == 1 {
		if uc.ChunkSize < 1024*1024 { // 1MB最小分片
			errors = append(errors, "分片大小不能小于1MB")
		}
		if uc.ChunkSize > 100*1024*1024 { // 100MB最大分片
			errors = append(errors, "分片大小不能超过100MB")
		}
		if uc.ChunkSize > uc.UploadSize {
			errors = append(errors, "分片大小不能超过上传文件大小限制")
		}
	}

	// 验证保存时间
	if uc.MaxSaveSeconds < 0 {
		errors = append(errors, "最大保存时间不能为负数")
	}

	if uc.RequireLogin != 0 && uc.RequireLogin != 1 {
		errors = append(errors, "上传登录开关只能是0或1")
	}

	if uc.MaxFolderFiles < 0 {
		errors = append(errors, "文件夹文件数上限不能为负数")
	}
	if uc.MaxFolderFiles > 100000 {
		errors = append(errors, "文件夹文件数上限不能超过100000")
	}

	if uc.ShareResponseType == "" {
		uc.ShareResponseType = "code"
	}
	if uc.ShareResponseType != "code" && uc.ShareResponseType != "url" {
		errors = append(errors, "分享返回类型只能是 code 或 url")
	}

	if uc.DefaultExpireStyle == "" {
		uc.DefaultExpireStyle = "day"
	}
	validExpireStyles := map[string]bool{
		"minute": true, "hour": true, "day": true, "week": true,
		"month": true, "year": true, "forever": true, "count": true,
	}
	if !validExpireStyles[uc.DefaultExpireStyle] {
		errors = append(errors, "默认过期样式无效")
	}
	if uc.DefaultExpireValue == 0 && uc.DefaultExpireStyle != "forever" {
		uc.DefaultExpireValue = 1 // 兼容旧配置未设置该字段
	}
	if uc.DefaultExpireValue < 0 || (uc.DefaultExpireStyle != "forever" && uc.DefaultExpireValue == 0) {
		errors = append(errors, "默认过期值无效")
	}
	if uc.AllowModifyExpire != nil && *uc.AllowModifyExpire != 0 && *uc.AllowModifyExpire != 1 {
		errors = append(errors, "允许修改过期时间开关只能是0或1")
	}

	if len(errors) > 0 {
		return fmt.Errorf("上传配置验证失败: %s", strings.Join(errors, "; "))
	}

	return nil
}

// Validate 验证下载配置
func (dc *DownloadConfig) Validate() error {
	var errors []string

	// 验证并发下载数
	if dc.MaxConcurrentDownloads < 1 {
		errors = append(errors, "最大并发下载数必须大于0")
	}
	if dc.MaxConcurrentDownloads > 100 {
		errors = append(errors, "最大并发下载数不能超过100")
	}

	// 验证下载超时时间
	if dc.DownloadTimeout < 30 {
		errors = append(errors, "下载超时时间不能小于30秒")
	}
	if dc.DownloadTimeout > 3600 {
		errors = append(errors, "下载超时时间不能超过1小时")
	}

	if dc.RequireLogin != 0 && dc.RequireLogin != 1 {
		errors = append(errors, "下载登录开关只能是0或1")
	}

	if len(errors) > 0 {
		return fmt.Errorf("下载配置验证失败: %s", strings.Join(errors, "; "))
	}

	return nil
}

// Validate 验证传输配置
func (tc *TransferConfig) Validate() error {
	if err := tc.Upload.Validate(); err != nil {
		return err
	}
	return tc.Download.Validate()
}

// IsUploadEnabled 判断是否启用上传
func (uc *UploadConfig) IsUploadEnabled() bool {
	return uc.OpenUpload == 1
}

// IsChunkEnabled 判断是否启用分片上传
func (uc *UploadConfig) IsChunkEnabled() bool {
	return uc.EnableChunk == 1
}

// IsLoginRequired 判断是否需要登录才能上传
func (uc *UploadConfig) IsLoginRequired() bool {
	return uc.RequireLogin == 1
}

// IsModifyExpireAllowed 是否允许上传者修改过期时间（未配置时默认允许）
func (uc *UploadConfig) IsModifyExpireAllowed() bool {
	if uc.AllowModifyExpire == nil {
		return true
	}
	return *uc.AllowModifyExpire == 1
}

// GetAllowModifyExpire 对外暴露 0/1（nil 视为 1）
func (uc *UploadConfig) GetAllowModifyExpire() int {
	if uc.IsModifyExpireAllowed() {
		return 1
	}
	return 0
}

// SetAllowModifyExpire 设置是否允许修改过期时间
func (uc *UploadConfig) SetAllowModifyExpire(allow bool) {
	v := 0
	if allow {
		v = 1
	}
	uc.AllowModifyExpire = &v
}

// GetDefaultExpireValue 获取默认过期值
func (uc *UploadConfig) GetDefaultExpireValue() int {
	if uc.DefaultExpireValue > 0 || uc.DefaultExpireStyle == "forever" {
		return uc.DefaultExpireValue
	}
	return 1
}

// GetDefaultExpireStyle 获取默认过期样式
func (uc *UploadConfig) GetDefaultExpireStyle() string {
	if uc.DefaultExpireStyle == "" {
		return "day"
	}
	return uc.DefaultExpireStyle
}

// GetUploadSizeMB 获取上传大小限制（MB）
func (uc *UploadConfig) GetUploadSizeMB() float64 {
	return float64(uc.UploadSize) / (1024 * 1024)
}

// GetChunkSizeMB 获取分片大小（MB）
func (uc *UploadConfig) GetChunkSizeMB() float64 {
	return float64(uc.ChunkSize) / (1024 * 1024)
}

// GetMaxSaveHours 获取最大保存时间（小时）
func (uc *UploadConfig) GetMaxSaveHours() float64 {
	if uc.MaxSaveSeconds == 0 {
		return 0 // 不限制
	}
	return float64(uc.MaxSaveSeconds) / 3600
}

// IsDownloadConcurrentEnabled 判断是否启用并发下载
func (dc *DownloadConfig) IsDownloadConcurrentEnabled() bool {
	return dc.EnableConcurrentDownload == 1
}

// IsLoginRequired 判断是否需要登录才能下载
func (dc *DownloadConfig) IsLoginRequired() bool {
	return dc.RequireLogin == 1
}

// GetDownloadTimeoutMinutes 获取下载超时时间（分钟）
func (dc *DownloadConfig) GetDownloadTimeoutMinutes() float64 {
	return float64(dc.DownloadTimeout) / 60
}

// Clone 克隆上传配置
func (uc *UploadConfig) Clone() *UploadConfig {
	cloned := &UploadConfig{
		OpenUpload:         uc.OpenUpload,
		UploadSize:         uc.UploadSize,
		EnableChunk:        uc.EnableChunk,
		ChunkSize:          uc.ChunkSize,
		MaxSaveSeconds:     uc.MaxSaveSeconds,
		RequireLogin:       uc.RequireLogin,
		MaxFolderFiles:     uc.MaxFolderFiles,
		ShareResponseType:  uc.ShareResponseType,
		DefaultExpireValue: uc.DefaultExpireValue,
		DefaultExpireStyle: uc.DefaultExpireStyle,
	}
	if uc.AllowModifyExpire != nil {
		v := *uc.AllowModifyExpire
		cloned.AllowModifyExpire = &v
	}
	return cloned
}

// Clone 克隆下载配置
func (dc *DownloadConfig) Clone() *DownloadConfig {
	return &DownloadConfig{
		EnableConcurrentDownload: dc.EnableConcurrentDownload,
		MaxConcurrentDownloads:   dc.MaxConcurrentDownloads,
		DownloadTimeout:          dc.DownloadTimeout,
		RequireLogin:             dc.RequireLogin,
	}
}

// Clone 克隆传输配置
func (tc *TransferConfig) Clone() *TransferConfig {
	return &TransferConfig{
		Upload:   tc.Upload.Clone(),
		Download: tc.Download.Clone(),
	}
}
