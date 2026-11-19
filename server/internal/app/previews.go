package app

import (
	"context"
	"image"
	"net/http"
	"os"

	"github.com/disintegration/imaging"
	"github.com/gin-gonic/gin"
)

func (a *App) previewPath(id string) (string, error) {
	path, err := a.assetPath(id)
	return path + ".preview.png", err
}

func (a *App) assetPreview(c *gin.Context) {
	release, err := a.acquireFile(c.Request.Context(), true, false); if err != nil { return }; defer release()
	a.assetFiles.RLock(); defer a.assetFiles.RUnlock()
	var asset Asset
	if err := a.db.First(&asset, "id = ? AND user_id = ?", c.Param("id"), currentUser(c).ID).Error; err != nil { respondError(c, err); return }
	if asset.DeleteState != "" { respondError(c, problem(410, "asset_deleted", "资产已删除")); return }
	if !includes([]string{"image", "video"}, asset.Kind) || asset.SaveState != "saved" { respondError(c, problem(409, "preview_unavailable", "此素材没有可读取的缩略图或封面")); return }
	preview, err := a.previewPath(asset.ID)
	if err != nil { respondError(c, err); return }
	if asset.PreviewPath == "" {
		a.previewMu.Lock(); defer a.previewMu.Unlock()
		if err := a.db.First(&asset, "id = ?", asset.ID).Error; err != nil { respondError(c, err); return }
		if asset.DeleteState != "" { respondError(c, problem(410, "asset_deleted", "资产已删除")); return }
		if asset.PreviewPath == "" {
			original, err := a.assetOriginalPath(asset)
			if err != nil { respondError(c, err); return }
			if asset.Kind == "video" {
				policy, policyErr := a.executionPolicy(); if policyErr != nil { respondError(c, policyErr); return }
				ctx, cancel := context.WithTimeout(c.Request.Context(), seconds(policy.QuerySeconds))
				err = videoPreview(ctx, original, preview); cancel()
			} else {
				file, openErr := os.Open(original); if openErr != nil { respondError(c, problem(500, "original_unavailable", "无法读取原件")); return }
				decoded, _, decodeErr := image.Decode(file); file.Close()
				if decodeErr != nil { respondError(c, problem(409, "preview_unavailable", "暂不支持此图片格式的缩略图，请查看原件")); return }
				thumbnail := imaging.Fit(decoded, 768, 768, imaging.Lanczos)
				var output *os.File; output, err = os.OpenFile(preview, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
				if err == nil { err = imaging.Encode(output, thumbnail, imaging.PNG); if err == nil { err = output.Sync() }; closeErr := output.Close(); if err == nil { err = closeErr } }
			}
			if err != nil { _ = os.Remove(preview); a.db.Model(&asset).Updates(map[string]any{"preview_state": "failed", "preview_error": "缩略图或视频封面保存失败，请检查 ffmpeg、原件格式和运行边界；原件仍保留"}); respondError(c, problem(500, "preview_save_failed", "缩略图或视频封面保存失败，原件仍然保留")); return }
			result := a.db.Model(&Asset{}).Where("id = ? AND delete_state = ?", asset.ID, "").Updates(map[string]any{"preview_path": asset.ID+".preview.png", "preview_state": "saved", "preview_error": ""})
			if result.Error != nil || result.RowsAffected == 0 { _ = os.Remove(preview); if result.Error != nil { respondError(c, result.Error) } else { respondError(c, problem(410, "asset_deleted", "资产已删除")) }; return }
		}
	}
	if err := a.db.First(&asset, "id = ?", asset.ID).Error; err != nil { respondError(c, err); return }
	if asset.DeleteState != "" { respondError(c, problem(410, "asset_deleted", "资产已删除")); return }
	c.Header("Content-Type", "image/png")
	c.Header("Content-Security-Policy", "sandbox")
	file, err := os.Open(preview)
	if err != nil { respondError(c, problem(500, "preview_unavailable", "缩略图暂时无法读取，原件仍然保留")); return }
	defer file.Close()
	stat, err := file.Stat()
	if err != nil { respondError(c, err); return }
	http.ServeContent(c.Writer, c.Request, asset.Title, stat.ModTime(), file)
}
