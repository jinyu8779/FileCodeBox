package storage

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/zy84338719/filecodebox/internal/models"
)

func TestDeleteFileResolvesLegacyUploadsPath(t *testing.T) {
	tmp := t.TempDir()
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(cwd)
	})
	if err := os.Chdir(tmp); err != nil {
		t.Fatal(err)
	}

	// 数据目录与历史上的 cwd/uploads 分离
	dataDir := filepath.Join(tmp, "data")
	if err := os.MkdirAll(dataDir, 0o750); err != nil {
		t.Fatal(err)
	}
	legacyDir := filepath.Join(tmp, "uploads")
	if err := os.MkdirAll(legacyDir, 0o750); err != nil {
		t.Fatal(err)
	}

	fileName := "Ab12Cd34-demo.txt"
	legacyPath := filepath.Join(legacyDir, fileName)
	if err := os.WriteFile(legacyPath, []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}

	pm := NewPathManager(dataDir)
	strategy := NewLocalStorageStrategy(dataDir)
	op := NewStorageOperator(strategy, pm)

	fileCode := &models.FileCode{
		FilePath:     "uploads",
		UUIDFileName: fileName,
	}

	if err := op.DeleteFile(fileCode); err != nil {
		t.Fatalf("DeleteFile returned error: %v", err)
	}
	if _, err := os.Stat(legacyPath); !os.IsNotExist(err) {
		t.Fatalf("legacy upload file still exists at %s", legacyPath)
	}
}

func TestSaveFileUsesDataPath(t *testing.T) {
	tmp := t.TempDir()
	dataDir := filepath.Join(tmp, "data")
	if err := os.MkdirAll(dataDir, 0o750); err != nil {
		t.Fatal(err)
	}

	pm := NewPathManager(dataDir)
	strategy := NewLocalStorageStrategy(dataDir)
	op := NewStorageOperator(strategy, pm)

	// 直接写入校验 resolve/Save 路径拼装
	targetRel := filepath.Join("uploads", "save-test.txt")
	full := pm.GetFullPath(targetRel)
	if err := os.MkdirAll(filepath.Dir(full), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}

	fileCode := &models.FileCode{
		FilePath:     "uploads",
		UUIDFileName: "save-test.txt",
	}
	resolved, ok := op.resolvePhysicalPath(fileCode.GetFilePath())
	if !ok {
		t.Fatal("expected file to resolve under data path")
	}
	if resolved != full {
		t.Fatalf("resolved=%s want=%s", resolved, full)
	}
}

func TestDeleteFileFindsDateLayoutByFileName(t *testing.T) {
	tmp := t.TempDir()
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(cwd) })
	if err := os.Chdir(tmp); err != nil {
		t.Fatal(err)
	}

	dataDir := filepath.Join(tmp, "data")
	// 故意把文件放在 cwd/uploads/日期目录，而 DB 只记 uploads（路径不一致）
	fileName := "Xy99Test-photo.png"
	actualDir := filepath.Join(tmp, "uploads", "2026", "07", "16")
	if err := os.MkdirAll(actualDir, 0o750); err != nil {
		t.Fatal(err)
	}
	actualPath := filepath.Join(actualDir, fileName)
	if err := os.WriteFile(actualPath, []byte("img"), 0o600); err != nil {
		t.Fatal(err)
	}

	pm := NewPathManager(dataDir)
	strategy := NewLocalStorageStrategy(dataDir)
	op := NewStorageOperator(strategy, pm)

	fileCode := &models.FileCode{
		Code:         "Xy99Test",
		FilePath:     "uploads", // 错误/过时的目录信息
		UUIDFileName: fileName,
	}

	if err := op.DeleteFile(fileCode); err != nil {
		t.Fatalf("DeleteFile returned error: %v", err)
	}
	if _, err := os.Stat(actualPath); !os.IsNotExist(err) {
		t.Fatalf("dated upload file still exists at %s", actualPath)
	}
}
