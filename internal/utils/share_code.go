package utils

import (
	"net/url"
	"regexp"
	"strings"
)

var shareCodeQueryPattern = regexp.MustCompile(`(?i)(?:^|[?&#])code=([^&\s#]+)`)

// NormalizeShareCode 从提取码或完整分享/下载 URL 中解析出分享码。
// 支持示例：
//   - 纯提取码：Ab12Cd34
//   - /share/download?code=Ab12Cd34
//   - https://host/share/download?code=Ab12Cd34
//   - /s/Ab12Cd34 或 https://host/s/Ab12Cd34
func NormalizeShareCode(input string) string {
	input = strings.TrimSpace(input)
	if input == "" {
		return ""
	}

	// 去掉包裹引号
	input = strings.Trim(input, `"'`)

	if looksLikeShareURL(input) {
		if code := extractCodeFromURL(input); code != "" {
			return code
		}
	}

	// 纯提取码：去掉尾部多余斜杠/空白
	return strings.Trim(input, "/ \t\r\n")
}

func looksLikeShareURL(input string) bool {
	lower := strings.ToLower(input)
	return strings.Contains(input, "://") ||
		strings.HasPrefix(input, "/") ||
		strings.Contains(lower, "share/download") ||
		strings.Contains(lower, "/s/") ||
		strings.Contains(lower, "?code=") ||
		strings.Contains(lower, "&code=")
}

func extractCodeFromURL(input string) string {
	raw := input
	switch {
	case strings.HasPrefix(raw, "//"):
		raw = "http:" + raw
	case strings.HasPrefix(raw, "/"):
		raw = "http://local.invalid" + raw
	case !strings.Contains(raw, "://"):
		// host/path?code=xx 或 纯 query
		if strings.Contains(raw, "/") || strings.Contains(raw, "?") {
			raw = "http://" + raw
		}
	}

	if u, err := url.Parse(raw); err == nil {
		if code := strings.TrimSpace(u.Query().Get("code")); code != "" {
			return code
		}
		parts := strings.Split(strings.Trim(u.Path, "/"), "/")
		for i := 0; i < len(parts); i++ {
			part := strings.ToLower(parts[i])
			if part == "s" && i+1 < len(parts) {
				return strings.TrimSpace(parts[i+1])
			}
			if part == "share" && i+1 < len(parts) {
				next := strings.ToLower(parts[i+1])
				// 跳过已知业务路径段
				switch next {
				case "download", "select", "file", "text", "chunk":
					continue
				default:
					return strings.TrimSpace(parts[i+1])
				}
			}
		}
	}

	if m := shareCodeQueryPattern.FindStringSubmatch(input); len(m) > 1 {
		code, err := url.QueryUnescape(m[1])
		if err != nil {
			return strings.TrimSpace(m[1])
		}
		return strings.TrimSpace(code)
	}

	return ""
}
