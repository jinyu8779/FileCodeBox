package handlers

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/zy84338719/filecodebox/internal/common"
	"github.com/zy84338719/filecodebox/internal/config"
	"github.com/zy84338719/filecodebox/internal/models"
	"github.com/zy84338719/filecodebox/internal/models/web"
	"github.com/zy84338719/filecodebox/internal/services/share"
	"github.com/zy84338719/filecodebox/internal/storage"
	"github.com/zy84338719/filecodebox/internal/utils"

	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

// ShareHandler 分享处理器
type ShareHandler struct {
	service *share.Service
}

func NewShareHandler(service *share.Service) *ShareHandler {
	return &ShareHandler{service: service}
}

func (h *ShareHandler) uploadConfig() *config.UploadConfig {
	if h.service == nil {
		return nil
	}
	return h.service.UploadConfig()
}

// buildFullShareURL 构建完整的分享URL（包含协议和域名）
func (h *ShareHandler) buildFullShareURL(c *gin.Context, path string) string {
	protocol := "http"
	if c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https" {
		protocol = "https"
	}

	host := c.Request.Host
	if fwd := c.GetHeader("X-Forwarded-Host"); fwd != "" {
		host = fwd
	}
	return fmt.Sprintf("%s://%s%s", protocol, host, path)
}

// buildShareResponse 按配置生成分享响应（提取码或完整下载地址）
func (h *ShareHandler) buildShareResponse(c *gin.Context, code, shareURL, fileName string, expiredAt *time.Time) web.ShareResponse {
	fullShareURL := h.buildFullShareURL(c, shareURL)
	downloadURL := h.buildFullShareURL(c, fmt.Sprintf("/share/download?code=%s", code))

	responseType := "code"
	if uc := h.uploadConfig(); uc != nil && uc.ShareResponseType == "url" {
		responseType = "url"
	}

	displayValue := code
	qrData := fullShareURL
	if responseType == "url" {
		displayValue = downloadURL
		qrData = downloadURL
	}

	return web.ShareResponse{
		Code:         code,
		ShareURL:     shareURL,
		FileName:     fileName,
		ExpiredAt:    expiredAt,
		FullShareURL: fullShareURL,
		DownloadURL:  downloadURL,
		ResponseType: responseType,
		DisplayValue: displayValue,
		QRCodeData:   qrData,
	}
}

// validateFolderFileCount 校验文件夹上传时的文件数量
func (h *ShareHandler) validateFolderFileCount(c *gin.Context) bool {
	countStr := c.PostForm("folder_file_count")
	if countStr == "" {
		return true
	}
	count, err := strconv.Atoi(countStr)
	if err != nil || count <= 0 {
		return true
	}
	maxFiles := 0
	if uc := h.uploadConfig(); uc != nil {
		maxFiles = uc.MaxFolderFiles
	}
	if maxFiles > 0 && count > maxFiles {
		common.BadRequestResponse(c, fmt.Sprintf("文件夹内文件数量（%d）超过限制（最大 %d 个），不允许上传", count, maxFiles))
		return false
	}
	return true
}

// resolveExpireFromRequest 解析过期参数；不允许修改时强制使用服务端默认
func (h *ShareHandler) resolveExpireFromRequest(c *gin.Context) (utils.ExpireParams, error) {
	expireValueStr := c.PostForm("expire_value")
	expireStyle := c.PostForm("expire_style")
	requireAuthStr := c.DefaultPostForm("require_auth", "false")

	if uc := h.uploadConfig(); uc != nil {
		defValue := strconv.Itoa(uc.GetDefaultExpireValue())
		defStyle := uc.GetDefaultExpireStyle()
		if !uc.IsModifyExpireAllowed() {
			expireValueStr = defValue
			expireStyle = defStyle
		} else {
			if expireValueStr == "" {
				expireValueStr = defValue
			}
			if expireStyle == "" {
				expireStyle = defStyle
			}
		}
	} else {
		if expireValueStr == "" {
			expireValueStr = "1"
		}
		if expireStyle == "" {
			expireStyle = "day"
		}
	}

	return utils.ParseExpireParams(expireValueStr, expireStyle, requireAuthStr)
}

