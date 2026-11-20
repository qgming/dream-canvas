package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

type assetMediaFixture struct { name, mimeType, extension string; data []byte }

func assetMediaFixtures(test *testing.T) []assetMediaFixture {
	test.Helper()
	var pngData, jpegData bytes.Buffer
	picture := image.NewRGBA(image.Rect(0, 0, 2, 2))
	if err := png.Encode(&pngData, picture); err != nil { test.Fatal(err) }
	if err := jpeg.Encode(&jpegData, picture, nil); err != nil { test.Fatal(err) }
	return []assetMediaFixture{
		{"png", "image/png", ".png", pngData.Bytes()},
		{"jpeg", "image/jpeg", ".jpg", jpegData.Bytes()},
		{"webp", "image/webp", ".webp", []byte("RIFF\x10\x00\x00\x00WEBPVP8 ")},
		{"mp4", "video/mp4", ".mp4", []byte("\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isommp42")},
		{"mov", "video/quicktime", ".mov", []byte("\x00\x00\x00\x14ftypqt  \x00\x00\x00\x00qt  ")},
		{"webm", "video/webm", ".webm", []byte("\x1a\x45\xdf\xa3\x42\x82\x84webm")},
		{"mp3", "audio/mpeg", ".mp3", []byte("ID3\x04\x00\x00\x00\x00\x00\x00")},
		{"wav", "audio/wav", ".wav", []byte("RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00")},
		{"flac", "audio/flac", ".flac", []byte("fLaC\x00\x00\x00\x22")},
		{"m4a", "audio/x-m4a", ".m4a", []byte("\x00\x00\x00\x14ftypM4A \x00\x00\x00\x00M4A ")},
	}
}

func assetFileTestApp(test *testing.T) *App {
	test.Helper()
	root := test.TempDir()
	if err := os.Mkdir(filepath.Join(root, "assets"), 0700); err != nil { test.Fatal(err) }
	database, err := gorm.Open(sqlite.Open(filepath.Join(root, "assets.sqlite")), &gorm.Config{}); if err != nil { test.Fatal(err) }
	if err := database.AutoMigrate(&User{}, &Asset{}, &RuntimeSettings{}, &ObjectStorage{}, &FileOperation{}, &GenerationTask{}, &TaskAsset{}, &WorkbenchRecord{}); err != nil { test.Fatal(err) }
	connection, err := database.DB(); if err != nil { test.Fatal(err) }; connection.SetMaxOpenConns(1); test.Cleanup(func() { connection.Close() })
	if err := database.Create(&RuntimeSettings{ID: 1, Policy: encode(suggestedPolicy())}).Error; err != nil { test.Fatal(err) }
	if err := database.Create(&User{ID: "owner", Username: "owner"}).Error; err != nil { test.Fatal(err) }
	return &App{db: database, root: root, ctx: context.Background(), transfers: newFileGate(), previews: newFileGate(), events: map[string]map[chan string]bool{}, wake: make(chan struct{}, 1)}
}

func assetFileTestRouter(application *App) *gin.Engine {
	router := gin.New()
	router.Use(func(request *gin.Context) { request.Set("user", User{ID: "owner"}); request.Next() })
	router.POST("/api/assets", application.uploadAsset)
	router.GET("/api/assets/:id/file", application.assetFile)
	router.GET("/api/assets/:id/preview", application.assetPreview)
	return router
}

func TestAssetMediaSourcePreservesBytes(test *testing.T) {
	for _, fixture := range assetMediaFixtures(test) {
		test.Run(fixture.name, func(test *testing.T) {
			data := append(append([]byte{}, fixture.data...), bytes.Repeat([]byte{0x01, 0x02}, 8192)...)
			source, detected, err := assetMediaSource(bytes.NewReader(data)); if err != nil { test.Fatal(err) }
			if detected.String() != fixture.mimeType || detected.Extension() != fixture.extension { test.Fatalf("unexpected detected format: %s %s", detected.String(), detected.Extension()) }
			preserved, err := io.ReadAll(source); if err != nil { test.Fatal(err) }
			if !bytes.Equal(preserved, data) { test.Fatal("format detection changed the original stream") }
		})
	}
}

