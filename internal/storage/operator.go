package storage

import (
	"errors"
	"fmt"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"

	"github.com/zy84338719/filecodebox/internal/common"
	"github.com/zy84338719/filecodebox/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

// ErrPhysicalFileNotFound 表示数据库有记录但物理文件未找到
var ErrPhysicalFileNotFound = errors.New("physical file not found")

// StorageStrategy 存储策略接口 - 定义每个存储后端的差异化操作
type StorageStrategy interface {
	// 基础文件操作
	WriteFile(path string, data []byte) error
	ReadFile(path string) ([]byte, error)
	DeleteFile(path string) error
	FileExists(path string) bool

	// 上传文件操作
	SaveUploadFile(file *multipart.FileHeader, savePath string) error

	// 下载操作
	ServeFile(c *gin.Context, filePath string, fileName string) error
	GenerateFileURL(filePath string, fileName string) (string, error)

	// 连接测试
	TestConnection() error
}

// StorageOperator 通用存储操作器 - 包含公共逻辑
type StorageOperator struct {
	strategy    StorageStrategy
	pathManager *PathManager
}

// NewStorageOperator 创建存储操作器
func NewStorageOperator(strategy StorageStrategy, pathManager *PathManager) *StorageOperator {
	return &StorageOperator{
		strategy:    strategy,
		pathManager: pathManager,
	}
}

func (so *StorageOperator) uploadSearchRoots() []string {
	roots := make([]string, 0, 6)
	seen := map[string]bool{}
	add := func(p string) {
		p = filepath.Clean(p)
		if p == "" || p == "." || seen[p] {
			return
		}
		seen[p] = true
		roots = append(roots, p)
	}

	base := ""
	if so.pathManager != nil {
		base = so.pathManager.basePath
	}
	if base != "" {
		add(filepath.Join(base, "uploads"))
		add(base)
	}
	add("uploads")
	if abs, err := filepath.Abs("uploads"); err == nil {
		add(abs)
	}
	if cwd, err := os.Getwd(); err == nil {
		add(filepath.Join(cwd, "uploads"))
		add(filepath.Join(cwd, "data", "uploads"))
	}
	return roots
}

// resolvePhysicalPath 解析物理路径：优先 data 目录，再兼容历史相对路径
func (so *StorageOperator) resolvePhysicalPath(relativePath string) (string, bool) {
	if relativePath == "" {
		return "", false
	}

	rel := filepath.Clean(relativePath)
	candidates := make([]string, 0, 8)
	add := func(p string) {
		if p == "" {
			return
		}
		candidates = append(candidates, filepath.Clean(p))
	}

	if filepath.IsAbs(rel) {
		add(rel)
	} else {
		add(so.pathManager.GetFullPath(rel))
		add(rel)
		if abs, err := filepath.Abs(rel); err == nil {
			add(abs)
		}
		// 兼容仅文件名或目录层级不一致
		baseName := filepath.Base(rel)
		for _, root := range so.uploadSearchRoots() {
			add(filepath.Join(root, baseName))
			add(filepath.Join(root, rel))
			// rel 已含 uploads/ 前缀时，避免 uploads/uploads/...
			if strings.HasPrefix(rel, "uploads"+string(os.PathSeparator)) || strings.HasPrefix(rel, "uploads/") {
				add(filepath.Join(filepath.Dir(root), rel))
				add(filepath.Join(root, strings.TrimPrefix(strings.TrimPrefix(rel, "uploads/"), "uploads"+string(os.PathSeparator))))
			}
		}
	}

	seen := map[string]bool{}
	for _, path := range candidates {
		if seen[path] {
			continue
		}
		seen[path] = true
		if so.strategy.FileExists(path) {
			return path, true
		}
	}

	if filepath.IsAbs(rel) {
		return rel, false
	}
	return so.pathManager.GetFullPath(rel), false
}

// findPhysicalFileByName 在 uploads 相关目录中按文件名递归查找
func (so *StorageOperator) findPhysicalFileByName(fileName string) (string, bool) {
	fileName = strings.TrimSpace(fileName)
	if fileName == "" || fileName == "." || fileName == ".." {
		return "", false
	}

	for _, root := range so.uploadSearchRoots() {
		info, err := os.Stat(root)
		if err != nil || !info.IsDir() {
			continue
		}
		var found string
		_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
			if err != nil || d == nil {
				return nil
			}
			if d.IsDir() {
				return nil
			}
			if d.Name() == fileName {
				found = path
				return filepath.SkipAll
			}
			return nil
		})
		if found != "" {
			return found, true
		}
	}
	return "", false
}

// SaveFile 保存文件 - 公共逻辑
func (so *StorageOperator) SaveFile(file *multipart.FileHeader, savePath string) error {
	fullPath := savePath
	if !filepath.IsAbs(savePath) {
		fullPath = so.pathManager.GetFullPath(savePath)
	}
	return so.strategy.SaveUploadFile(file, fullPath)
}