// ShareText 分享文本
// @Summary 分享文本内容
// @Description 分享文本内容并生成分享代码
// @Tags 分享
// @Accept multipart/form-data
// @Produce json
// @Param text formData string true "文本内容"
// @Param expire_value formData int false "过期值" default(1)
// @Param expire_style formData string false "过期样式" default(day) Enums(minute, hour, day, week, month, year, forever)
// @Param require_auth formData boolean false "是否需要认证" default(false)
// @Success 200 {object} map[string]interface{} "分享成功，返回分享代码"
// @Failure 400 {object} map[string]interface{} "请求参数错误"
// @Failure 500 {object} map[string]interface{} "服务器内部错误"
// @Router /share/text/ [post]
func (h *ShareHandler) ShareText(c *gin.Context) {
	text := c.PostForm("text")

	if text == "" {
		common.BadRequestResponse(c, "文本内容不能为空")
		return
	}

	// 解析过期参数（含默认值与是否允许修改）
	expireParams, err := h.resolveExpireFromRequest(c)
	if err != nil {
		common.BadRequestResponse(c, err.Error())
		return
	}

	// 构建请求
	req := web.ShareTextRequest{
		Text:        text,
		ExpireValue: expireParams.ExpireValue,
		ExpireStyle: expireParams.ExpireStyle,
		RequireAuth: expireParams.RequireAuth,
	}

	// 检查是否为认证用户上传
	userID := utils.GetUserIDFromContext(c)

	fileResult, err := h.service.ShareTextWithAuth(req.Text, req.ExpireValue, req.ExpireStyle, userID)
	if err != nil {
		common.BadRequestResponse(c, err.Error())
		return
	}

	response := h.buildShareResponse(c, fileResult.Code, fileResult.ShareURL, "文本分享", fileResult.ExpiredAt)
	common.SuccessWithMessage(c, "分享成功", response)
}

// ShareTextAPI 面向 API Key 用户的文本分享入口
// @Summary 分享文本（API 模式）
// @Description 通过 API Key 分享文本内容
// @Tags API
// @Accept multipart/form-data
// @Produce json
// @Param text formData string true "文本内容"
// @Param expire_value formData int false "过期值" default(1)
// @Param expire_style formData string false "过期样式" default(day) Enums(minute, hour, day, week, month, year, forever)
// @Param require_auth formData boolean false "是否需要认证" default(false)
// @Success 200 {object} map[string]interface{} "分享成功，返回分享代码"
// @Failure 400 {object} map[string]interface{} "请求参数错误"
// @Failure 401 {object} map[string]interface{} "API Key 校验失败"
// @Failure 500 {object} map[string]interface{} "服务器内部错误"
// @Router /api/v1/share/text [post]
// @Security ApiKeyAuth
func (h *ShareHandler) ShareTextAPI(c *gin.Context) {
	h.ShareText(c)
}

// ShareFile 分享文件
// @Summary 分享文件
// @Description 上传并分享文件，生成分享代码
// @Tags 分享
// @Accept multipart/form-data
// @Produce json
// @Param file formData file true "要分享的文件"
// @Param expire_value formData int false "过期值" default(1)
// @Param expire_style formData string false "过期样式" default(day) Enums(minute, hour, day, week, month, year, forever)
// @Param require_auth formData boolean false "是否需要认证" default(false)
// @Success 200 {object} map[string]interface{} "分享成功，返回分享代码和文件信息"
// @Failure 400 {object} map[string]interface{} "请求参数错误"
// @Failure 500 {object} map[string]interface{} "服务器内部错误"
// @Router /share/file/ [post]
func (h *ShareHandler) ShareFile(c *gin.Context) {
	// 文件夹文件数量限制
	if !h.validateFolderFileCount(c) {
		return
	}

	// 解析过期参数（含默认值与是否允许修改）
	expireParams, err := h.resolveExpireFromRequest(c)
	if err != nil {
		common.BadRequestResponse(c, err.Error())
		return
	}

	userID := utils.GetUserIDFromContext(c)
	if h.service.IsUploadLoginRequired() && userID == nil {
		common.UnauthorizedResponse(c, "当前配置要求登录后才能上传文件")
		return
	}

	// 解析文件
	file, success := utils.ParseFileFromForm(c, "file")
	if !success {
		return
	}

	// 构建服务层请求（这里需要适配服务层的接口）
	serviceReq := models.ShareFileRequest{
		File:        file,
		ExpireValue: expireParams.ExpireValue,
		ExpireStyle: expireParams.ExpireStyle,
		RequireAuth: expireParams.RequireAuth,
		ClientIP:    c.ClientIP(),
		UserID:      userID,
	}

	fileResult, err := h.service.ShareFileWithAuth(serviceReq)
	if err != nil {
		common.BadRequestResponse(c, err.Error())
		return
	}

	response := h.buildShareResponse(c, fileResult.Code, fileResult.ShareURL, fileResult.FileName, fileResult.ExpiredAt)
	common.SuccessResponse(c, response)
}

