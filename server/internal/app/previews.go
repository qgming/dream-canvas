package app

import (
	"context"
	"fmt"
	"image"
	"io"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/disintegration/imaging"
	"github.com/gin-gonic/gin"
)

const (
	maxPreviewImageDim    = 16384
	maxPreviewImagePixels = int64(50_000_000)
	videoPreviewTimeout   = 120 * time.Second
)

func (a *App) previewPath(id string) (string, error) {
	path, err := a.assetPath(id)
	return path + ".preview.png", err
}

func (a *App) lockPreview(id string) func() {
	a.previewLocksMu.Lock()
	if a.previewLocks == nil { a.previewLocks = map[string]*previewLockEntry{} }
	entry := a.previewLocks[id]
	if entry == nil {
		entry = &previewLockEntry{}
		a.previewLocks[id] = entry
	}
	entry.refs++
	a.previewLocksMu.Unlock()
	entry.mu.Lock()
	return func() {
		entry.mu.Unlock()
		a.previewLocksMu.Lock()
		entry.refs--
		if entry.refs == 0 { delete(a.previewLocks, id) }
		a.previewLocksMu.Unlock()
	}
}

func (a *App) openPreviewFile(preview string) (*os.File, error) {
	a.assetFiles.RLock()
	defer a.assetFiles.RUnlock()
	return os.Open(preview)
}

func servePreviewFile(c *gin.Context, asset Asset, file *os.File) {
	defer file.Close()
	stat, err := file.Stat()
	if err != nil { respondError(c, err); return }
	c.Header("Content-Type", "image/png")
	c.Header("Content-Security-Policy", "sandbox")
	c.Header("Cache-Control", "private, max-age=86400")
	c.Header("ETag", fmt.Sprintf("\"%s-preview-%d-%d\"", asset.ID, stat.Size(), stat.ModTime().UnixNano()))
	http.ServeContent(c.Writer, c.Request, asset.Title, stat.ModTime(), file)
}

func (a *App) assetPreview(c *gin.Context) {
	var asset Asset
	if err := a.db.First(&asset, "id = ? AND user_id = ?", c.Param("id"), currentUser(c).ID).Error; err != nil { respondError(c, err); return }
	if asset.DeleteState != "" { respondError(c, problem(410, "asset_deleted", "资产已删除")); return }
	if !includes([]string{"image", "video"}, asset.Kind) || asset.SaveState != "saved" { respondError(c, problem(409, "preview_unavailable", "此素材没有可读取的缩略图或封面")); return }
	preview, err := a.previewPath(asset.ID)
	if err != nil { respondError(c, err); return }
	if asset.PreviewPath != "" {
		if file, openErr := a.openPreviewFile(preview); openErr == nil {
			servePreviewFile(c, asset, file)
			return
		}
	}
	unlock := a.lockPreview(asset.ID)
	if err := a.db.First(&asset, "id = ?", asset.ID).Error; err != nil { unlock(); respondError(c, err); return }
	if asset.DeleteState != "" { unlock(); respondError(c, problem(410, "asset_deleted", "资产已删除")); return }
	if asset.PreviewPath != "" {
		if file, openErr := a.openPreviewFile(preview); openErr == nil {
			unlock()
			servePreviewFile(c, asset, file)
			return
		}
	}
	release, err := a.acquireFile(c.Request.Context(), true, false)
	if err != nil { unlock(); return }
	original, err := a.assetOriginalPath(asset)
	if err != nil { release(); unlock(); respondError(c, err); return }
	if asset.Kind == "video" {
		ctx, cancel := context.WithTimeout(c.Request.Context(), videoPreviewTimeout)
		tmp := preview + ".tmp"
		err = videoPreview(ctx, original, tmp)
		cancel()
		if err == nil { err = os.Rename(tmp, preview) } else { _ = os.Remove(tmp) }
	} else {
		a.assetFiles.RLock()
		src, openErr := os.Open(original)
		a.assetFiles.RUnlock()
		if openErr != nil { release(); unlock(); respondError(c, problem(500, "original_unavailable", "无法读取原件")); return }
		cfg, _, cfgErr := image.DecodeConfig(src)
		if cfgErr == nil && (cfg.Width > maxPreviewImageDim || cfg.Height > maxPreviewImageDim || int64(cfg.Width)*int64(cfg.Height) > maxPreviewImagePixels) {
			src.Close()
			release()
			unlock()
			a.logEvent(c.Request.Context(), slog.LevelWarn, "asset.preview_skipped_dimensions", slog.String("asset_id", asset.ID), slog.Int("width", cfg.Width), slog.Int("height", cfg.Height))
			a.db.Model(&asset).Updates(map[string]any{"preview_state": "failed", "preview_error": "图片像素尺寸超过缩略图生成上限，原件已保留，请直接查看或下载原件"})
			respondError(c, problem(409, "preview_unavailable", "图片像素尺寸超过缩略图生成上限，原件已保留，请直接查看或下载原件"))
			return
		}
		if _, seekErr := src.Seek(0, io.SeekStart); seekErr != nil { src.Close(); release(); unlock(); respondError(c, problem(500, "original_unavailable", "无法读取原件")); return }
		decoded, _, decodeErr := image.Decode(src)
		src.Close()
		if decodeErr != nil { release(); unlock(); respondError(c, problem(409, "preview_unavailable", "暂不支持此图片格式的缩略图，请查看原件")); return }
		thumbnail := imaging.Fit(decoded, 768, 768, imaging.Lanczos)
		tmp := preview + ".tmp"
		var output *os.File
		output, err = os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
		if err == nil {
			err = imaging.Encode(output, thumbnail, imaging.PNG)
			if err == nil { err = output.Sync() }
			closeErr := output.Close()
			if err == nil { err = closeErr }
			if err == nil { err = os.Rename(tmp, preview) }
		}
		if err != nil { _ = os.Remove(tmp) }
	}
	if err != nil {
		_ = os.Remove(preview)
		a.db.Model(&asset).Updates(map[string]any{"preview_state": "failed", "preview_error": "缩略图或视频封面保存失败，请检查 ffmpeg、原件格式和运行边界；原件仍保留"})
		release()
		unlock()
		respondError(c, problem(500, "preview_save_failed", "缩略图或视频封面保存失败，原件仍然保留"))
		return
	}
	result := a.db.Model(&Asset{}).Where("id = ? AND delete_state = ?", asset.ID, "").Updates(map[string]any{"preview_path": asset.ID + ".preview.png", "preview_state": "saved", "preview_error": ""})
	if result.Error != nil || result.RowsAffected == 0 {
		_ = os.Remove(preview)
		release()
		unlock()
		if result.Error != nil { respondError(c, result.Error) } else { respondError(c, problem(410, "asset_deleted", "资产已删除")) }
		return
	}
	release()
	unlock()
	if err := a.db.First(&asset, "id = ?", asset.ID).Error; err != nil { respondError(c, err); return }
	if asset.DeleteState != "" { respondError(c, problem(410, "asset_deleted", "资产已删除")); return }
	file, err := a.openPreviewFile(preview)
	if err != nil { respondError(c, problem(500, "preview_unavailable", "缩略图暂时无法读取，原件仍然保留")); return }
	servePreviewFile(c, asset, file)
}
