package app

import (
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
	var asset Asset
	if err := a.db.First(&asset, "id = ? AND user_id = ?", c.Param("id"), currentUser(c).ID).Error; err != nil { respondError(c, err); return }
	if asset.DeleteState != "" { respondError(c, problem(410, "asset_deleted", "资产已删除")); return }
	if asset.Kind != "image" || asset.SaveState != "saved" { respondError(c, problem(409, "preview_unavailable", "此素材没有可读取的图片缩略图")); return }
	preview, err := a.previewPath(asset.ID)
	if err != nil { respondError(c, err); return }
	if asset.PreviewPath == "" {
		select {
		case a.previews <- struct{}{}:
			defer func() { <-a.previews }()
		case <-c.Request.Context().Done(): return
		}
		if err := a.db.First(&asset, "id = ?", asset.ID).Error; err != nil { respondError(c, err); return }
		if asset.DeleteState != "" { respondError(c, problem(410, "asset_deleted", "资产已删除")); return }
		if asset.PreviewPath == "" {
			original, err := a.assetPath(asset.ID)
			if err != nil { respondError(c, err); return }
			file, err := os.Open(original)
			if err != nil { respondError(c, problem(500, "original_unavailable", "无法读取原件")); return }
			decoded, _, err := image.Decode(file)
			file.Close()
			if err != nil { respondError(c, problem(409, "preview_unavailable", "暂不支持此图片格式的缩略图，请查看原件")); return }
			// Preserve the existing frontend preview edge; originals are never modified.
			thumbnail := imaging.Fit(decoded, 768, 768, imaging.Lanczos)
			output, err := os.OpenFile(preview, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
			if err == nil {
				err = imaging.Encode(output, thumbnail, imaging.PNG)
				if err == nil { err = output.Sync() }
				closeErr := output.Close()
				if err == nil { err = closeErr }
			}
			if err != nil { _ = os.Remove(preview); respondError(c, problem(500, "preview_save_failed", "缩略图保存失败，原件仍然保留")); return }
			result := a.db.Model(&Asset{}).Where("id = ? AND delete_state = ?", asset.ID, "").Update("preview_path", asset.ID+".preview.png")
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