// ShareFileAPI 面向 API Key 用户的文件分享入口
// @Summary 分享文件（API 模式）
// @Description 通过 API Key 上传并分享文件
// @Tags API
// @Accept multipart/form-data
// @Produce json
// @Param file formData file true "要分享的文件"
// @Param expire_value formData int false "过期值" default(1)
// @Param expire_style formData string false "过期样式" default(day) Enums(minute, hour, day, week, month, year, forever)
// @Param require_auth formData boolean false "是否需要认证" default(false)
// @Success 200 {object} map[string]interface{} "分享成功，返回分享代码和文件信息"
// @Failure 400 {object} map[string]interface{} "请求参数错误"
// @Failure 401 {object} map[string]interface{} "API Key 校验失败"
// @Failure 500 {object} map[string]interface{} "服务器内部错误"
// @Router /api/v1/share/file [post]
// @Security ApiKeyAuth
func (h *ShareHandler) ShareFileAPI(c *gin.Context) {
	h.ShareFile(c)
}

// GetFile 获取文件信息
// @Summary 获取分享文件信息
// @Description 根据分享代码获取文件或文本的详细信息
// @Tags 分享
// @Accept json
// @Produce json
// @Param code query string false "分享代码(GET方式)"
// @Param code formData string false "分享代码(POST方式)"
// @Success 200 {object} map[string]interface{} "文件信息"
// @Failure 400 {object} map[string]interface{} "请求参数错误"
// @Failure 404 {object} map[string]interface{} "分享代码不存在"
// @Router /share/select/ [get]
// @Router /share/select/ [post]
func (h *ShareHandler) GetFile(c *gin.Context) {
	var code string

	if c.Request.Method == "GET" {
		code = c.Query("code")
	} else {
		// POST 请求，尝试从JSON解析
		var req web.ShareCodeRequest
		if err := c.ShouldBindJSON(&req); err == nil {
			code = req.Code
		} else {
			// 如果JSON解析失败，尝试从表单获取
			code = c.PostForm("code")
		}
	}

	code = utils.NormalizeShareCode(code)
	if code == "" {
		common.BadRequestResponse(c, "请输入提取码或完整下载地址")
		return
	}

	// 获取用户ID（如果已登录）
	var userID *uint
	if uid, exists := c.Get("user_id"); exists {
		id := uid.(uint)
		userID = &id
	}

	fileCode, err := h.service.GetFileByCodeWithAuth(code, userID)
	if err != nil {
		common.NotFoundResponse(c, err.Error())
		return
	}

	response := web.FileInfoResponse{
		Code:        fileCode.Code,
		Name:        getDisplayFileName(fileCode),
		Size:        fileCode.Size,
		UploadType:  fileCode.UploadType,
		RequireAuth: fileCode.RequireAuth,
	}

	if fileCode.Text != "" {
		// 文本内容直接在查询接口返回，此处计一次使用
		if err := h.service.UpdateFileUsage(fileCode.Code); err != nil {
			logrus.WithError(err).Error("更新文件使用次数失败")
		}
		response.Text = fileCode.Text
	} else {
		// 文件只返回下载链接：查询本身不计次，避免「获取→预览/下载」连扣两次
		// （次数为 1 时会导致视频预览下载失败）
		response.Text = "/share/download?code=" + fileCode.Code
	}

	common.SuccessResponse(c, response)
}

// GetFileAPI 通过 REST 模式查询分享信息（API 模式）
// @Summary 查询分享详情（API 模式）
// @Description 根据分享代码返回分享的文件或文本信息
// @Tags API
// @Produce json
// @Param code path string true "分享代码"
// @Success 200 {object} map[string]interface{} "分享详情"
// @Failure 400 {object} map[string]interface{} "请求参数错误"
// @Failure 401 {object} map[string]interface{} "API Key 校验失败"
// @Failure 404 {object} map[string]interface{} "分享不存在"
// @Router /api/v1/share/{code} [get]
// @Security ApiKeyAuth
func (h *ShareHandler) GetFileAPI(c *gin.Context) {
	code := c.Param("code")
	if code == "" {
		common.BadRequestResponse(c, "文件代码不能为空")
		return
	}

	fileCode, ok := h.lookupFileForRequest(c, code)
	if !ok {
		return
	}

	response := web.FileInfoResponse{
		Code:        fileCode.Code,
		Name:        getDisplayFileName(fileCode),
		Size:        fileCode.Size,
		UploadType:  fileCode.UploadType,
		RequireAuth: fileCode.RequireAuth,
	}

	if fileCode.Text != "" {
		if err := h.service.UpdateFileUsage(fileCode.Code); err != nil {
			logrus.WithError(err).Error("更新文件使用次数失败")
		}
		response.Text = fileCode.Text
	} else {
		response.Text = "/share/download?code=" + fileCode.Code
	}

	common.SuccessResponse(c, response)
}

