package app

import (
	"bytes"
	"errors"
	"io"
	"path/filepath"
	"strings"

	"github.com/gabriel-vasile/mimetype"
)

func assetMediaSource(source io.Reader) (io.Reader, *mimetype.MIME, error) {
	var header bytes.Buffer
	detected, err := mimetype.DetectReader(io.TeeReader(source, &header))
	return io.MultiReader(&header, source), detected, err
}

func (application *App) assetOriginalPath(asset Asset) (string, error) {
	extension := filepath.Ext(asset.Path)
	if asset.Path != asset.ID+extension || extension != "" && (len(extension) < 2 || strings.Trim(extension[1:], "abcdefghijklmnopqrstuvwxyz0123456789") != "") { return "", errors.New("invalid original filename") }
	name, err := application.assetPath(asset.ID)
	if err != nil { return "", err }
	return name+extension, nil
}
