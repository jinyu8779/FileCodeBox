#!/bin/bash

# 简化的交叉编译测试脚本

set -e

echo "🚀 测试交叉编译功能..."

# 项目根目录
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# 定义测试平台（只构建几个平台进行测试）
PLATFORMS=(
    "linux/amd64"
    "darwin/arm64"
    "windows/amd64"
)

# 创建输出目录
OUTPUT_DIR="test-dist"
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

echo "📦 开始构建测试平台..."

for platform in "${PLATFORMS[@]}"; do
    IFS='/' read -r os arch <<< "$platform"
    
    echo "  构建 $os/$arch..."
    
    binary_name="filecodebox-test-${os}-${arch}"
    if [ "$os" = "windows" ]; then
        binary_name="${binary_name}.exe"
    fi
    
    output_path="$OUTPUT_DIR/$binary_name"
    
    # 交叉编译（产物名为 filecodebox_GOOS_GOARCH[.exe]）
    env GOOS="$os" GOARCH="$arch" make build-cross
    built="filecodebox_${os}_${arch}"
    if [ "$os" = "windows" ]; then
        built="${built}.exe"
    fi
    if [ -f "$built" ]; then
        mv "$built" "$output_path"
    fi

    if [ -f "$output_path" ]; then
        size=$(ls -lh "$output_path" | awk '{print $5}')
        echo "    ✅ $os/$arch 构建成功 ($size)"
    else
        echo "    ❌ $os/$arch 构建失败"
    fi
done

echo
echo "📋 构建结果:"
ls -lh "$OUTPUT_DIR"

echo
echo "🎉 交叉编译测试完成!"