// DownloadFile 下载文件
// @Summary 下载分享文件
// @Description 根据分享代码下载文件或获取文本内容
// @Tags 分享
// @Accept json
// @Produce application/octet-stream
// @Produce application/json
// @Param code query string true "分享代码"
// @Success 200 {file} binary "文件内容"
// @Success 200 {object} map[string]interface{} "文本内容"
// @Failure 400 {object} map[string]interface{} "请求参数错误"
// @Failure 404 {object} map[string]interface{} "分享代码不存在"
// @Router /share/download [get]
func (h *ShareHandler) DownloadFile(c *gin.Context) {
	code := utils.NormalizeShareCode(c.Query("code"))
	if code == "" {
		common.BadRequestResponse(c, "请输入提取码或完整下载地址")
		return
	}

	fileCode, userID, ok := h.fetchFileForRequest(c, code)
	if !ok {
		return
	}

	if h.tryReturnText(c, fileCode, userID) {
		return
	}

	if !h.streamFileResponse(c, fileCode, userID) {
		return
	}
}

// DownloadFileAPI REST 风格下载接口（API 模式）
// @Summary 下载分享内容（API 模式）
// @Description 根据分享代码下载文件或获取文本内容
// @Tags API
// @Produce application/octet-stream
// @Produce application/json
// @Param code path string true "分享代码"
// @Success 200 {file} binary "文件内容"
// @Success 200 {object} map[string]interface{} "文本内容"
// @Failure 400 {object} map[string]interface{} "请求参数错误"
// @Failure 401 {object} map[string]interface{} "API Key 校验失败"
// @Failure 404 {object} map[string]interface{} "分享不存在"
// @Router /api/v1/share/{code}/download [get]
// @Security ApiKeyAuth
func (h *ShareHandler) DownloadFileAPI(c *gin.Context) {
	code := c.Param("code")
	if code == "" {
		common.BadRequestResponse(c, "文件代码不能为空")
		return
	}

	fileCode, userID, ok := h.fetchFileForRequest(c, code)
	if !ok {
		return
	}

	if h.tryReturnText(c, fileCode, userID) {
		return
	}

	_ = h.streamFileResponse(c, fileCode, userID)
}

func (h *ShareHandler) lookupFileForRequest(c *gin.Context, code string) (*models.FileCode, bool) {
	var userID *uint
	if uid, exists := c.Get("user_id"); exists {
		id := uid.(uint)
		userID = &id
	}

	fileCode, err := h.service.GetFileByCodeWithAuth(code, userID)
	if err != nil {
		common.NotFoundResponse(c, err.Error())
		return nil, false
	}
	return fileCode, true
}

func (h *ShareHandler) fetchFileForRequest(c *gin.Context, code string) (*models.FileCode, *uint, bool) {
	var userID *uint
	if uid, exists := c.Get("user_id"); exists {
		id := uid.(uint)
		userID = &id
	}

	fileCode, ok := h.lookupFileForRequest(c, code)
	if !ok {
		return nil, nil, false
	}

	// 预览（preview/inline）或 Range 续传不消耗次数，避免 <video> 多次请求把次数扣光
	if shouldCountDownloadUsage(c) {
		if err := h.service.UpdateFileUsage(fileCode.Code); err != nil {
			logrus.WithError(err).Error("更新文件使用次数失败")
		}
	}

	return fileCode, userID, true
}

func shouldCountDownloadUsage(c *gin.Context) bool {
	if c.Query("preview") == "1" || c.Query("inline") == "1" {
		return false
	}
	// 非首段 Range（续传/拖动进度）不计次
	if rng := c.GetHeader("Range"); rng != "" {
		if !(strings.HasPrefix(rng, "bytes=0-") || rng == "bytes=0") {
			return false
		}
	}
	return true
}

func (h *ShareHandler) tryReturnText(c *gin.Context, fileCode *models.FileCode, userID *uint) bool {
	if fileCode.Text == "" {
		return false
	}

	common.SuccessResponse(c, fileCode.Text)
	h.service.RecordDownloadLog(fileCode, userID, c.ClientIP(), 0)
	return true
}

func (h *ShareHandler) streamFileResponse(c *gin.Context, fileCode *models.FileCode, userID *uint) bool {
	storageServiceInterface := h.service.GetStorageService()
	storageService, ok := storageServiceInterface.(*storage.ConcreteStorageService)
	if !ok {
		common.InternalServerErrorResponse(c, "存储服务类型错误")
		return false
	}

	start := time.Now()
	if err := storageService.GetFileResponse(c, fileCode); err != nil {
		common.NotFoundResponse(c, "文件下载失败: "+err.Error())
		return false
	}

	h.service.RecordDownloadLog(fileCode, userID, c.ClientIP(), time.Since(start))
	return true
}

// getDisplayFileName 获取用于显示的文件名
func getDisplayFileName(fileCode *models.FileCode) string {
	if fileCode.UUIDFileName != "" {
		return fileCode.UUIDFileName
	}
	// 向后兼容：如果UUIDFileName为空，则使用Prefix + Suffix
	return fileCode.Prefix + fileCode.Suffix
}
