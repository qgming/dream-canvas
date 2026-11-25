package app

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const defaultAssetProjectID = "default"
const defaultAssetProjectTitle = "默认"

func ensureAssetProject(db *gorm.DB, userID, id string) error {
	if strings.TrimSpace(id) == "" {
		return problem(400, "asset_project_required", "请选择资产项目")
	}
	if id == defaultAssetProjectID {
		return nil
	}
	var project AssetProject
	return db.Select("id").First(&project, "id = ? AND user_id = ?", id, userID).Error
}

func validateAssetProjectTitle(title string) error {
	if title == defaultAssetProjectTitle || strings.EqualFold(title, defaultAssetProjectID) {
		return problem(400, "reserved_asset_project_title", "默认项目名称已保留")
	}
	return validTitle(title)
}

func (a *App) ListAssetProjects(userID string) ([]AssetProject, error) {
	var projects []AssetProject
	if err := a.db.Where("user_id = ?", userID).Order("created_at, id").Find(&projects).Error; err != nil {
		return nil, err
	}
	return append([]AssetProject{{ID: defaultAssetProjectID, Title: defaultAssetProjectTitle, IsDefault: true}}, projects...), nil
}

func (a *App) CreateAssetProject(userID, title string) (AssetProject, error) {
	title = strings.TrimSpace(title)
	if err := validateAssetProjectTitle(title); err != nil {
		return AssetProject{}, err
	}
	project := AssetProject{ID: identifier(), UserID: userID, Title: title, Version: 1}
	err := a.db.Create(&project).Error
	if err == nil {
		a.notify(userID)
	}
	return project, err
}

func (a *App) RenameAssetProject(userID, id, title string, version uint64) (AssetProject, error) {
	title = strings.TrimSpace(title)
	var project AssetProject
	if id == defaultAssetProjectID {
		return project, problem(400, "default_asset_project", "不能重命名默认项目")
	}
	if err := validateAssetProjectTitle(title); err != nil {
		return project, err
	}
	err := a.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&AssetProject{}).Where("id = ? AND user_id = ? AND version = ?", id, userID, version).
			Updates(map[string]any{"title": title, "version": version + 1})
		if result.Error != nil {
			return result.Error
		}
		if err := tx.First(&project, "id = ? AND user_id = ?", id, userID).Error; err != nil {
			return err
		}
		if result.RowsAffected != 1 {
			return problem(409, "version_conflict", "资产项目已更新，请重新读取后操作")
		}
		return nil
	})
	if err == nil {
		a.notify(userID)
	}
	return project, err
}

func (a *App) DeleteAssetProject(userID, id string, version uint64) error {
	if id == defaultAssetProjectID {
		return problem(400, "default_asset_project", "不能删除默认项目")
	}
	err := a.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Delete(&AssetProject{}, "id = ? AND user_id = ? AND version = ?", id, userID, version)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			if err := ensureAssetProject(tx, userID, id); err != nil {
				return err
			}
			return problem(409, "version_conflict", "资产项目已更新，请重新读取后操作")
		}
		return tx.Model(&Asset{}).Where("user_id = ? AND asset_project_id = ?", userID, id).
			UpdateColumn("asset_project_id", defaultAssetProjectID).Error
	})
	if err == nil {
		a.notify(userID)
	}
	return err
}

func (a *App) MoveAsset(userID, id, assetProjectID, expectedAssetProjectID string) error {
	if strings.TrimSpace(expectedAssetProjectID) == "" {
		return problem(400, "asset_project_required", "需要读取资产当前所属项目")
	}
	err := a.db.Transaction(func(tx *gorm.DB) error {
		if err := ensureAssetProject(tx, userID, assetProjectID); err != nil {
			return err
		}
		var asset Asset
		if err := tx.Select("id", "asset_project_id").First(&asset, "id = ? AND user_id = ? AND delete_state = ? AND workbench_record_id = ?", id, userID, "", "").Error; err != nil {
			return err
		}
		if asset.AssetProjectID == assetProjectID {
			return nil
		}
		if asset.AssetProjectID != expectedAssetProjectID {
			return problem(409, "asset_project_changed", "资产已移动，请重新读取后操作")
		}
		return tx.Model(&asset).UpdateColumn("asset_project_id", assetProjectID).Error
	})
	if err == nil {
		a.notify(userID)
	}
	return err
}

type assetProjectInput struct {
	Title string `json:"title"`
	Version uint64 `json:"version"`
}

func (a *App) listAssetProjects(c *gin.Context) {
	projects, err := a.ListAssetProjects(currentUser(c).ID)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, projects)
}

func (a *App) createAssetProject(c *gin.Context) {
	var input assetProjectInput
	if !bind(c, &input) {
		return
	}
	project, err := a.CreateAssetProject(currentUser(c).ID, input.Title)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusCreated, project)
}

func (a *App) renameAssetProject(c *gin.Context) {
	var input assetProjectInput
	if !bind(c, &input) {
		return
	}
	project, err := a.RenameAssetProject(currentUser(c).ID, c.Param("id"), input.Title, input.Version)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, project)
}

func (a *App) deleteAssetProject(c *gin.Context) {
	var input assetProjectInput
	if !bind(c, &input) {
		return
	}
	if err := a.DeleteAssetProject(currentUser(c).ID, c.Param("id"), input.Version); err != nil {
		respondError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (a *App) moveAsset(c *gin.Context) {
	var input struct {
		AssetProjectID string `json:"assetProjectId"`
		ExpectedAssetProjectID string `json:"expectedAssetProjectId"`
	}
	if !bind(c, &input) {
		return
	}
	if err := a.MoveAsset(currentUser(c).ID, c.Param("id"), input.AssetProjectID, input.ExpectedAssetProjectID); err != nil {
		respondError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
