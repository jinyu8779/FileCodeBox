package storage

import (
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

const (
	// ShareDownloadPath 分享下载路径
	ShareDownloadPath = "/share/download"
)

// LocalStorageStrategy 本地存储策略实现
type LocalStorageStrategy struct {
	basePath string
}

// NewLocalStorageStrategy 创建本地存储策略
func NewLocalStorageStrategy(basePath string) *LocalStorageStrategy {
	if basePath == "" {
		basePath = "./data"
	}

	// 确保目录存在
	if err := os.MkdirAll(basePath, 0750); err != nil {
		// 记录错误但不阻止创建策略实例，在后续操作中再次尝试创建目录
		_ = err // 忽略错误，避免空分支警告
	}

	return &LocalStorageStrategy{
		basePath: basePath,
	}
}

// WriteFile 写入文件
func (ls *LocalStorageStrategy) WriteFile(path string, data []byte) error {
	// 确保目录存在
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0750); err != nil {
		return err
	}

	return os.WriteFile(path, data, 0600)
}

// ReadFile 读取文件
func (ls *LocalStorageStrategy) ReadFile(path string) ([]byte, error) {
	return os.ReadFile(path)
}

// resolveLocalPath 将相对路径解析为实际存在的本地路径
func (ls *LocalStorageStrategy) resolveLocalPath(path string) string {
	if path == "" {
		return path
	}
	if _, err := os.Stat(path); err == nil {
		return path
	}
	if !filepath.IsAbs(path) && ls.basePath != "" {
		underBase := filepath.Join(ls.basePath, path)
		if _, err := os.Stat(underBase); err == nil {
			return underBase
		}
	}
	return path
}

// DeleteFile 删除文件
func (ls *LocalStorageStrategy) DeleteFile(path string) error {
	resolved := ls.resolveLocalPath(path)
	info, err := os.Stat(resolved)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if info.IsDir() {
		return os.RemoveAll(resolved)
	}
	return os.Remove(resolved)
}

// FileExists 检查文件是否存在
func (ls *LocalStorageStrategy) FileExists(path string) bool {
	if path == "" {
		return false
	}
	// 绝对路径或相对 cwd
	if _, err := os.Stat(path); err == nil {
		return true
	}
	// 相对路径再按 basePath 拼一次
	if !filepath.IsAbs(path) && ls.basePath != "" {
		if _, err := os.Stat(filepath.Join(ls.basePath, path)); err == nil {
			return true
		}
	}
	return false
}

// SaveUploadFile 保存上传的文件
func (ls *LocalStorageStrategy) SaveUploadFile(file *multipart.FileHeader, savePath string) error {
	// 确保目录存在
	dir := filepath.Dir(savePath)
	if err := os.MkdirAll(dir, 0750); err != nil {
		return fmt.Errorf("创建目录失败: %w", err)
	}

	// 打开源文件
	src, err := file.Open()
	if err != nil {
		return fmt.Errorf("打开上传文件失败: %w", err)
	}
	defer func() {
		if cerr := src.Close(); cerr != nil {
			logrus.WithError(cerr).Warn("local storage: failed to close source file")
		}
	}()

	// 创建目标文件
	dst, err := os.Create(savePath)
	if err != nil {
		return fmt.Errorf("创建目标文件失败: %w", err)
	}
	defer func() {
		if cerr := dst.Close(); cerr != nil {
			logrus.WithError(cerr).Warn("local storage: failed to close destination file")
		}
	}()

	// 复制文件内容
	_, err = io.Copy(dst, src)
	if err != nil {
		return fmt.Errorf("复制文件内容失败: %w", err)
	}

	return nil
}

// ServeFile 提供文件下载服务
func (ls *LocalStorageStrategy) ServeFile(c *gin.Context, filePath string, fileName string) error {
	// 检查文件是否存在
	if !ls.FileExists(filePath) {
		return fmt.Errorf("文件不存在: %s", filePath)
	}

	// 预览模式（inline）便于 <video>/<img> 流式播放；默认仍为附件下载
	disposition := "attachment"
	if c.Query("preview") == "1" || c.Query("inline") == "1" {
		disposition = "inline"
	}
	safeName := strings.ReplaceAll(fileName, `"`, "")
	c.Header("Content-Disposition", fmt.Sprintf(`%s; filename="%s"`, disposition, safeName))

	// 显式 Content-Type，避免部分环境把视频当成 octet-stream 导致无法播放
	if ctype := contentTypeByName(fileName); ctype != "" {
		c.Header("Content-Type", ctype)
	} else if ctype := contentTypeByName(filePath); ctype != "" {
		c.Header("Content-Type", ctype)
	}

	c.File(filePath)
	return nil
}

func contentTypeByName(name string) string {
	ext := strings.ToLower(filepath.Ext(name))
	if ext == "" {
		return ""
	}
	if ctype := mime.TypeByExtension(ext); ctype != "" {
		return ctype
	}
	// 常见类型兜底（部分精简系统 mime 库不全）
	switch ext {
	case ".mp4", ".m4v":
		return "video/mp4"
	case ".webm":
		return "video/webm"
	case ".ogg", ".ogv":
		return "video/ogg"
	case ".mov":
		return "video/quicktime"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".svg":
		return "image/svg+xml"
	default:
		return ""
	}
}

// GenerateFileURL 生成文件URL
func (ls *LocalStorageStrategy) GenerateFileURL(filePath string, fileName string) (string, error) {
	return ShareDownloadPath, nil
}

// TestConnection 测试本地存储连接
func (ls *LocalStorageStrategy) TestConnection() error {
	// 测试是否可以在基础路径下创建和删除文件
	testFile := filepath.Join(ls.basePath, ".test_connection")

	// 尝试写入测试文件
	if err := os.WriteFile(testFile, []byte("test"), 0600); err != nil {
		return fmt.Errorf("无法写入测试文件: %v", err)
	}

	// 清理测试文件
	if err := os.Remove(testFile); err != nil {
		return fmt.Errorf("无法删除测试文件: %v", err)
	}

	return nil
}