func TestAssetUploadStoresDetectedExtension(test *testing.T) {
	application := assetFileTestApp(test)
	if err := application.db.Create(&ObjectStorage{ID: "storage", Provider: "qiniu", Default: true}).Error; err != nil { test.Fatal(err) }
	router := assetFileTestRouter(application)
	for _, fixture := range assetMediaFixtures(test) {
		test.Run(fixture.name, func(test *testing.T) {
			request := httptest.NewRequest("POST", "/api/assets", bytes.NewReader(fixture.data))
			kind := strings.Split(fixture.mimeType, "/")[0]
			request.Header.Set("Content-Type", map[string]string{"image": "image/png", "video": "video/mp4", "audio": "audio/mpeg"}[kind])
			request.Header.Set("X-File-Name", "wrong.bin")
			response := httptest.NewRecorder(); router.ServeHTTP(response, request)
			if response.Code != 201 { test.Fatalf("upload failed: %d %s", response.Code, response.Body.String()) }
			var asset Asset; if err := json.Unmarshal(response.Body.Bytes(), &asset); err != nil { test.Fatal(err) }
			if err := application.db.First(&asset, "id = ?", asset.ID).Error; err != nil { test.Fatal(err) }
			if asset.Path != asset.ID+fixture.extension || asset.MimeType != fixture.mimeType || asset.Bytes != int64(len(fixture.data)) || asset.SaveState != "saved" { test.Fatal("saved asset does not match detected original") }
			name, err := application.assetOriginalPath(asset); if err != nil { test.Fatal(err) }
			stored, err := os.ReadFile(name); if err != nil { test.Fatal(err) }; if !bytes.Equal(stored, fixture.data) { test.Fatal("uploaded original changed") }
			if _, err := os.Stat(filepath.Join(application.root, "assets", asset.ID)); !errors.Is(err, os.ErrNotExist) { test.Fatal("extensionless original was created") }
			if asset.StorageID != "storage" || asset.SyncState != "pending" || storageKey(asset) != "assets/owner/"+asset.Path { test.Fatal("cloud sync did not retain the stored filename") }
		})
	}
}