// SaveChunk 保存分片 - 公共逻辑
func (so *StorageOperator) SaveChunk(uploadID string, chunkIndex int, data []byte, chunkHash string) error {
	chunkPath := so.pathManager.GetChunkPath(uploadID, chunkIndex)
	return so.strategy.WriteFile(chunkPath, data)
}

// MergeChunks 合并分片 - 公共逻辑
func (so *StorageOperator) MergeChunks(uploadID string, chunk *models.UploadChunk, savePath string) error {
	var mergedData []byte

	// 读取并合并所有分片
	for i := 0; i < chunk.TotalChunks; i++ {
		chunkPath := so.pathManager.GetChunkPath(uploadID, i)
		chunkData, err := so.strategy.ReadFile(chunkPath)
		if err != nil {
			return fmt.Errorf("读取分片 %d 失败: %v", i, err)
		}
		mergedData = append(mergedData, chunkData...)
	}

	// 写入合并后的文件
	fullPath := savePath
	if !filepath.IsAbs(savePath) {
		fullPath = so.pathManager.GetFullPath(savePath)
	}
	return so.strategy.WriteFile(fullPath, mergedData)
}

// CleanChunks 清理分片 - 公共逻辑
func (so *StorageOperator) CleanChunks(uploadID string) error {
	chunkDir := so.pathManager.GetChunkDir(uploadID)
	return so.strategy.DeleteFile(chunkDir)
}

// GetFileResponse 获取文件响应 - 公共逻辑
func (so *StorageOperator) GetFileResponse(c *gin.Context, fileCode *models.FileCode) error {
	// 处理文本分享
	if fileCode.Text != "" {
		response := map[string]interface{}{
			"code": fileCode.Code,
			"name": fileCode.Prefix + fileCode.Suffix,
			"size": fileCode.Size,
			"text": fileCode.Text,
		}
		common.SuccessResponse(c, response)
		return nil
	}

	filePath := fileCode.GetFilePath()
	if filePath == "" {
		return fmt.Errorf("文件路径为空")
	}

	fullPath, exists := so.resolvePhysicalPath(filePath)
	if !exists && fileCode.UUIDFileName != "" {
		fullPath, exists = so.findPhysicalFileByName(fileCode.UUIDFileName)
	}
	if !exists {
		return fmt.Errorf("文件不存在")
	}

	// 委托给具体策略处理文件下载
	fileName := fileCode.UUIDFileName
	if fileName == "" {
		// 向后兼容：如果UUIDFileName为空，则使用Prefix + Suffix
		fileName = fileCode.Prefix + fileCode.Suffix
	}
	return so.strategy.ServeFile(c, fullPath, fileName)
}

// GetFileURL 获取文件URL - 公共逻辑
func (so *StorageOperator) GetFileURL(fileCode *models.FileCode) (string, error) {
	if fileCode.Text != "" {
		return fileCode.Text, nil
	}

	filePath := fileCode.GetFilePath()
	fileName := fileCode.Prefix + fileCode.Suffix

	// 对于本地存储，传递相对路径即可；对于其他存储，可能需要完整路径
	return so.strategy.GenerateFileURL(filePath, fileName)
}

// DeleteFile 删除文件 - 公共逻辑
func (so *StorageOperator) DeleteFile(fileCode *models.FileCode) error {
	// 纯文本分享无物理文件
	if fileCode.Text != "" && fileCode.UUIDFileName == "" && fileCode.GetFilePath() == "" {
		return nil
	}

	filePath := fileCode.GetFilePath()
	candidates := make([]string, 0, 4)
	seen := map[string]bool{}
	addCandidate := func(p string, ok bool) {
		if !ok || p == "" || seen[p] {
			return
		}
		seen[p] = true
		candidates = append(candidates, p)
	}

	if filePath != "" {
		if p, ok := so.resolvePhysicalPath(filePath); ok {
			addCandidate(p, true)
		}
	}
	if fileCode.UUIDFileName != "" {
		if p, ok := so.findPhysicalFileByName(fileCode.UUIDFileName); ok {
			addCandidate(p, true)
		}
	}

	if len(candidates) == 0 {
		logrus.WithFields(logrus.Fields{
			"code":           fileCode.Code,
			"file_path":      fileCode.FilePath,
			"uuid_file_name": fileCode.UUIDFileName,
			"resolved":       filePath,
			"roots":          so.uploadSearchRoots(),
		}).Warn("delete: physical file not found in any known uploads location")
		return fmt.Errorf("%w: %s", ErrPhysicalFileNotFound, filePath)
	}

	var lastErr error
	deleted := 0
	for _, path := range candidates {
		if err := so.strategy.DeleteFile(path); err != nil {
			logrus.WithError(err).WithField("path", path).Warn("delete: failed to remove physical file")
			lastErr = err
			continue
		}
		deleted++
		logrus.WithFields(logrus.Fields{
			"code": fileCode.Code,
			"path": path,
		}).Info("delete: physical file removed")
	}

	if deleted == 0 && lastErr != nil {
		return lastErr
	}
	return nil
}