func TestRecordedAudioUploadVerifiesContainerTracks(test *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg"); if err != nil { test.Skip("ffmpeg is required to create recording fixtures") }
	if _, err := exec.LookPath("ffprobe"); err != nil { test.Skip("ffprobe is required to verify recording tracks") }
	for _, fixture := range []struct { name, mimeType, extension, audioCodec, videoCodec, format string; video bool }{
		{"webm_audio", "audio/webm;codecs=opus", ".webm", "libopus", "libvpx", "webm", false},
		{"mp4_audio", "audio/mp4", ".mp4", "aac", "mpeg4", "mp4", false},
		{"webm_video_rejected", "audio/webm;codecs=opus", ".webm", "libopus", "libvpx", "webm", true},
		{"mp4_video_rejected", "audio/mp4", ".mp4", "aac", "mpeg4", "mp4", true},
	} {
		test.Run(fixture.name, func(test *testing.T) {
			filename := filepath.Join(test.TempDir(), "recording"+fixture.extension)
			arguments := []string{"-nostdin", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono"}
			if fixture.video { arguments = append(arguments, "-f", "lavfi", "-i", "color=c=black:s=16x16:r=10", "-c:v", fixture.videoCodec) }
			arguments = append(arguments, "-t", "0.2", "-c:a", fixture.audioCodec, "-f", fixture.format, filename)
			if output, err := exec.Command(ffmpeg, arguments...).CombinedOutput(); err != nil { test.Skipf("recording fixture encoder unavailable: %s", output) }
			data, err := os.ReadFile(filename); if err != nil { test.Fatal(err) }
			application := assetFileTestApp(test)
			if err := application.db.Create(&ObjectStorage{ID: "storage", Provider: "qiniu", Default: true}).Error; err != nil { test.Fatal(err) }
			request := httptest.NewRequest("POST", "/api/assets", bytes.NewReader(data))
			request.Header.Set("Content-Type", fixture.mimeType)
			request.Header.Set("X-File-Name", "recording.wrong")
			response := httptest.NewRecorder(); assetFileTestRouter(application).ServeHTTP(response, request)
			if fixture.video {
				if response.Code != 400 { test.Fatalf("video accepted as audio: %d %s", response.Code, response.Body.String()) }
				var saved, queued int64
				if err := application.db.Model(&Asset{}).Where("save_state = ?", "saved").Count(&saved).Error; err != nil { test.Fatal(err) }
				if err := application.db.Model(&FileOperation{}).Count(&queued).Error; err != nil { test.Fatal(err) }
				if saved != 0 || queued != 0 { test.Fatal("unverified recording was saved or queued for cloud sync") }
				return
			}
			if response.Code != 201 { test.Fatalf("recording upload failed: %d %s", response.Code, response.Body.String()) }
			var asset Asset; if err := json.Unmarshal(response.Body.Bytes(), &asset); err != nil { test.Fatal(err) }
			if err := application.db.First(&asset, "id = ?", asset.ID).Error; err != nil { test.Fatal(err) }
			if asset.Kind != "audio" || asset.MimeType != strings.Split(fixture.mimeType, ";")[0] || asset.Path != asset.ID+fixture.extension || asset.AudioCodec == "" || asset.VideoCodec != "" || asset.DurationMS <= 0 || asset.ProbeError != "" || asset.SaveState != "saved" { test.Fatal("recording metadata did not match verified audio") }
			if asset.SyncState != "pending" || storageKey(asset) != "assets/owner/"+asset.Path { test.Fatal("recording sync lost the original filename") }
			name, err := application.assetOriginalPath(asset); if err != nil { test.Fatal(err) }
			original, err := os.ReadFile(name); if err != nil { test.Fatal(err) }
			if !bytes.Equal(data, original) { test.Fatal("recording was transcoded or changed during upload") }
		})
	}
}

func TestRecordedAudioCannotSaveWithoutTrackVerification(test *testing.T) {
	test.Setenv("PATH", test.TempDir())
	application := assetFileTestApp(test)
	request := httptest.NewRequest("POST", "/api/assets", bytes.NewReader([]byte("\x1a\x45\xdf\xa3\x42\x82\x84webm")))
	request.Header.Set("Content-Type", "audio/webm;codecs=opus")
	response := httptest.NewRecorder(); assetFileTestRouter(application).ServeHTTP(response, request)
	if response.Code != 422 || !strings.Contains(response.Body.String(), "media_probe_failed") { test.Fatalf("unverified recording accepted: %d %s", response.Code, response.Body.String()) }
	var asset Asset; if err := application.db.First(&asset).Error; err != nil { test.Fatal(err) }
	if asset.SaveState != "failed" || asset.Error == "" || asset.SyncState != "local" { test.Fatal("track verification failure was not preserved") }
}

func TestGeneratedAssetStoresDetectedExtension(test *testing.T) {
	application := assetFileTestApp(test)
	for _, fixture := range assetMediaFixtures(test) {
		test.Run(fixture.name, func(test *testing.T) {
			task := GenerationTask{ID: identifier(), UserID: "owner", Capability: strings.Split(fixture.mimeType, "/")[0]}
			asset, err := application.saveGeneratedAsset(context.Background(), task, 0, bytes.NewReader(fixture.data), "audio/pcm", suggestedPolicy()); if err != nil { test.Fatal(err) }
			if asset.Path != asset.ID+fixture.extension || asset.MimeType != fixture.mimeType || asset.SaveState != "saved" { test.Fatal("supplier MIME overrode the actual file format") }
			var recorded Asset; if err := application.db.First(&recorded, "id = ?", asset.ID).Error; err != nil { test.Fatal(err) }; if recorded.Path != asset.Path { test.Fatal("original filename was not persisted") }
			name, err := application.assetOriginalPath(asset); if err != nil { test.Fatal(err) }; stored, err := os.ReadFile(name); if err != nil { test.Fatal(err) }; if !bytes.Equal(stored, fixture.data) { test.Fatal("generated original changed") }
			unused := strings.NewReader("must not replace a saved original")
			repeated, err := application.saveGeneratedAsset(context.Background(), task, 0, unused, "application/octet-stream", suggestedPolicy()); if err != nil { test.Fatal(err) }
			if repeated.ID != asset.ID || repeated.Path != asset.Path || unused.Len() != len("must not replace a saved original") { test.Fatal("result recovery rewrote a saved original") }
		})
	}
}

func TestGeneratedAssetRetryAndPCMExtension(test *testing.T) {
	application := assetFileTestApp(test)
	data := assetMediaFixtures(test)[0].data
	task := GenerationTask{ID: identifier(), UserID: "owner", Capability: "image"}
	policy := suggestedPolicy(); policy.ImageBytes = int64(len(data)-1)
	asset, err := application.saveGeneratedAsset(context.Background(), task, 0, bytes.NewReader(data), "image/jpeg", policy); if err == nil { test.Fatal("oversized original was accepted") }
	var failed Asset; if err := application.db.First(&failed, "id = ?", asset.ID).Error; err != nil { test.Fatal(err) }; if failed.SaveState != "failed" || failed.Path != asset.ID+".png" { test.Fatal("failed write lost its actual filename") }
	asset, err = application.saveGeneratedAsset(context.Background(), task, 0, bytes.NewReader(data), "image/jpeg", suggestedPolicy()); if err != nil { test.Fatal(err) }; if asset.Path != failed.Path || asset.SaveState != "saved" { test.Fatal("result retry changed its filename") }
	pcm := make([]byte, 256)
	asset, err = application.saveGeneratedAsset(context.Background(), GenerationTask{ID: identifier(), UserID: "owner", Capability: "audio"}, 0, bytes.NewReader(pcm), "audio/pcm", suggestedPolicy()); if err != nil { test.Fatal(err) }
	if asset.Path != asset.ID+".pcm" || asset.MimeType != "audio/pcm" { test.Fatal("headerless PCM did not retain its declared format") }
}

func TestStoredOriginalReadPreviewToolsAndCleanup(test *testing.T) {
	application := assetFileTestApp(test)
	router := assetFileTestRouter(application)
	data := assetMediaFixtures(test)[0].data
	request := httptest.NewRequest("POST", "/api/assets", bytes.NewReader(data)); request.Header.Set("Content-Type", "image/png")
	response := httptest.NewRecorder(); router.ServeHTTP(response, request); if response.Code != 201 { test.Fatal(response.Body.String()) }
	var asset Asset; if err := json.Unmarshal(response.Body.Bytes(), &asset); err != nil { test.Fatal(err) }
	for _, endpoint := range []string{"file", "preview"} {
		response = httptest.NewRecorder(); router.ServeHTTP(response, httptest.NewRequest("GET", "/api/assets/"+asset.ID+"/"+endpoint, nil))
		if response.Code != 200 || response.Header().Get("Content-Type") != "image/png" { test.Fatalf("stored original %s unavailable: %d", endpoint, response.Code) }
		if endpoint == "file" && !bytes.Equal(response.Body.Bytes(), data) { test.Fatal("HTTP original changed") }
	}
	content, err := application.CallBusiness(context.Background(), Principal{User: User{ID: "owner"}, Scopes: []string{"read"}}, "asset_content", map[string]any{"assetId": asset.ID}); if err != nil { test.Fatal(err) }
	if object(content)["base64"] != base64.StdEncoding.EncodeToString(data) { test.Fatal("tool did not read the recorded original filename") }
	if err := application.db.Model(&Asset{}).Where("id = ?", asset.ID).Update("delete_state", "pending").Error; err != nil { test.Fatal(err) }
	if err := application.cleanAsset(asset.ID); err != nil { test.Fatal(err) }
	for _, filename := range []string{asset.ID+".png", asset.ID+".preview.png"} { if _, err := os.Stat(filepath.Join(application.root, "assets", filename)); !errors.Is(err, os.ErrNotExist) { test.Fatal("confirmed cleanup left a stored file") } }
}

func TestOriginalFilenameValidationAndRecordedCloudKey(test *testing.T) {
	application := &App{root: test.TempDir()}
	id := identifier()
	for _, extension := range []string{"", ".png", ".mp4", ".webm", ".pcm"} {
		asset := Asset{ID: id, UserID: "owner", Path: id+extension, MimeType: "video/mp4"}
		name, err := application.assetOriginalPath(asset); if err != nil { test.Fatal(err) }
		if name != filepath.Join(application.root, "assets", asset.Path) || storageKey(asset) != "assets/owner/"+asset.Path { test.Fatal("stored filename was guessed or replaced") }
	}
	for _, filename := range []string{"", "../"+id+".png", id+"/file.png", id+"\\file.png", id+".", id+".png.php", id+".mp4?name=x", identifier()+".png"} { if _, err := application.assetOriginalPath(Asset{ID: id, Path: filename}); err == nil { test.Fatal("unsafe or mismatched original filename accepted") } }
	if _, err := application.assetPath(id+".mp4"); err == nil { test.Fatal("non-media ID validation was weakened") }
}

func TestAssetSignedURLRetainsOriginalExtension(test *testing.T) {
	application := assetFileTestApp(test)
	credentials, err := openKey(application.root); if err != nil { test.Fatal(err) }; application.credentials = credentials
	accessKey, err := application.encryptSecret("test-access-key"); if err != nil { test.Fatal(err) }
	secret, err := application.encryptSecret("test-secret-key"); if err != nil { test.Fatal(err) }
	for _, provider := range []string{"aliyun", "tencent", "qiniu", "r2", "s3"} {
		test.Run(provider, func(test *testing.T) {
			storage := ObjectStorage{ID: identifier(), Provider: provider, Region: "test", PathStyle: provider != "aliyun" && provider != "tencent", Endpoint: "https://storage.example.com", Bucket: "private-media", AccessKeyID: accessKey, Secret: secret}
			if err := application.db.Create(&storage).Error; err != nil { test.Fatal(err) }
			id := identifier(); asset := Asset{ID: id, UserID: "owner", Kind: "video", MimeType: "video/mp4", Path: id+".mp4", StorageID: storage.ID, SaveState: "saved", SyncState: "synced"}
			if err := application.db.Create(&asset).Error; err != nil { test.Fatal(err) }
			address, err := application.assetTaskURL("owner", asset.ID, suggestedPolicy()); if err != nil { test.Fatal(err) }
			parsed, err := url.Parse(address); if err != nil { test.Fatal(err) }
			if !strings.HasSuffix(parsed.Path, "/"+storageKey(asset)) || parsed.RawQuery == "" { test.Fatal("private task URL lost its actual extension or signature") }
		})
	}
}
